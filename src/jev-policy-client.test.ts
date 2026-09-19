// pattern: Imperative Shell
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JEV_MODEL, MAX_JEV_REQUEST_BYTES } from "./jev-policy.js";
import { runJevPolicyClient } from "./jev-policy-client.js";
import { buildSelectionRequest } from "./selection.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("runJevPolicyClient", () => {
	it("validates a request without an API call in dry-run mode", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jekhov-policy-client-"));
		temporaryDirectories.push(directory);
		const inputPath = join(directory, "request.json");
		const outputPath = join(directory, "output.json");
		await writeFile(
			inputPath,
			JSON.stringify(
				buildSelectionRequest({
					goal: "Continue",
					action: "click",
					pageUrl: "data:text/html,test",
					pageTitle: "Test",
					candidates: [{ id: "c0", ref: "e2", role: "button", name: "Continue", context: [] }],
				}),
			),
		);

		const code = await runJevPolicyClient([
			"--data-class",
			"synthetic",
			"--input",
			inputPath,
			"--output",
			outputPath,
			"--dry-run",
		]);

		expect(code).toBe(0);
		expect(JSON.parse(await readFile(outputPath, "utf8"))).toMatchObject({
			provenance: {
				provider: "typesafe",
				requested_model: JEV_MODEL,
				data_class: "synthetic",
				validated_only: true,
			},
		});
	});

	it("rejects duplicate flags instead of accepting the last value", async () => {
		await expect(
			runJevPolicyClient([
				"--data-class",
				"public",
				"--data-class",
				"synthetic",
				"--input",
				"unused.json",
				"--dry-run",
			]),
		).rejects.toThrow("duplicate argument: --data-class");
	});

	it("rejects an oversized request before validation or provider setup", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jekhov-policy-client-oversized-"));
		temporaryDirectories.push(directory);
		const inputPath = join(directory, "request.json");
		await writeFile(inputPath, " ".repeat(MAX_JEV_REQUEST_BYTES + 1));

		await expect(
			runJevPolicyClient(["--data-class", "synthetic", "--input", inputPath, "--dry-run"]),
		).rejects.toThrow(`input exceeds ${MAX_JEV_REQUEST_BYTES} bytes`);
	});
});
