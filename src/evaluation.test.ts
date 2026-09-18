// pattern: Functional Core
import { describe, expect, it } from "vitest";
import type { EvaluationCaseResult } from "./evaluation.js";
import { classifyEvaluationOutcome, summarizeEvaluationCases } from "./evaluation.js";

describe("classifyEvaluationOutcome", () => {
	it.each([
		["expected", "expected", "correct-selection"],
		[null, null, "correct-abstention"],
		["expected", null, "missed-selection"],
		[null, "unexpected", "false-selection"],
		["expected", "other", "wrong-selection"],
	] as const)("classifies expected=%s actual=%s", (expected, actual, outcome) => {
		expect(classifyEvaluationOutcome(expected, actual)).toBe(outcome);
	});
});

describe("summarizeEvaluationCases", () => {
	it("reports correctness, abstention, bytes, latency, usage, and reported cost", () => {
		const cases: EvaluationCaseResult[] = [
			{
				caseId: "correct-selection",
				action: "click",
				tags: ["unique"],
				expectedRef: "a",
				actualRef: "a",
				outcome: "correct-selection",
				status: "proposed",
				requestMade: true,
				requestBytes: 120,
				elapsedMilliseconds: 10,
				matchProbability: 0.9,
				candidateCount: 1,
				omittedCandidateCount: 0,
				provenance: { provider: "fixture" },
				usage: { input_tokens: 20, output_tokens: 4, cost_usd: 0.001 },
			},
			{
				caseId: "missed",
				action: "fill",
				tags: ["ambiguous"],
				expectedRef: "b",
				actualRef: null,
				outcome: "missed-selection",
				status: "abstained",
				requestMade: true,
				requestBytes: 130,
				elapsedMilliseconds: 20,
				matchProbability: 0.2,
				candidateCount: 2,
				omittedCandidateCount: 0,
				provenance: { provider: "fixture" },
				usage: { input_tokens: 25, output_tokens: 3, total_cost_usd: 0.002 },
			},
			{
				caseId: "empty",
				action: "click",
				tags: ["no-candidates"],
				expectedRef: null,
				actualRef: null,
				outcome: "correct-abstention",
				status: "no-candidates",
				requestMade: false,
				requestBytes: 0,
				elapsedMilliseconds: 5,
				matchProbability: null,
				candidateCount: 0,
				omittedCandidateCount: 0,
				provenance: null,
				usage: null,
			},
			{
				caseId: "error",
				action: "select",
				tags: [],
				expectedRef: "c",
				actualRef: null,
				outcome: "error",
				status: "error",
				requestMade: true,
				requestBytes: 140,
				elapsedMilliseconds: 25,
				matchProbability: null,
				candidateCount: 1,
				omittedCandidateCount: 0,
				provenance: null,
				usage: null,
				failure: { code: "client-failed", message: "offline" },
			},
		];

		expect(summarizeEvaluationCases(cases)).toEqual({
			totalCases: 4,
			completedCases: 3,
			correct: 2,
			incorrect: 1,
			errors: 1,
			accuracy: 2 / 3,
			proposals: 1,
			explicitAbstentions: 1,
			noCandidateCases: 1,
			proposalPrecision: 1,
			pipelineAbstentionRate: 2 / 3,
			providerAbstentionRate: 1 / 2,
			requestsMade: 3,
			totalRequestBytes: 390,
			totalElapsedMilliseconds: 60,
			meanElapsedMilliseconds: 15,
			usageTotals: { input_tokens: 45, output_tokens: 7, cost_usd: 0.001, total_cost_usd: 0.002 },
			reportedCostUsd: { total: 0.003, reportedCases: 2 },
		});
	});

	it("uses null rates when no completed decision supports the denominator", () => {
		const cases: EvaluationCaseResult[] = [
			{
				caseId: "error",
				action: "click",
				tags: [],
				expectedRef: null,
				actualRef: null,
				outcome: "error",
				status: "error",
				requestMade: false,
				requestBytes: 0,
				elapsedMilliseconds: 1,
				matchProbability: null,
				candidateCount: 0,
				omittedCandidateCount: 0,
				provenance: null,
				usage: null,
				failure: { code: "broken", message: "broken" },
			},
		];

		const summary = summarizeEvaluationCases(cases);
		expect(summary.accuracy).toBeNull();
		expect(summary.proposalPrecision).toBeNull();
		expect(summary.pipelineAbstentionRate).toBeNull();
		expect(summary.providerAbstentionRate).toBeNull();
		expect(summary.reportedCostUsd).toEqual({ total: 0, reportedCases: 0 });
	});

	it("ignores nonnumeric usage fields instead of treating them as cost", () => {
		const summary = summarizeEvaluationCases([
			{
				caseId: "cached",
				action: "click",
				tags: [],
				expectedRef: null,
				actualRef: null,
				outcome: "correct-abstention",
				status: "no-candidates",
				requestMade: false,
				requestBytes: 0,
				elapsedMilliseconds: 1,
				matchProbability: null,
				candidateCount: 0,
				omittedCandidateCount: 0,
				provenance: null,
				usage: { cache_hit: true, cost_usd: "unknown" },
			},
		]);

		expect(summary.usageTotals).toEqual({});
		expect(summary.reportedCostUsd).toEqual({ total: 0, reportedCases: 0 });
	});
});
