// pattern: Imperative Shell
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CODEX_BASELINE_REQUEST_FILE_LIMIT,
	CODEX_BASELINE_REQUEST_LIMIT,
} from "./codex-baseline.js";
import { runCodexBaselineClient } from "./codex-baseline-client.js";
import { buildSelectionRequest } from "./selection.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function fixtureFiles(): Promise<{
	directory: string;
	inputPath: string;
	outputPath: string;
	codexPath: string;
}> {
	const directory = await mkdtemp(join(tmpdir(), "jekhov-codex-baseline-test-"));
	temporaryDirectories.push(directory);
	const inputPath = join(directory, "request.json");
	const outputPath = join(directory, "response.json");
	const codexPath = join(directory, "fake-codex.mjs");
	const request = buildSelectionRequest({
		goal: "Continue",
		action: "click",
		pageUrl: "data:text/html,fixture",
		pageTitle: "Fixture",
		candidates: [{ id: "c0", ref: "e1", role: "button", name: "Continue", context: [] }],
	});
	await writeFile(inputPath, JSON.stringify(request), { mode: 0o600 });
	await writeFile(
		codexPath,
		`#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const required = ["exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--json", "--sandbox", "read-only", "--model", "gpt-5.6-luna"];
if (!required.every((item) => args.includes(item))) process.exit(12);
if (!args.includes('model_reasoning_effort="low"')) process.exit(13);
for (const feature of ["shell_tool", "unified_exec", "code_mode", "view_image"]) {
  const index = args.findIndex((item, position) => item === "--disable" && args[position + 1] === feature);
  if (index === -1) process.exit(15);
}
if (!args.includes('web_search="disabled"')) process.exit(17);
if (process.env.JEKHOV_SENTINEL) process.exit(16);
await new Promise((resolve) => {
  process.stdin.resume();
  process.stdin.on("end", resolve);
});
const schema = JSON.parse(readFileSync(value("--output-schema"), "utf8"));
if (!schema.properties.choice.enum.includes("c0")) process.exit(14);
writeFileSync(value("--output-last-message"), JSON.stringify({ choice: "c0", unambiguous_probability: 0.88 }));
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thread-test" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 90, cached_input_tokens: 60, output_tokens: 8, reasoning_output_tokens: 1 } }) + "\\n");
`,
		{ mode: 0o700 },
	);
	await chmod(codexPath, 0o700);
	return { directory, inputPath, outputPath, codexPath };
}

describe("runCodexBaselineClient", () => {
	it("runs pinned structured Codex selection and writes a Jekhov response", async () => {
		const fixture = await fixtureFiles();
		vi.stubEnv("JEKHOV_SENTINEL", "must-not-be-inherited");
		const code = await runCodexBaselineClient(
			["--data-class", "synthetic", "--input", fixture.inputPath, "--output", fixture.outputPath],
			{ codexPath: fixture.codexPath, timeoutMs: 1_000 },
		);

		expect(code).toBe(0);
		expect(JSON.parse(await readFile(fixture.outputPath, "utf8"))).toMatchObject({
			provenance: {
				provider: "openai",
				transport: "codex-cli",
				requested_model: "gpt-5.6-luna",
				reasoning_effort: "low",
				tool_calls: 0,
			},
			usage: { input_tokens: 90, cached_input_tokens: 60, output_tokens: 8 },
			answers: {
				next_element: { choice: "c0" },
				unambiguous_match: { noul: 0.88 },
			},
		});
	});

	it("accepts a pretty-printed request that is within the compact semantic limit", async () => {
		const fixture = await fixtureFiles();
		const request = buildSelectionRequest({
			goal: "G".repeat(500),
			action: "click",
			pageUrl: `https://example.com/${"q/".repeat(60)}`,
			pageTitle: "T".repeat(200),
			candidates: Array.from({ length: 27 }, (_, index) => ({
				id: `c${index}`,
				ref: `e${index}`,
				role: "button",
				name: "N".repeat(160),
				context: ["A".repeat(120), "B".repeat(120)],
				url: `https://example.com/${"p/".repeat(60)}`,
				placeholder: "P".repeat(160),
				cursor: "pointer",
			})),
		});
		const compact = JSON.stringify(request);
		const pretty = `${JSON.stringify(request, null, 2)}\n`;
		expect(Buffer.byteLength(compact)).toBeLessThanOrEqual(CODEX_BASELINE_REQUEST_LIMIT);
		expect(Buffer.byteLength(pretty)).toBeGreaterThan(CODEX_BASELINE_REQUEST_LIMIT);
		expect(Buffer.byteLength(pretty)).toBeLessThanOrEqual(CODEX_BASELINE_REQUEST_FILE_LIMIT);
		await writeFile(fixture.inputPath, pretty, { mode: 0o600 });

		expect(
			await runCodexBaselineClient(
				["--data-class", "synthetic", "--input", fixture.inputPath, "--output", fixture.outputPath],
				{ codexPath: fixture.codexPath, timeoutMs: 1_000 },
			),
		).toBe(0);
	});

	it("rejects duplicate flags before reading input", async () => {
		const fixture = await fixtureFiles();
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		expect(
			await runCodexBaselineClient([
				"--data-class",
				"public",
				"--data-class",
				"synthetic",
				"--input",
				fixture.inputPath,
				"--output",
				fixture.outputPath,
			]),
		).toBe(1);
		expect(stderr).toHaveBeenCalledWith(
			expect.stringContaining("duplicate argument: --data-class"),
		);
	});

	it("rejects an oversized request file before starting Codex", async () => {
		const fixture = await fixtureFiles();
		await writeFile(fixture.inputPath, " ".repeat(CODEX_BASELINE_REQUEST_FILE_LIMIT + 1));
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		expect(
			await runCodexBaselineClient(
				["--data-class", "synthetic", "--input", fixture.inputPath, "--output", fixture.outputPath],
				{ codexPath: join(fixture.directory, "must-not-run") },
			),
		).toBe(1);
		expect(stderr).toHaveBeenCalledWith(
			expect.stringContaining(
				`baseline request exceeds ${CODEX_BASELINE_REQUEST_FILE_LIMIT} bytes`,
			),
		);
	});

	it("rejects unsupported data before starting Codex", async () => {
		const fixture = await fixtureFiles();
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const code = await runCodexBaselineClient(
			[
				"--data-class",
				"private-approved",
				"--input",
				fixture.inputPath,
				"--output",
				fixture.outputPath,
			],
			{ codexPath: fixture.codexPath },
		);

		expect(code).toBe(1);
		expect(stderr).toHaveBeenCalledWith(
			expect.stringContaining("data class must be public or synthetic"),
		);
		await expect(readFile(fixture.outputPath, "utf8")).rejects.toThrow();
	});
});
