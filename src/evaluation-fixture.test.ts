// pattern: Imperative Shell
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEvaluationCorpus } from "./evaluation-corpus.js";
import { parseEvaluationPricing } from "./pricing.js";

describe("synthetic-v1 corpus", () => {
	it("is a valid bounded corpus covering every supported action", async () => {
		const input = JSON.parse(
			await readFile(resolve("corpora/synthetic-v1.json"), "utf8"),
		) as unknown;
		const result = parseEvaluationCorpus(input);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value.cases).toHaveLength(6);
		expect(new Set(result.value.cases.map((item) => item.plan.step.action))).toEqual(
			new Set(["check", "click", "fill", "select"]),
		);
		expect(result.value.cases.some((item) => item.label.expectedRef === null)).toBe(true);
	});
});

describe("synthetic-v2 corpus", () => {
	it("expands every action class with unique, ambiguous, and adversarial cases", async () => {
		const input = JSON.parse(
			await readFile(resolve("corpora/synthetic-v2.json"), "utf8"),
		) as unknown;
		const result = parseEvaluationCorpus(input);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value.cases).toHaveLength(16);
		for (const action of ["check", "click", "fill", "select"] as const) {
			expect(result.value.cases.filter((item) => item.plan.step.action === action)).toHaveLength(4);
		}
		expect(
			result.value.cases.filter((item) => item.label.expectedRef === null).length,
		).toBeGreaterThanOrEqual(4);
		expect(result.value.cases.filter((item) => item.tags.includes("adversarial"))).toHaveLength(4);
	});
});

describe("dated evaluation pricing", () => {
	it("parses the checked-in public rate snapshot", async () => {
		const input = JSON.parse(
			await readFile(resolve("config/evaluation-pricing-2026-09-18.json"), "utf8"),
		) as unknown;
		const result = parseEvaluationPricing(input);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.value.asOf).toBe("2026-09-18");
		expect(Object.keys(result.value.selectors)).toEqual(["jev", "baseline"]);
	});
});
