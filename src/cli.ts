#!/usr/bin/env node
// pattern: Imperative Shell
import { realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./cli-args.js";
import { parseEvaluationCorpus } from "./evaluation-corpus.js";
import { runEvaluationCorpus } from "./evaluation-run.js";
import { runInspection } from "./inspection.js";
import {
	createBundledJevEvaluator,
	createJevCliEvaluator,
	createSelectionCliEvaluator,
} from "./jev-cli-evaluator.js";
import { captureMiniwobCorpus, runMiniwobBenchmark } from "./miniwob-run.js";
import { createPlaywrightObserver } from "./playwright-observer.js";
import { runSyntheticTaskInNewBrowser } from "./playwright-task-page.js";
import { parseShadowPlan } from "./policy.js";
import { type EvaluationPricing, parseEvaluationPricing } from "./pricing.js";
import { FileTooLargeError, readBoundedJson, writePrivateJson } from "./private-json-file.js";
import { JEKHOV_VERSION } from "./report-metadata.js";
import { runShadowSelection } from "./shadow-run.js";
import type { BrowserObserver, Failure, JevEvaluator, Result, ShadowPlan } from "./types.js";
import { type ValidationArtifactKind, validateArtifact } from "./validation.js";

const USAGE = `Usage:
  jekhov --version
  jekhov validate --plan PLAN.json [--output REPORT.json]
  jekhov validate --corpus CORPUS.json [--output REPORT.json]
  jekhov validate --pricing RATES.json [--output REPORT.json]
  jekhov demo [--chromium PATH] [--output REPORT.json]
  jekhov inspect --plan PLAN.json [--chromium PATH] [--output REPORT.json]
  jekhov shadow --plan PLAN.json [--jev-client PATH] [--chromium PATH] [--output REPORT.json]
  jekhov task --plan SYNTHETIC_TASK.json [--jev-client PATH] [--chromium PATH] [--output REPORT.json]
  jekhov miniwob capture --root MINIWOB_ROOT [--tasks NAMES] [--seeds SPEC] [--chromium PATH] [--output CORPUS.json]
  jekhov miniwob run --root MINIWOB_ROOT [--tasks NAMES] [--seeds SPEC] [--jev-client PATH] [--chromium PATH] [--output REPORT.json]
  jekhov evaluate --corpus CORPUS.json [--baseline-client PATH] [--jev-client PATH] [--pricing RATES.json] [--output REPORT.json]

validate checks one artifact without opening a browser or making a provider request.
demo runs one bundled synthetic shadow selection. inspect costs no Jev request.
shadow proposes an element but never acts.
task executes only labeled, oracle-gated synthetic steps with deterministic postconditions.
miniwob capture builds a labeled corpus without Jev; miniwob run executes the oracle-gated slice.
evaluate replays a declared public or synthetic corpus through selector wrappers; it never opens a browser or acts.`;

const MAX_CORPUS_BYTES = 5 * 1024 * 1024;
const MAX_PLAN_BYTES = 1024 * 1024;
const MAX_PRICING_BYTES = 1024 * 1024;
const BASELINE_WRAPPER_TIMEOUT_MS = 130_000;
const VALIDATION_INPUTS: Record<
	ValidationArtifactKind,
	{ maximumBytes: number; failureCode: string; tooLargeCode: string }
> = {
	plan: {
		maximumBytes: MAX_PLAN_BYTES,
		failureCode: "plan-read-failed",
		tooLargeCode: "plan-too-large",
	},
	corpus: {
		maximumBytes: MAX_CORPUS_BYTES,
		failureCode: "corpus-read-failed",
		tooLargeCode: "corpus-too-large",
	},
	pricing: {
		maximumBytes: MAX_PRICING_BYTES,
		failureCode: "pricing-read-failed",
		tooLargeCode: "pricing-too-large",
	},
};
const DEMO_PLAN: ShadowPlan = {
	version: 1,
	mode: "shadow",
	goal: "Navigate a synthetic product catalogue",
	startUrl:
		"data:text/html,%3Ctitle%3EJekhov%20demo%3C%2Ftitle%3E%3Cmain%3E%3Ch1%3EInventory%3C%2Fh1%3E%3Cnav%20aria-label%3D%22Pagination%22%3E%3Ca%20href%3D%22%23previous%22%3EPrevious%3C%2Fa%3E%3Ca%20href%3D%22%23next%22%3ENext%3C%2Fa%3E%3C%2Fnav%3E%3Cbutton%3ESave%20search%3C%2Fbutton%3E%3C%2Fmain%3E",
	dataClass: "synthetic",
	sourcePolicy: {
		allowedHosts: [],
		basis: "synthetic",
		reviewedAt: "2026-09-18",
		note: "Bundled repository-owned synthetic demonstration.",
	},
	step: {
		id: "next-page",
		action: "click",
		goal: "Open the next page of product results",
	},
};

async function readJson(
	path: string,
	options: {
		failureCode: string;
		maximumBytes: number;
		tooLargeCode: string;
		inputName: string;
	},
): Promise<Result<unknown>> {
	try {
		return {
			ok: true,
			value: await readBoundedJson(path, options.maximumBytes, options.inputName),
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				code: error instanceof FileTooLargeError ? options.tooLargeCode : options.failureCode,
				message: error instanceof Error ? error.message : "Could not read JSON input",
			},
		};
	}
}

async function emit(value: unknown, outputPath?: string): Promise<void> {
	if (outputPath) {
		await writePrivateJson(outputPath, value);
	} else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function reportFailure(failure: Failure): number {
	process.stderr.write(`jekhov: ${failure.code}: ${failure.message}\n`);
	return 1;
}

function configuredJevEvaluator(clientPath?: string) {
	const override = clientPath ?? process.env.JEV_CLIENT_PATH;
	return override ? createJevCliEvaluator({ clientPath: override }) : createBundledJevEvaluator();
}

interface CliDependencies {
	createBrowserObserver(options?: { executablePath?: string }): BrowserObserver;
	createJevEvaluator(clientPath?: string): JevEvaluator;
}

async function emitResult(value: unknown, outputPath?: string): Promise<number> {
	try {
		await emit(value, outputPath);
		return 0;
	} catch (error) {
		return reportFailure({
			code: "report-write-failed",
			message: error instanceof Error ? error.message : "Could not write report",
		});
	}
}

async function rejectInputOutputCollision(
	inputPath: string,
	outputPath?: string,
): Promise<Result<undefined>> {
	if (!outputPath) return { ok: true, value: undefined };
	const inputAbsolute = resolve(inputPath);
	const outputAbsolute = resolve(outputPath);
	let conflicts = inputAbsolute === outputAbsolute;
	if (!conflicts) {
		try {
			conflicts = (await realpath(inputAbsolute)) === (await realpath(outputAbsolute));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				return {
					ok: false,
					error: {
						code: "input-output-check-failed",
						message:
							error instanceof Error ? error.message : "Could not compare input and output paths",
					},
				};
			}
		}
	}
	return conflicts
		? {
				ok: false,
				error: {
					code: "input-output-conflict",
					message: "validation output must not replace its input artifact",
				},
			}
		: { ok: true, value: undefined };
}

export async function runCli(
	argv = process.argv.slice(2),
	dependencyOverrides: Partial<CliDependencies> = {},
): Promise<number> {
	const dependencies: CliDependencies = {
		createBrowserObserver: dependencyOverrides.createBrowserObserver ?? createPlaywrightObserver,
		createJevEvaluator: dependencyOverrides.createJevEvaluator ?? configuredJevEvaluator,
	};
	const parsedArgs = parseCliArgs(argv);
	if (!parsedArgs.ok) return reportFailure(parsedArgs.error);
	if (parsedArgs.value.command === "help") {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}
	if (parsedArgs.value.command === "version") {
		process.stdout.write(`${JEKHOV_VERSION}\n`);
		return 0;
	}
	if (parsedArgs.value.command === "validate") {
		const collision = await rejectInputOutputCollision(
			parsedArgs.value.inputPath,
			parsedArgs.value.outputPath,
		);
		if (!collision.ok) return reportFailure(collision.error);
		const inputOptions = VALIDATION_INPUTS[parsedArgs.value.artifactType];
		const loaded = await readJson(parsedArgs.value.inputPath, {
			...inputOptions,
			inputName: parsedArgs.value.artifactType,
		});
		if (!loaded.ok) return reportFailure(loaded.error);
		const validated = validateArtifact(parsedArgs.value.artifactType, loaded.value);
		if (!validated.ok) return reportFailure(validated.error);
		return emitResult(validated.value, parsedArgs.value.outputPath);
	}
	if (parsedArgs.value.command === "evaluate") {
		const loadedCorpus = await readJson(parsedArgs.value.corpusPath, {
			failureCode: "corpus-read-failed",
			maximumBytes: MAX_CORPUS_BYTES,
			tooLargeCode: "corpus-too-large",
			inputName: "corpus",
		});
		if (!loadedCorpus.ok) return reportFailure(loadedCorpus.error);
		const corpus = parseEvaluationCorpus(loadedCorpus.value);
		if (!corpus.ok) return reportFailure(corpus.error);
		let pricing: EvaluationPricing | undefined;
		if (parsedArgs.value.pricingPath) {
			const loadedPricing = await readJson(parsedArgs.value.pricingPath, {
				failureCode: "pricing-read-failed",
				maximumBytes: MAX_PRICING_BYTES,
				tooLargeCode: "pricing-too-large",
				inputName: "pricing",
			});
			if (!loadedPricing.ok) return reportFailure(loadedPricing.error);
			const parsedPricing = parseEvaluationPricing(loadedPricing.value);
			if (!parsedPricing.ok) return reportFailure(parsedPricing.error);
			pricing = parsedPricing.value;
		}
		const selectors = [
			{
				name: "jev",
				evaluator: dependencies.createJevEvaluator(parsedArgs.value.jevClientPath),
				selectionProfile: "choice-with-ambiguity" as const,
			},
			{
				name: "jev-choice-only",
				evaluator: dependencies.createJevEvaluator(parsedArgs.value.jevClientPath),
				selectionProfile: "choice-only" as const,
			},
		];
		if (parsedArgs.value.baselineClientPath) {
			selectors.push({
				name: "baseline",
				evaluator: createSelectionCliEvaluator({
					clientPath: parsedArgs.value.baselineClientPath,
					failureCode: "baseline-client-failed",
					timeoutMs: BASELINE_WRAPPER_TIMEOUT_MS,
				}),
				selectionProfile: "choice-with-ambiguity",
			});
		}
		const result = await runEvaluationCorpus(corpus.value, selectors, {
			...(pricing ? { pricing } : {}),
			...(parsedArgs.value.baselineClientPath
				? { cascade: { primarySelector: "jev", fallbackSelector: "baseline" } }
				: {}),
		});
		if (!result.ok) return reportFailure(result.error);
		return emitResult(result.value, parsedArgs.value.outputPath);
	}
	if (parsedArgs.value.command === "miniwob") {
		const executablePath =
			parsedArgs.value.chromiumPath ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
		const sharedOptions = {
			rootPath: parsedArgs.value.rootPath,
			...(parsedArgs.value.tasks ? { tasks: parsedArgs.value.tasks } : {}),
			...(parsedArgs.value.seeds ? { seeds: parsedArgs.value.seeds } : {}),
			...(executablePath ? { executablePath } : {}),
		};
		const result =
			parsedArgs.value.operation === "capture"
				? await captureMiniwobCorpus(sharedOptions)
				: await runMiniwobBenchmark({
						...sharedOptions,
						jev: dependencies.createJevEvaluator(parsedArgs.value.jevClientPath),
					});
		if (!result.ok) return reportFailure(result.error);
		return emitResult(result.value, parsedArgs.value.outputPath);
	}
	if (parsedArgs.value.command === "task") {
		const loaded = await readJson(parsedArgs.value.planPath, {
			failureCode: "plan-read-failed",
			maximumBytes: MAX_PLAN_BYTES,
			tooLargeCode: "plan-too-large",
			inputName: "plan",
		});
		if (!loaded.ok) return reportFailure(loaded.error);
		const executablePath =
			parsedArgs.value.chromiumPath ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
		const result = await runSyntheticTaskInNewBrowser(
			loaded.value,
			dependencies.createJevEvaluator(parsedArgs.value.jevClientPath),
			{ ...(executablePath ? { executablePath } : {}) },
		);
		if (!result.ok) return reportFailure(result.error);
		return emitResult(result.value, parsedArgs.value.outputPath);
	}

	let rawPlan: unknown = DEMO_PLAN;
	if (parsedArgs.value.command !== "demo") {
		const loaded = await readJson(parsedArgs.value.planPath, {
			failureCode: "plan-read-failed",
			maximumBytes: MAX_PLAN_BYTES,
			tooLargeCode: "plan-too-large",
			inputName: "plan",
		});
		if (!loaded.ok) return reportFailure(loaded.error);
		rawPlan = loaded.value;
	}
	const plan = parseShadowPlan(rawPlan);
	if (!plan.ok) return reportFailure(plan.error);
	const executablePath =
		parsedArgs.value.chromiumPath ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
	const browser = dependencies.createBrowserObserver({
		...(executablePath ? { executablePath } : {}),
	});

	const result =
		parsedArgs.value.command === "inspect"
			? await runInspection(plan.value, browser)
			: await runShadowSelection(plan.value, {
					browser,
					jev: dependencies.createJevEvaluator(parsedArgs.value.jevClientPath),
				});
	if (!result.ok) return reportFailure(result.error);
	return emitResult(result.value, parsedArgs.value.outputPath);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
	runCli().then((code) => {
		process.exitCode = code;
	});
}
