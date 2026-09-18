// pattern: Imperative Shell
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCodexBaselineClient } from "./codex-baseline-client.js";
import { buildSelectionRequest } from "./selection.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
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
const required = ["exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--json", "--sandbox", "read-only", "--model", "gpt-5.6-luna"];
if (!required.every((item) => args.includes(item))) process.exit(12);
if (!args.includes('model_reasoning_effort="low"')) process.exit(13);
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
				thread_id: "thread-test",
				tool_calls: 0,
			},
			usage: { input_tokens: 90, cached_input_tokens: 60, output_tokens: 8 },
			answers: {
				next_element: { choice: "c0" },
				unambiguous_match: { noul: 0.88 },
			},
		});
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
