// pattern: Functional Core

import { estimateUsageCost, type SelectorPricing } from "./pricing.js";
import type { BrowserAction, Failure } from "./types.js";

export type EvaluationOutcome =
	| "correct-abstention"
	| "correct-selection"
	| "error"
	| "false-selection"
	| "missed-selection"
	| "wrong-selection";

export type EvaluationCaseStatus = "abstained" | "error" | "no-candidates" | "proposed";

export interface EvaluationCaseResult {
	caseId: string;
	action: BrowserAction;
	tags: string[];
	expectedRef: string | null;
	actualRef: string | null;
	outcome: EvaluationOutcome;
	status: EvaluationCaseStatus;
	requestMade: boolean;
	requestBytes: number;
	elapsedMilliseconds: number;
	matchProbability: number | null;
	candidateCount: number;
	omittedCandidateCount: number;
	provenance: Record<string, unknown> | null;
	usage: unknown;
	failure?: Failure;
}

export interface EvaluationSummary {
	totalCases: number;
	completedCases: number;
	correct: number;
	incorrect: number;
	errors: number;
	accuracy: number | null;
	proposals: number;
	explicitAbstentions: number;
	noCandidateCases: number;
	proposalPrecision: number | null;
	pipelineAbstentionRate: number | null;
	providerAbstentionRate: number | null;
	requestsMade: number;
	totalRequestBytes: number;
	totalElapsedMilliseconds: number;
	meanElapsedMilliseconds: number | null;
	usageTotals: Record<string, number>;
	reportedCostUsd: { total: number; reportedCases: number };
	cache: {
		reportedRequests: number;
		hits: number;
		misses: number;
		unreportedRequests: number;
		hitRate: number | null;
		coldElapsedMilliseconds: number;
		meanColdElapsedMilliseconds: number | null;
	};
	apiListPriceUsd: {
		total: number;
		pricedRequests: number;
		totalRequests: number;
		complete: boolean;
	} | null;
}

function divide(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : numerator / denominator;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function reportedCost(usage: unknown): number | null {
	if (!isRecord(usage)) return null;
	if (finiteNumber(usage.total_cost_usd)) return usage.total_cost_usd;
	return finiteNumber(usage.cost_usd) ? usage.cost_usd : null;
}

export function classifyEvaluationOutcome(
	expectedRef: string | null,
	actualRef: string | null,
): Exclude<EvaluationOutcome, "error"> {
	if (expectedRef === null) return actualRef === null ? "correct-abstention" : "false-selection";
	if (actualRef === null) return "missed-selection";
	return actualRef === expectedRef ? "correct-selection" : "wrong-selection";
}

export function summarizeEvaluationCases(
	cases: EvaluationCaseResult[],
	pricing?: SelectorPricing,
): EvaluationSummary {
	let correct = 0;
	let proposals = 0;
	let correctProposals = 0;
	let explicitAbstentions = 0;
	let noCandidateCases = 0;
	let requestsMade = 0;
	let totalRequestBytes = 0;
	let totalElapsedMilliseconds = 0;
	let reportedCostTotal = 0;
	let reportedCostCases = 0;
	let cacheHits = 0;
	let cacheMisses = 0;
	let cacheUnreportedRequests = 0;
	let coldElapsedMilliseconds = 0;
	let apiListPriceTotal = 0;
	let pricedRequests = 0;
	const usageTotals: Record<string, number> = {};

	for (const result of cases) {
		if (result.outcome === "correct-selection" || result.outcome === "correct-abstention") {
			correct += 1;
		}
		if (result.status === "proposed") {
			proposals += 1;
			if (result.outcome === "correct-selection") correctProposals += 1;
		}
		if (result.status === "abstained") explicitAbstentions += 1;
		if (result.status === "no-candidates") noCandidateCases += 1;
		if (result.requestMade) requestsMade += 1;
		totalRequestBytes += result.requestBytes;
		totalElapsedMilliseconds += result.elapsedMilliseconds;

		if (isRecord(result.usage)) {
			for (const [key, value] of Object.entries(result.usage)) {
				if (finiteNumber(value)) usageTotals[key] = (usageTotals[key] ?? 0) + value;
			}
		}
		const cost = reportedCost(result.usage);
		if (cost !== null) {
			reportedCostTotal += cost;
			reportedCostCases += 1;
		}
		if (result.requestMade) {
			if (isRecord(result.provenance) && typeof result.provenance.cache_hit === "boolean") {
				if (result.provenance.cache_hit) cacheHits += 1;
				else {
					cacheMisses += 1;
					coldElapsedMilliseconds += result.elapsedMilliseconds;
				}
			} else cacheUnreportedRequests += 1;
			if (pricing) {
				const estimated = estimateUsageCost(result.usage, pricing);
				if (estimated.ok) {
					apiListPriceTotal += estimated.value.totalUsd;
					pricedRequests += 1;
				}
			}
		}
	}

	const errors = cases.filter((result) => result.status === "error").length;
	const completedCases = cases.length - errors;
	const incorrect = completedCases - correct;
	const providerDecisions = proposals + explicitAbstentions;
	return {
		totalCases: cases.length,
		completedCases,
		correct,
		incorrect,
		errors,
		accuracy: divide(correct, completedCases),
		proposals,
		explicitAbstentions,
		noCandidateCases,
		proposalPrecision: divide(correctProposals, proposals),
		pipelineAbstentionRate: divide(explicitAbstentions + noCandidateCases, completedCases),
		providerAbstentionRate: divide(explicitAbstentions, providerDecisions),
		requestsMade,
		totalRequestBytes,
		totalElapsedMilliseconds,
		meanElapsedMilliseconds: divide(totalElapsedMilliseconds, cases.length),
		usageTotals,
		reportedCostUsd: { total: reportedCostTotal, reportedCases: reportedCostCases },
		cache: {
			reportedRequests: cacheHits + cacheMisses,
			hits: cacheHits,
			misses: cacheMisses,
			unreportedRequests: cacheUnreportedRequests,
			hitRate: divide(cacheHits, cacheHits + cacheMisses),
			coldElapsedMilliseconds,
			meanColdElapsedMilliseconds: divide(coldElapsedMilliseconds, cacheMisses),
		},
		apiListPriceUsd: pricing
			? {
					total: Number(apiListPriceTotal.toFixed(12)),
					pricedRequests,
					totalRequests: requestsMade,
					complete: pricedRequests === requestsMade,
				}
			: null,
	};
}
