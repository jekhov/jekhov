// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./cli-args.js";

describe("parseCliArgs", () => {
	it("supports version output", () => {
		expect(parseCliArgs(["--version"])).toEqual({ ok: true, value: { command: "version" } });
		expect(parseCliArgs(["-v"])).toEqual({ ok: true, value: { command: "version" } });
	});

	it.each([
		["--plan", "plan.json", "plan"],
		["--corpus", "corpus.json", "corpus"],
		["--pricing", "pricing.json", "pricing"],
	] as const)("parses validation for %s", (flag, path, artifactType) => {
		expect(parseCliArgs(["validate", flag, path, "--output", "validation.json"])).toEqual({
			ok: true,
			value: {
				command: "validate",
				artifactType,
				inputPath: path,
				outputPath: "validation.json",
			},
		});
	});

	it("requires exactly one validation input", () => {
		expect(parseCliArgs(["validate"])).toEqual({
			ok: false,
			error: {
				code: "invalid-cli",
				message: "validate requires exactly one of --plan, --corpus, or --pricing",
			},
		});
		expect(parseCliArgs(["validate", "--plan", "plan.json", "--corpus", "corpus.json"])).toEqual({
			ok: false,
			error: {
				code: "invalid-cli",
				message: "validate requires exactly one of --plan, --corpus, or --pricing",
			},
		});
	});

	it("rejects duplicate flags instead of silently replacing a value", () => {
		expect(parseCliArgs(["inspect", "--plan", "first.json", "--plan", "second.json"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "duplicate argument: --plan" },
		});
	});

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

	it("parses a labeled synthetic task", () => {
		expect(
			parseCliArgs([
				"task",
				"--plan",
				"task.json",
				"--jev-client",
				"client.mjs",
				"--output",
				"task-report.json",
			]),
		).toEqual({
			ok: true,
			value: {
				command: "task",
				planPath: "task.json",
				jevClientPath: "client.mjs",
				outputPath: "task-report.json",
			},
		});
	});

	it("parses a pinned MiniWoB execution slice", () => {
		expect(
			parseCliArgs([
				"miniwob",
				"run",
				"--root",
				".benchmarks/miniwob-plusplus",
				"--tasks",
				"click-test,enter-text",
				"--seeds",
				"0-2,5",
				"--output",
				"reports/miniwob.json",
			]),
		).toEqual({
			ok: true,
			value: {
				command: "miniwob",
				operation: "run",
				rootPath: ".benchmarks/miniwob-plusplus",
				tasks: ["click-test", "enter-text"],
				seeds: [0, 1, 2, 5],
				outputPath: "reports/miniwob.json",
			},
		});
	});

	it("parses deterministic MiniWoB corpus capture", () => {
		expect(
			parseCliArgs([
				"miniwob",
				"capture",
				"--root",
				"/tmp/miniwob",
				"--seeds",
				"7",
				"--output",
				"corpora/miniwob.json",
			]),
		).toEqual({
			ok: true,
			value: {
				command: "miniwob",
				operation: "capture",
				rootPath: "/tmp/miniwob",
				seeds: [7],
				outputPath: "corpora/miniwob.json",
			},
		});
	});

	it("rejects invalid MiniWoB operations, tasks, and seeds", () => {
		expect(parseCliArgs(["miniwob", "race", "--root", "/tmp/miniwob"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "miniwob operation must be capture or run" },
		});
		expect(
			parseCliArgs(["miniwob", "run", "--root", "/tmp/miniwob", "--tasks", "click-link"]),
		).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "unsupported MiniWoB task: click-link" },
		});
		expect(parseCliArgs(["miniwob", "run", "--root", "/tmp/miniwob", "--seeds", "4-2"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "invalid MiniWoB seed range: 4-2" },
		});
		expect(parseCliArgs(["miniwob", "run", "--root", "/tmp/miniwob", "--tasks", ","])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "MiniWoB tasks must be a comma-separated list" },
		});
		expect(
			parseCliArgs(["miniwob", "run", "--root", "/tmp/miniwob", "--seeds", "not-a-seed"]),
		).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "invalid MiniWoB seed: not-a-seed" },
		});
		expect(
			parseCliArgs(["miniwob", "run", "--root", "/tmp/miniwob", "--seeds", "1000001"]),
		).toEqual({
			ok: false,
			error: {
				code: "invalid-cli",
				message: "MiniWoB seeds must be integers from 0 through 1000000",
			},
		});
		expect(parseCliArgs(["miniwob", "run", "--root", "/tmp/miniwob", "--seeds", "0-100"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "at most 100 MiniWoB seeds are supported" },
		});
		expect(
			parseCliArgs([
				"miniwob",
				"run",
				"--root",
				"/tmp/miniwob",
				"--seeds",
				"0-999999999999999999999",
			]),
		).toEqual({
			ok: false,
			error: {
				code: "invalid-cli",
				message: "MiniWoB seeds must be integers from 0 through 1000000",
			},
		});
		expect(parseCliArgs(["miniwob", "run"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "--root is required" },
		});
		expect(
			parseCliArgs(["miniwob", "capture", "--root", "/tmp/miniwob", "--jev-client", "client.mjs"]),
		).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "unknown argument: --jev-client" },
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

	it("requires a corpus for evaluation", () => {
		expect(parseCliArgs(["evaluate", "--baseline-client", "baseline.mjs"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "--corpus is required" },
		});
	});

	it("supports a Jev-only evaluation with the bundled wrapper", () => {
		expect(parseCliArgs(["evaluate", "--corpus", "corpus.json"])).toEqual({
			ok: true,
			value: {
				command: "evaluate",
				corpusPath: "corpus.json",
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
				message: "command must be demo, evaluate, inspect, miniwob, shadow, task, or validate",
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
				message: "command must be demo, evaluate, inspect, miniwob, shadow, task, or validate",
			},
		});
		expect(parseCliArgs(["inspect", "--plan", "plan.json", "--click"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "unknown argument: --click" },
		});
	});
});
