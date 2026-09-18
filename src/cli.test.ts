// pattern: Imperative Shell
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./cli.js";
import type { EvaluationReport } from "./evaluation-run.js";
import type { SyntheticTaskReport } from "./synthetic-task-run.js";

const temporaryDirectories: string[] = [];
const managedChromium = chromium.executablePath();
const executablePath =
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
	(existsSync(managedChromium)
		? undefined
		: existsSync("/snap/bin/chromium")
			? "/snap/bin/chromium"
			: undefined);
const browserAvailable = executablePath !== undefined || existsSync(managedChromium);

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("runCli evaluate", () => {
	it("compares two wrappers over the checked-in corpus without opening a browser", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jekhov-cli-test-"));
		temporaryDirectories.push(directory);
		const clientPath = join(directory, "selector-client.mjs");
		const pricingPath = join(directory, "pricing.json");
		const outputPath = join(directory, "missing", "nested", "report.json");
		await writeFile(
			pricingPath,
			JSON.stringify({
				version: 1,
				currency: "USD",
				asOf: "2026-09-18",
				selectors: {
					jev: {
						model: "fixture-jev",
						sourceUrl: "https://example.com/jev-pricing",
						components: [{ usageField: "input_tokens", usdPerMillion: 0.042 }],
					},
					"jev-choice-only": {
						model: "fixture-jev",
						sourceUrl: "https://example.com/jev-pricing",
						components: [{ usageField: "input_tokens", usdPerMillion: 0.042 }],
					},
					baseline: {
						model: "fixture-baseline",
						sourceUrl: "https://example.com/baseline-pricing",
						components: [{ usageField: "input_tokens", usdPerMillion: 0.2 }],
					},
				},
			}),
			{ mode: 0o600 },
		);
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
if (goal.includes("next page")) choice = Object.entries(request.questions.next_element.criteria).find(([key, description]) => key !== "none" && description.includes('"Next"'))?.[0] ?? "none";
if (goal.includes("product query") || goal.includes("product size")) choice = "c0";
if (goal.includes("used items")) choice = "c1";
const probabilities = Object.fromEntries(Object.keys(request.questions.next_element.criteria).map((key) => [key, key === choice ? 1 : 0]));
const answers = { next_element: { type: "choice", choice, confidence: 0.9, probabilities } };
if (request.questions.unambiguous_match) answers.unambiguous_match = { type: "noul", noul: choice === "none" ? 0.2 : 0.9 };
writeFileSync(args["--output"], JSON.stringify({
  provenance: { provider: "fixture", cache_hit: false },
  usage: { input_tokens: 10, cost_usd: 0.0001 },
  answers
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
			"--pricing",
			pricingPath,
			"--output",
			outputPath,
		]);

		expect(code).toBe(0);
		const report = JSON.parse(await readFile(outputPath, "utf8")) as EvaluationReport;
		expect(report.executed).toBe(false);
		expect(report.version).toBe(2);
		expect(report.pricing?.asOf).toBe("2026-09-18");
		expect(report.requestBudget).toEqual({
			selectors: 3,
			casesPerSelector: 6,
			maximumRequests: 18,
		});
		expect(report.selectors.map((selector) => selector.name)).toEqual([
			"jev",
			"jev-choice-only",
			"baseline",
		]);
		expect(report.selectors.map((selector) => selector.summary.correct)).toEqual([6, 6, 6]);
		expect(report.selectors.map((selector) => selector.summary.requestsMade)).toEqual([5, 5, 5]);
		expect(report.selectors.map((selector) => selector.summary.cache.misses)).toEqual([5, 5, 5]);
		expect(report.selectors.map((selector) => selector.summary.apiListPriceUsd?.complete)).toEqual([
			true,
			true,
			true,
		]);
		expect(
			report.selectors[1]?.cases.every(
				(item) => item.matchProbabilitySource !== "unambiguous-noul",
			),
		).toBe(true);
		expect(report.cascade?.operatingPoints).toHaveLength(21);
		expect(report.cascade?.operatingPoints[8]?.threshold).toBe(0.4);
	});
});

describe.runIf(browserAvailable)("runCli task", () => {
	it("executes and reports the bundled labeled synthetic task", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jekhov-cli-task-test-"));
		temporaryDirectories.push(directory);
		const clientPath = join(directory, "selector-client.mjs");
		const outputPath = join(directory, "task-report.json");
		await writeFile(
			clientPath,
			`import { readFileSync, writeFileSync } from "node:fs";
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value, all[index + 1]]);
  return pairs;
}, []));
const request = JSON.parse(readFileSync(args["--input"], "utf8"));
const names = { fill: "Product", select: "Size", check: "Used only", click: "Search" };
const choice = request.state.candidates.find((candidate) => candidate.name === names[request.state.intended_action])?.id ?? "none";
writeFileSync(args["--output"], JSON.stringify({
  provenance: { provider: "fixture", cache_hit: false },
  usage: { input_tokens: 10 },
  answers: { next_element: { choice }, unambiguous_match: { noul: choice === "none" ? 0 : 1 } }
}));
`,
			{ mode: 0o600 },
		);

		const code = await runCli([
			"task",
			"--plan",
			resolve("examples/synthetic-task.json"),
			"--jev-client",
			clientPath,
			...(executablePath ? ["--chromium", executablePath] : []),
			"--output",
			outputPath,
		]);

		expect(code).toBe(0);
		const report = JSON.parse(await readFile(outputPath, "utf8")) as SyntheticTaskReport;
		expect(report.status).toBe("completed");
		expect(report.executed).toBe(true);
		expect(report.executedStepCount).toBe(4);
		expect(report.jevRequestCount).toBe(4);
	});
});
