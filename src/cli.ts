#!/usr/bin/env node
// pattern: Imperative Shell
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./cli-args.js";
import { runInspection } from "./inspection.js";
import { createJevCliEvaluator } from "./jev-cli-evaluator.js";
import { createPlaywrightObserver } from "./playwright-observer.js";
import { parseShadowPlan } from "./policy.js";
import { runShadowSelection } from "./shadow-run.js";
import type { Failure, Result } from "./types.js";

const USAGE = `Usage:
  jekhov inspect --plan PLAN.json [--chromium PATH] [--output REPORT.json]
  jekhov shadow --plan PLAN.json [--jev-client PATH] [--chromium PATH] [--output REPORT.json]

inspect costs no Jev request. shadow proposes an element but never acts.`;

async function readPlan(path: string): Promise<Result<unknown>> {
	try {
		return { ok: true, value: JSON.parse(await readFile(resolve(path), "utf8")) };
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "plan-read-failed",
				message: error instanceof Error ? error.message : "Could not read plan",
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

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
	const parsedArgs = parseCliArgs(argv);
	if (!parsedArgs.ok) return reportFailure(parsedArgs.error);
	if (parsedArgs.value.command === "help") {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}
	const loaded = await readPlan(parsedArgs.value.planPath);
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
							join(homedir(), ".agents/skills/jev/scripts/jev-client.mjs"),
					}),
				});
	if (!result.ok) return reportFailure(result.error);
	try {
		await emit(result.value, parsedArgs.value.outputPath);
		return 0;
	} catch (error) {
		return reportFailure({
			code: "report-write-failed",
			message: error instanceof Error ? error.message : "Could not write report",
		});
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	runCli().then((code) => {
		process.exitCode = code;
	});
}
