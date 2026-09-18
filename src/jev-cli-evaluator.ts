// pattern: Imperative Shell
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readBoundedJson, writePrivateJson } from "./private-json-file.js";
import type { DataClass, JevEvaluator, Result } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ERROR_CHARS = 4_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function runClient(
	clientPath: string,
	requestPath: string,
	responsePath: string,
	dataClass: DataClass,
	timeoutMs: number,
	failureCode: string,
): Promise<Result<undefined>> {
	return new Promise((resolveResult) => {
		execFile(
			process.execPath,
			[clientPath, "--data-class", dataClass, "--input", requestPath, "--output", responsePath],
			{ timeout: timeoutMs, maxBuffer: 64 * 1024 },
			(error, _stdout, stderr) => {
				if (!error) {
					resolveResult({ ok: true, value: undefined });
					return;
				}
				const detail = stderr.trim() || error.message;
				resolveResult({
					ok: false,
					error: {
						code: failureCode,
						message: detail.slice(0, MAX_ERROR_CHARS),
					},
				});
			},
		);
	});
}

export function createSelectionCliEvaluator(options: {
	clientPath: string;
	timeoutMs?: number;
	failureCode: string;
}): JevEvaluator {
	return {
		async evaluate(request, dataClass) {
			const directory = await mkdtemp(join(tmpdir(), "jekhov-"));
			const requestPath = join(directory, "request.json");
			const responsePath = join(directory, "response.json");
			try {
				await writePrivateJson(requestPath, request);
				const ran = await runClient(
					resolve(options.clientPath),
					requestPath,
					responsePath,
					dataClass,
					options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
					options.failureCode,
				);
				if (!ran.ok) return ran;
				try {
					return {
						ok: true,
						value: await readBoundedJson(responsePath, MAX_RESPONSE_BYTES, "selector response"),
					};
				} catch (error) {
					return {
						ok: false,
						error: {
							code: "invalid-jev-output",
							message: error instanceof Error ? error.message : "Jev output was not valid JSON",
						},
					};
				}
			} finally {
				await rm(directory, { recursive: true }).catch(() => undefined);
			}
		},
	};
}

export function createJevCliEvaluator(options: {
	clientPath: string;
	timeoutMs?: number;
}): JevEvaluator {
	return createSelectionCliEvaluator({
		...options,
		failureCode: "jev-client-failed",
	});
}

export function createBundledJevEvaluator(options: { timeoutMs?: number } = {}): JevEvaluator {
	return createJevCliEvaluator({
		clientPath: fileURLToPath(new URL("./jev-policy-client.js", import.meta.url)),
		...options,
	});
}
