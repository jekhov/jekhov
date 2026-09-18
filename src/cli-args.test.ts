// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./cli-args.js";

describe("parseCliArgs", () => {
	it("parses the bundled synthetic demo", () => {
		expect(
			parseCliArgs(["demo", "--jev-client", "client.mjs", "--chromium", "/usr/bin/chromium"]),
		).toEqual({
			ok: true,
			value: {
				command: "demo",
				jevClientPath: "client.mjs",
				chromiumPath: "/usr/bin/chromium",
			},
		});
	});

	it("parses a zero-cost inspection", () => {
		expect(
			parseCliArgs(["inspect", "--plan", "plan.json", "--chromium", "/usr/bin/chromium"]),
		).toEqual({
			ok: true,
			value: {
				command: "inspect",
				planPath: "plan.json",
				chromiumPath: "/usr/bin/chromium",
			},
		});
	});

	it("requires an explicit plan", () => {
		expect(parseCliArgs(["shadow"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "--plan is required" },
		});
	});

	it("parses all shadow options", () => {
		expect(
			parseCliArgs([
				"shadow",
				"--plan",
				"plan.json",
				"--jev-client",
				"client.mjs",
				"--output",
				"report.json",
			]),
		).toEqual({
			ok: true,
			value: {
				command: "shadow",
				planPath: "plan.json",
				jevClientPath: "client.mjs",
				outputPath: "report.json",
			},
		});
	});

	it("parses an evaluation comparison with an explicit baseline wrapper", () => {
		expect(
			parseCliArgs([
				"evaluate",
				"--corpus",
				"corpora/synthetic-v1.json",
				"--jev-client",
				"jev-client.mjs",
				"--baseline-client",
				"baseline-client.mjs",
				"--pricing",
				"config/evaluation-pricing.json",
				"--output",
				"reports/comparison.json",
			]),
		).toEqual({
			ok: true,
			value: {
				command: "evaluate",
				corpusPath: "corpora/synthetic-v1.json",
				jevClientPath: "jev-client.mjs",
				baselineClientPath: "baseline-client.mjs",
				pricingPath: "config/evaluation-pricing.json",
				outputPath: "reports/comparison.json",
			},
		});
	});

	it("requires the corpus and baseline wrapper for evaluation", () => {
		expect(parseCliArgs(["evaluate", "--baseline-client", "baseline.mjs"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "--corpus is required" },
		});
		expect(parseCliArgs(["evaluate", "--corpus", "corpus.json"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "--baseline-client is required" },
		});
	});

	it("uses the default Jev wrapper and stdout when evaluation overrides are omitted", () => {
		expect(
			parseCliArgs(["evaluate", "--corpus", "corpus.json", "--baseline-client", "baseline.mjs"]),
		).toEqual({
			ok: true,
			value: {
				command: "evaluate",
				corpusPath: "corpus.json",
				baselineClientPath: "baseline.mjs",
			},
		});
	});

	it("supports help and reports missing flag values", () => {
		expect(parseCliArgs(["--help"])).toEqual({ ok: true, value: { command: "help" } });
		expect(parseCliArgs(["inspect", "--plan"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "--plan requires a value" },
		});
		expect(parseCliArgs([])).toEqual({
			ok: false,
			error: {
				code: "invalid-cli",
				message: "command must be demo, evaluate, inspect, or shadow",
			},
		});
	});

	it("rejects a plan override for the fixed demo", () => {
		expect(parseCliArgs(["demo", "--plan", "plan.json"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "unknown argument: --plan" },
		});
	});

	it("rejects unsupported commands and flags", () => {
		expect(parseCliArgs(["act", "--plan", "plan.json"])).toEqual({
			ok: false,
			error: {
				code: "invalid-cli",
				message: "command must be demo, evaluate, inspect, or shadow",
			},
		});
		expect(parseCliArgs(["inspect", "--plan", "plan.json", "--click"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "unknown argument: --click" },
		});
	});
});
