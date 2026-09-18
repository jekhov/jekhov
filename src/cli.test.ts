// pattern: Imperative Shell
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./cli.js";
import type { EvaluationReport } from "./evaluation-run.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("runCli evaluate", () => {
	it("compares two wrappers over the checked-in corpus without opening a browser", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jekhov-cli-test-"));
		temporaryDirectories.push(directory);
		const clientPath = join(directory, "selector-client.mjs");
		const outputPath = join(directory, "report.json");
		await writeFile(
			clientPath,
			`import { readFileSync, writeFileSync } from "node:fs";
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value, all[index + 1]]);
  return pairs;
}, []));
const request = JSON.parse(readFileSync(args["--input"], "utf8"));
const goal = request.state.goal;
let choice = "none";
if (goal.includes("next page")) choice = request.state.candidates.find((item) => item.name === "Next")?.id ?? "none";
if (goal.includes("product query") || goal.includes("product size")) choice = "c0";
if (goal.includes("used items")) choice = "c1";
writeFileSync(args["--output"], JSON.stringify({
  provenance: { provider: "fixture" },
  usage: { input_tokens: 10, cost_usd: 0.0001 },
  answers: { next_element: { choice }, unambiguous_match: { noul: choice === "none" ? 0.2 : 0.9 } }
}));
`,
			{ mode: 0o600 },
		);

		const code = await runCli([
			"evaluate",
			"--corpus",
			resolve("corpora/synthetic-v1.json"),
			"--jev-client",
			clientPath,
			"--baseline-client",
			clientPath,
			"--output",
			outputPath,
		]);

		expect(code).toBe(0);
		const report = JSON.parse(await readFile(outputPath, "utf8")) as EvaluationReport;
		expect(report.executed).toBe(false);
		expect(report.requestBudget).toEqual({
			selectors: 2,
			casesPerSelector: 6,
			maximumRequests: 12,
		});
		expect(report.selectors.map((selector) => selector.summary.correct)).toEqual([6, 6]);
		expect(report.selectors.map((selector) => selector.summary.requestsMade)).toEqual([5, 5]);
	});
});
