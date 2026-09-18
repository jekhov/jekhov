#!/usr/bin/env node
// pattern: Imperative Shell
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./cli-args.js";
import { parseEvaluationCorpus } from "./evaluation-corpus.js";
import { runEvaluationCorpus } from "./evaluation-run.js";
import { runInspection } from "./inspection.js";
import { createJevCliEvaluator, createSelectionCliEvaluator } from "./jev-cli-evaluator.js";
import { createPlaywrightObserver } from "./playwright-observer.js";
import { parseShadowPlan } from "./policy.js";
import { runShadowSelection } from "./shadow-run.js";
import type { Failure, Result } from "./types.js";

const USAGE = `Usage:
  jekhov inspect --plan PLAN.json [--chromium PATH] [--output REPORT.json]
  jekhov shadow --plan PLAN.json [--jev-client PATH] [--chromium PATH] [--output REPORT.json]
  jekhov evaluate --corpus CORPUS.json --baseline-client PATH [--jev-client PATH] [--output REPORT.json]

inspect costs no Jev request. shadow proposes an element but never acts.
evaluate replays a private corpus through Jev and baseline wrappers; it never opens a browser or acts.`;

const MAX_CORPUS_BYTES = 5 * 1024 * 1024;
const BASELINE_WRAPPER_TIMEOUT_MS = 130_000;

async function readJson(
	path: string,
	options: { failureCode: string; maximumBytes?: number },
): Promise<Result<unknown>> {
	try {
		const text = await readFile(resolve(path), "utf8");
		if (options.maximumBytes && Buffer.byteLength(text) > options.maximumBytes) {
			return {
				ok: false,
				error: {
					code: "corpus-too-large",
					message: `corpus exceeds ${options.maximumBytes} bytes`,
				},
			};
		}
		return { ok: true, value: JSON.parse(text) };
	} catch (error) {
		return {
			ok: false,
			error: {
				code: options.failureCode,
				message: error instanceof Error ? error.message : "Could not read JSON input",
			},
		};
	}
}

async function emit(value: unknown, outputPath?: string): Promise<void> {
	const text = `${JSON.stringify(value, null, 2)}\n`;
	if (outputPath) await writeFile(resolve(outputPath), text, { mode: 0o600 });
	else process.stdout.write(text);
}

function reportFailure(failure: Failure): number {
	process.stderr.write(`jekhov: ${failure.code}: ${failure.message}\n`);
	return 1;
}

function defaultJevClientPath(): string {
	return join(homedir(), ".agents/skills/jev/scripts/jev-client.mjs");
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

async function prepareOutputDirectory(outputPath?: string): Promise<Result<undefined>> {
	if (!outputPath) return { ok: true, value: undefined };
	try {
		await mkdir(dirname(resolve(outputPath)), { recursive: true, mode: 0o700 });
		return { ok: true, value: undefined };
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "report-directory-failed",
				message: error instanceof Error ? error.message : "Could not prepare report directory",
			},
		};
	}
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
	const parsedArgs = parseCliArgs(argv);
	if (!parsedArgs.ok) return reportFailure(parsedArgs.error);
	if (parsedArgs.value.command === "help") {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}
	const preparedOutput = await prepareOutputDirectory(parsedArgs.value.outputPath);
	if (!preparedOutput.ok) return reportFailure(preparedOutput.error);
	if (parsedArgs.value.command === "evaluate") {
		const loadedCorpus = await readJson(parsedArgs.value.corpusPath, {
			failureCode: "corpus-read-failed",
			maximumBytes: MAX_CORPUS_BYTES,
		});
		if (!loadedCorpus.ok) return reportFailure(loadedCorpus.error);
		const corpus = parseEvaluationCorpus(loadedCorpus.value);
		if (!corpus.ok) return reportFailure(corpus.error);
		const result = await runEvaluationCorpus(corpus.value, [
			{
				name: "jev",
				evaluator: createJevCliEvaluator({
					clientPath:
						parsedArgs.value.jevClientPath ?? process.env.JEV_CLIENT_PATH ?? defaultJevClientPath(),
				}),
			},
			{
				name: "baseline",
				evaluator: createSelectionCliEvaluator({
					clientPath: parsedArgs.value.baselineClientPath,
					failureCode: "baseline-client-failed",
					timeoutMs: BASELINE_WRAPPER_TIMEOUT_MS,
				}),
			},
		]);
		if (!result.ok) return reportFailure(result.error);
		return emitResult(result.value, parsedArgs.value.outputPath);
	}

	const loaded = await readJson(parsedArgs.value.planPath, { failureCode: "plan-read-failed" });
	if (!loaded.ok) return reportFailure(loaded.error);
	const plan = parseShadowPlan(loaded.value);
	if (!plan.ok) return reportFailure(plan.error);
	const executablePath =
		parsedArgs.value.chromiumPath ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
	const browser = createPlaywrightObserver({ ...(executablePath ? { executablePath } : {}) });

	const result =
		parsedArgs.value.command === "inspect"
			? await runInspection(plan.value, browser)
			: await runShadowSelection(plan.value, {
					browser,
					jev: createJevCliEvaluator({
						clientPath:
							parsedArgs.value.jevClientPath ??
							process.env.JEV_CLIENT_PATH ??
							defaultJevClientPath(),
					}),
				});
	if (!result.ok) return reportFailure(result.error);
	return emitResult(result.value, parsedArgs.value.outputPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	runCli().then((code) => {
		process.exitCode = code;
	});
}
