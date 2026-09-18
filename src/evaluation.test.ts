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
				choiceConfidence: 0.8,
				choiceProbabilities: { a: 0.9, none: 0.1 },
				matchProbability: 0.9,
				matchProbabilitySource: "unambiguous-noul",
				candidateCount: 1,
				omittedCandidateCount: 0,
				provenance: { provider: "fixture", cache_hit: false },
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
				choiceConfidence: 0.6,
				choiceProbabilities: { b: 0.4, none: 0.6 },
				matchProbability: 0.2,
				matchProbabilitySource: "unambiguous-noul",
				candidateCount: 2,
				omittedCandidateCount: 0,
				provenance: { provider: "fixture", cache_hit: true },
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
				choiceConfidence: null,
				choiceProbabilities: null,
				matchProbability: null,
				matchProbabilitySource: null,
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
				choiceConfidence: null,
				choiceProbabilities: null,
				matchProbability: null,
				matchProbabilitySource: null,
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
			cache: {
				reportedRequests: 2,
				hits: 1,
				misses: 1,
				unreportedRequests: 1,
				hitRate: 0.5,
				coldElapsedMilliseconds: 10,
				meanColdElapsedMilliseconds: 10,
			},
			apiListPriceUsd: null,
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
				choiceConfidence: null,
				choiceProbabilities: null,
				matchProbability: null,
				matchProbabilitySource: null,
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
		expect(summary.cache).toEqual({
			reportedRequests: 0,
			hits: 0,
			misses: 0,
			unreportedRequests: 0,
			hitRate: null,
			coldElapsedMilliseconds: 0,
			meanColdElapsedMilliseconds: null,
		});
		expect(summary.apiListPriceUsd).toBeNull();
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
				choiceConfidence: null,
				choiceProbabilities: null,
				matchProbability: null,
				matchProbabilitySource: null,
				candidateCount: 0,
				omittedCandidateCount: 0,
				provenance: null,
				usage: { cache_hit: true, cost_usd: "unknown" },
			},
		]);

		expect(summary.usageTotals).toEqual({});
		expect(summary.reportedCostUsd).toEqual({ total: 0, reportedCases: 0 });
	});

	it("estimates token cost only from an explicit selector rate schedule", () => {
		const summary = summarizeEvaluationCases(
			[
				{
					caseId: "priced",
					action: "click",
					tags: [],
					expectedRef: "a",
					actualRef: "a",
					outcome: "correct-selection",
					status: "proposed",
					requestMade: true,
					requestBytes: 100,
					elapsedMilliseconds: 4,
					choiceConfidence: 0.8,
					choiceProbabilities: { a: 0.9, none: 0.1 },
					matchProbability: 0.9,
					matchProbabilitySource: "unambiguous-noul",
					candidateCount: 1,
					omittedCandidateCount: 0,
					provenance: { cache_hit: false, requested_model: "fixture" },
					usage: { input_tokens: 1_000, output_tokens: 100 },
				},
			],
			{
				model: "fixture",
				sourceUrl: "https://example.com/pricing",
				components: [
					{ usageField: "input_tokens", usdPerMillion: 0.2 },
					{ usageField: "output_tokens", usdPerMillion: 1.2 },
				],
			},
		);

		expect(summary.apiListPriceUsd).toEqual({
			total: 0.00032,
			pricedRequests: 1,
			totalRequests: 1,
			complete: true,
		});
	});

	it("does not apply a rate schedule to a different reported model", () => {
		const summary = summarizeEvaluationCases(
			[
				{
					caseId: "mismatch",
					action: "click",
					tags: [],
					expectedRef: "a",
					actualRef: "a",
					outcome: "correct-selection",
					status: "proposed",
					requestMade: true,
					requestBytes: 100,
					elapsedMilliseconds: 4,
					choiceConfidence: 1,
					choiceProbabilities: { a: 1, none: 0 },
					matchProbability: 1,
					matchProbabilitySource: "unambiguous-noul",
					candidateCount: 1,
					omittedCandidateCount: 0,
					provenance: { requested_model: "different-model" },
					usage: { input_tokens: 1_000, output_tokens: 100 },
				},
			],
			{
				model: "priced-model",
				sourceUrl: "https://example.com/pricing",
				components: [
					{ usageField: "input_tokens", usdPerMillion: 0.2 },
					{ usageField: "output_tokens", usdPerMillion: 1.2 },
				],
			},
		);

		expect(summary.apiListPriceUsd).toEqual({
			total: 0,
			pricedRequests: 0,
			totalRequests: 1,
			complete: false,
		});
	});
});
