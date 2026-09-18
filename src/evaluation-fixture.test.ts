// pattern: Imperative Shell
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEvaluationCorpus } from "./evaluation-corpus.js";

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
