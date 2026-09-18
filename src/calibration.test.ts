// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { buildCascadeCalibration, DEFAULT_CASCADE_THRESHOLDS } from "./calibration.js";
import type { EvaluationCaseResult } from "./evaluation.js";
import type { EvaluationSelectorReport } from "./evaluation-run.js";
import { parseEvaluationPricing } from "./pricing.js";

function result(
	input: Partial<EvaluationCaseResult> & Pick<EvaluationCaseResult, "caseId" | "expectedRef">,
): EvaluationCaseResult {
	const actualRef = input.actualRef ?? null;
	return {
		caseId: input.caseId,
		action: input.action ?? "click",
		tags: input.tags ?? [],
		expectedRef: input.expectedRef,
		actualRef,
		outcome:
			input.outcome ??
			(input.expectedRef === null
				? actualRef === null
					? "correct-abstention"
					: "false-selection"
				: actualRef === input.expectedRef
					? "correct-selection"
					: actualRef === null
						? "missed-selection"
						: "wrong-selection"),
		status: input.status ?? (actualRef === null ? "abstained" : "proposed"),
		requestMade: input.requestMade ?? true,
		requestBytes: input.requestBytes ?? 100,
		elapsedMilliseconds: input.elapsedMilliseconds ?? 10,
		choiceConfidence: input.choiceConfidence ?? null,
		choiceProbabilities: input.choiceProbabilities ?? null,
		matchProbability: Object.hasOwn(input, "matchProbability")
			? (input.matchProbability ?? null)
			: 0.5,
		matchProbabilitySource: input.matchProbabilitySource ?? "unambiguous-noul",
		candidateCount: input.candidateCount ?? 2,
		omittedCandidateCount: input.omittedCandidateCount ?? 0,
		provenance: input.provenance ?? { provider: "fixture" },
		usage: Object.hasOwn(input, "usage")
			? (input.usage ?? null)
			: { input_tokens: 10, output_tokens: 2 },
		...(input.failure ? { failure: input.failure } : {}),
	};
}

function report(name: string, cases: EvaluationCaseResult[]): EvaluationSelectorReport {
	return {
		name,
		cases,
		summary: {
			totalCases: cases.length,
			completedCases: cases.length,
			correct: 0,
			incorrect: 0,
			errors: 0,
			accuracy: null,
			proposals: 0,
			explicitAbstentions: 0,
			noCandidateCases: 0,
			proposalPrecision: null,
			pipelineAbstentionRate: null,
			providerAbstentionRate: null,
			requestsMade: 0,
			totalRequestBytes: 0,
			totalElapsedMilliseconds: 0,
			meanElapsedMilliseconds: null,
			usageTotals: {},
			reportedCostUsd: { total: 0, reportedCases: 0 },
			cache: {
				reportedRequests: 0,
				hits: 0,
				misses: 0,
				unreportedRequests: 0,
				hitRate: null,
				coldElapsedMilliseconds: 0,
				meanColdElapsedMilliseconds: null,
			},
			apiListPriceUsd: null,
		},
	};
}

describe("buildCascadeCalibration", () => {
	it("routes low-probability proposals, abstentions, and errors to the fallback", () => {
		const primary = report("jev", [
			result({
				caseId: "high",
				expectedRef: "a",
				actualRef: "a",
				matchProbability: 0.9,
			}),
			result({
				caseId: "low",
				expectedRef: null,
				actualRef: "b",
				matchProbability: 0.3,
			}),
			result({
				caseId: "abstained",
				expectedRef: "c",
				actualRef: null,
				status: "abstained",
				matchProbability: 0.2,
			}),
			result({
				caseId: "error",
				expectedRef: "d",
				status: "error",
				outcome: "error",
				matchProbability: null,
				usage: null,
				failure: { code: "offline", message: "offline" },
			}),
			result({
				caseId: "empty",
				expectedRef: null,
				status: "no-candidates",
				requestMade: false,
				requestBytes: 0,
				candidateCount: 0,
				matchProbability: null,
				usage: null,
			}),
		]);
		const fallback = report("baseline", [
			result({ caseId: "high", expectedRef: "a", actualRef: "a" }),
			result({ caseId: "low", expectedRef: null, actualRef: null }),
			result({ caseId: "abstained", expectedRef: "c", actualRef: "c" }),
			result({ caseId: "error", expectedRef: "d", actualRef: "d" }),
			result({
				caseId: "empty",
				expectedRef: null,
				status: "no-candidates",
				requestMade: false,
				requestBytes: 0,
				candidateCount: 0,
				matchProbability: null,
				usage: null,
			}),
		]);

		const calibration = buildCascadeCalibration(primary, fallback, { thresholds: [0, 0.5] });

		expect(calibration.ok).toBe(true);
		if (!calibration.ok) throw new Error("calibration should succeed");
		expect(calibration.value.rule).toBe(
			"fallback-on-primary-error-abstention-or-match-probability-below-threshold",
		);
		expect(calibration.value.operatingPoints[0]).toMatchObject({
			threshold: 0,
			outcomes: { correct: 4, incorrect: 1, errors: 0, accuracy: 0.8 },
			routing: {
				primaryRequests: 4,
				fallbackRequests: 2,
				fallbackRate: 0.5,
				reasons: { primaryError: 1, primaryAbstention: 1, lowMatchProbability: 0 },
			},
		});
		expect(calibration.value.operatingPoints[1]).toMatchObject({
			threshold: 0.5,
			outcomes: {
				correct: 5,
				incorrect: 0,
				errors: 0,
				accuracy: 1,
				proposalPrecision: 1,
			},
			routing: {
				primaryRequests: 4,
				fallbackRequests: 3,
				fallbackRate: 0.75,
				reasons: { primaryError: 1, primaryAbstention: 1, lowMatchProbability: 1 },
			},
		});
		expect(calibration.value.operatingPoints[1]?.byAction).toEqual([
			expect.objectContaining({
				action: "click",
				outcomes: expect.objectContaining({ correct: 5, accuracy: 1 }),
				routing: expect.objectContaining({ fallbackRequests: 3, fallbackRate: 0.75 }),
			}),
		]);
	});

	it("combines explicit selector pricing only for fallback cases actually routed", () => {
		const primary = report("jev", [
			result({
				caseId: "high",
				expectedRef: "a",
				actualRef: "a",
				matchProbability: 0.9,
				usage: { input_tokens: 1_000, output_tokens: 20 },
			}),
			result({
				caseId: "low",
				expectedRef: null,
				actualRef: "b",
				matchProbability: 0.3,
				usage: { input_tokens: 1_000, output_tokens: 20 },
			}),
		]);
		const fallback = report("baseline", [
			result({
				caseId: "high",
				expectedRef: "a",
				actualRef: "a",
				usage: { input_tokens: 10_000, output_tokens: 100 },
			}),
			result({
				caseId: "low",
				expectedRef: null,
				actualRef: null,
				usage: { input_tokens: 10_000, output_tokens: 100 },
			}),
		]);
		const pricing = parseEvaluationPricing({
			version: 1,
			currency: "USD",
			asOf: "2026-09-18",
			selectors: {
				jev: {
					model: "jev-1.13.0",
					sourceUrl: "https://typesafe.ai/pricing",
					components: [{ usageField: "input_tokens", usdPerMillion: 0.042 }],
				},
				baseline: {
					model: "gpt-5.6-luna",
					sourceUrl: "https://developers.openai.com/api/docs/pricing",
					components: [
						{ usageField: "input_tokens", usdPerMillion: 0.2 },
						{ usageField: "output_tokens", usdPerMillion: 1.2 },
					],
				},
			},
		});
		if (!pricing.ok) throw new Error("pricing should parse");

		const calibration = buildCascadeCalibration(primary, fallback, {
			thresholds: [0.5],
			pricing: pricing.value,
		});

		expect(calibration.ok).toBe(true);
		if (!calibration.ok) throw new Error("calibration should succeed");
		expect(calibration.value.operatingPoints[0]?.apiListPriceUsd).toEqual({
			total: 0.002204,
			primary: 0.000084,
			fallback: 0.00212,
			pricedRequests: 3,
			totalRequests: 3,
			complete: true,
		});
	});

	it("rejects misaligned reports and invalid threshold grids", () => {
		const primary = report("jev", [result({ caseId: "one", expectedRef: null })]);
		const fallback = report("baseline", [result({ caseId: "two", expectedRef: null })]);

		expect(buildCascadeCalibration(primary, fallback, { thresholds: [0.5] })).toEqual({
			ok: false,
			error: {
				code: "invalid-calibration",
				message: "selector case alignment differs at index 0",
			},
		});
		expect(buildCascadeCalibration(primary, primary, { thresholds: [1.1] })).toEqual({
			ok: false,
			error: {
				code: "invalid-calibration",
				message: "thresholds must be unique finite numbers from 0 through 1",
			},
		});
		expect(buildCascadeCalibration(primary, report("baseline", []), { thresholds: [0.5] })).toEqual(
			{
				ok: false,
				error: { code: "invalid-calibration", message: "selector case counts differ" },
			},
		);
		expect(
			buildCascadeCalibration(
				report("jev", [result({ caseId: "one", action: "click", expectedRef: null })]),
				report("baseline", [result({ caseId: "one", action: "fill", expectedRef: null })]),
				{ thresholds: [0.5] },
			),
		).toEqual({
			ok: false,
			error: { code: "invalid-calibration", message: "selector case metadata differs for one" },
		});
		expect(
			buildCascadeCalibration(
				report("jev", [
					result({
						caseId: "one",
						expectedRef: "a",
						actualRef: "a",
						matchProbability: null,
					}),
				]),
				report("baseline", [result({ caseId: "one", expectedRef: "a", actualRef: "a" })]),
				{ thresholds: [0.5] },
			),
		).toEqual({
			ok: false,
			error: {
				code: "invalid-calibration",
				message: "primary proposal one is missing match probability",
			},
		});
	});

	it("exports a deterministic 0.05 threshold grid", () => {
		expect(DEFAULT_CASCADE_THRESHOLDS).toHaveLength(21);
		expect(DEFAULT_CASCADE_THRESHOLDS[0]).toBe(0);
		expect(DEFAULT_CASCADE_THRESHOLDS[8]).toBe(0.4);
		expect(DEFAULT_CASCADE_THRESHOLDS[20]).toBe(1);
	});
});
