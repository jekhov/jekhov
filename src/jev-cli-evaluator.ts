// pattern: Imperative Shell
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DataClass, JevEvaluator, Result } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ERROR_CHARS = 4_000;

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
				await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, { mode: 0o600 });
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
					return { ok: true, value: JSON.parse(await readFile(responsePath, "utf8")) };
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
