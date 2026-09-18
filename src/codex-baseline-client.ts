#!/usr/bin/env node
// pattern: Imperative Shell
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	buildCodexBaselineOutputSchema,
	buildCodexBaselinePrompt,
	CODEX_BASELINE_MODEL,
	CODEX_BASELINE_REASONING_EFFORT,
	parseCodexBaselineAnswer,
	parseCodexBaselineRequest,
	parseCodexJsonEvents,
} from "./codex-baseline.js";
import type { Failure, Result } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const DISABLED_CODEX_FEATURES = [
	"apps",
	"browser_use",
	"browser_use_external",
	"code_mode",
	"computer_use",
	"enable_mcp_apps",
	"image_generation",
	"in_app_browser",
	"js_repl",
	"multi_agent",
	"plugins",
	"remote_plugin",
	"shell_tool",
	"skill_search",
	"standalone_web_search",
	"unified_exec",
	"view_image",
] as const;

interface ClientOptions {
	dataClass: "public" | "synthetic";
	inputPath: string;
	outputPath: string;
}

function invalid(message: string): Result<ClientOptions> {
	return { ok: false, error: { code: "invalid-codex-baseline-cli", message } };
}

function parseArgs(argv: string[]): Result<ClientOptions> {
	const values: Record<string, string> = {};
	const allowed = new Set(["--data-class", "--input", "--output"]);
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		if (!flag || !allowed.has(flag)) return invalid(`unknown argument: ${flag ?? "(missing)"}`);
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) return invalid(`${flag} requires a value`);
		values[flag] = value;
	}
	const dataClass = values["--data-class"];
	if (dataClass !== "public" && dataClass !== "synthetic") {
		return invalid("data class must be public or synthetic");
	}
	if (!values["--input"]) return invalid("--input is required");
	if (!values["--output"]) return invalid("--output is required");
	return {
		ok: true,
		value: {
			dataClass,
			inputPath: resolve(values["--input"]),
			outputPath: resolve(values["--output"]),
		},
	};
}

function runCodex(options: {
	codexPath: string;
	directory: string;
	schemaPath: string;
	answerPath: string;
	prompt: string;
	timeoutMs: number;
}): Promise<Result<string>> {
	const environment: NodeJS.ProcessEnv = {
		HOME: options.directory,
		CODEX_HOME: process.env.CODEX_HOME ?? join(homedir(), ".codex"),
	};
	for (const key of [
		"ALL_PROXY",
		"HTTP_PROXY",
		"HTTPS_PROXY",
		"LANG",
		"LC_ALL",
		"NO_PROXY",
		"PATH",
		"SSL_CERT_DIR",
		"SSL_CERT_FILE",
	] as const) {
		if (process.env[key]) environment[key] = process.env[key];
	}
	return new Promise((resolveResult) => {
		const child = execFile(
			options.codexPath,
			[
				"exec",
				"--ephemeral",
				"--ignore-user-config",
				"--ignore-rules",
				"--strict-config",
				"--skip-git-repo-check",
				"--sandbox",
				"read-only",
				"--model",
				CODEX_BASELINE_MODEL,
				"--config",
				`model_reasoning_effort="${CODEX_BASELINE_REASONING_EFFORT}"`,
				"--config",
				'web_search="disabled"',
				...DISABLED_CODEX_FEATURES.flatMap((feature) => ["--disable", feature]),
				"--color",
				"never",
				"--json",
				"--output-schema",
				options.schemaPath,
				"--output-last-message",
				options.answerPath,
				"--cd",
				options.directory,
				options.prompt,
			],
			{
				cwd: options.directory,
				env: environment,
				timeout: options.timeoutMs,
				maxBuffer: MAX_BUFFER_BYTES,
			},
			(error, stdout, stderr) => {
				if (!error) {
					resolveResult({ ok: true, value: stdout });
					return;
				}
				resolveResult({
					ok: false,
					error: {
						code: "codex-baseline-failed",
						message: (stderr.trim() || error.message).slice(0, 4_000),
					},
				});
			},
		);
		child.stdin?.end();
	});
}

function reportFailure(failure: Failure): number {
	process.stderr.write(`jekhov-codex-baseline: ${failure.code}: ${failure.message}\n`);
	return 1;
}

export async function runCodexBaselineClient(
	argv = process.argv.slice(2),
	options: { codexPath?: string; timeoutMs?: number } = {},
): Promise<number> {
	const parsedArgs = parseArgs(argv);
	if (!parsedArgs.ok) return reportFailure(parsedArgs.error);

	let rawRequest: string;
	let input: unknown;
	try {
		rawRequest = await readFile(parsedArgs.value.inputPath, "utf8");
		input = JSON.parse(rawRequest);
	} catch (error) {
		return reportFailure({
			code: "codex-baseline-input-failed",
			message: error instanceof Error ? error.message : "Could not read selection request",
		});
	}
	const request = parseCodexBaselineRequest(input);
	if (!request.ok) return reportFailure(request.error);

	const directory = await mkdtemp(join(tmpdir(), "jekhov-codex-baseline-"));
	const schemaPath = join(directory, "answer-schema.json");
	const answerPath = join(directory, "answer.json");
	try {
		await writeFile(
			schemaPath,
			`${JSON.stringify(buildCodexBaselineOutputSchema(request.value), null, 2)}\n`,
			{ mode: 0o600 },
		);
		const ran = await runCodex({
			codexPath: options.codexPath ?? process.env.JEKHOV_CODEX_BIN ?? "codex",
			directory,
			schemaPath,
			answerPath,
			prompt: buildCodexBaselinePrompt(request.value),
			timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		});
		if (!ran.ok) return reportFailure(ran.error);
		const events = parseCodexJsonEvents(ran.value);
		if (!events.ok) return reportFailure(events.error);
		if (events.value.toolItemTypes.length > 0) {
			return reportFailure({
				code: "codex-tool-use-not-allowed",
				message: `baseline invoked tools: ${events.value.toolItemTypes.join(", ")}`,
			});
		}

		let rawAnswer: string;
		let answerInput: unknown;
		try {
			rawAnswer = await readFile(answerPath, "utf8");
			answerInput = JSON.parse(rawAnswer);
		} catch (error) {
			return reportFailure({
				code: "codex-baseline-output-failed",
				message: error instanceof Error ? error.message : "Could not read Codex answer",
			});
		}
		const answer = parseCodexBaselineAnswer(answerInput, request.value);
		if (!answer.ok) return reportFailure(answer.error);

		const response = {
			provenance: {
				provider: "openai",
				transport: "codex-cli",
				requested_model: CODEX_BASELINE_MODEL,
				reasoning_effort: CODEX_BASELINE_REASONING_EFFORT,
				data_class: parsedArgs.value.dataClass,
				tool_calls: 0,
			},
			usage: events.value.usage,
			answers: {
				next_element: { choice: answer.value.choice },
				unambiguous_match: { noul: answer.value.unambiguousProbability },
			},
		};
		await writeFile(parsedArgs.value.outputPath, `${JSON.stringify(response, null, 2)}\n`, {
			mode: 0o600,
		});
		return 0;
	} finally {
		await rm(directory, { recursive: true }).catch(() => undefined);
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
	runCodexBaselineClient().then((code) => {
		process.exitCode = code;
	});
}
