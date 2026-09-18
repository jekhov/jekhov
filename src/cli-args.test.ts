// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./cli-args.js";

describe("parseCliArgs", () => {
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

	it("supports help and reports missing flag values", () => {
		expect(parseCliArgs(["--help"])).toEqual({ ok: true, value: { command: "help" } });
		expect(parseCliArgs(["inspect", "--plan"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "--plan requires a value" },
		});
		expect(parseCliArgs([])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "command must be inspect or shadow" },
		});
	});

	it("rejects unsupported commands and flags", () => {
		expect(parseCliArgs(["act", "--plan", "plan.json"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "command must be inspect or shadow" },
		});
		expect(parseCliArgs(["inspect", "--plan", "plan.json", "--click"])).toEqual({
			ok: false,
			error: { code: "invalid-cli", message: "unknown argument: --click" },
		});
	});
});
