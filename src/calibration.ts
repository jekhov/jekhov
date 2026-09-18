// pattern: Functional Core
import { type EvaluationCaseResult, summarizeEvaluationCases } from "./evaluation.js";
import type { EvaluationSelectorReport } from "./evaluation-run.js";
import { type EvaluationPricing, estimateUsageCost } from "./pricing.js";
import type { BrowserAction, Result } from "./types.js";

export const DEFAULT_CASCADE_THRESHOLDS = Object.freeze(
	Array.from({ length: 21 }, (_, index) => index / 20),
);

export interface CascadeOutcomeSummary {
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
}

export interface CascadeRoutingSummary {
	primaryRequests: number;
	fallbackRequests: number;
	fallbackRate: number | null;
	reasons: {
		primaryError: number;
		primaryAbstention: number;
		lowMatchProbability: number;
	};
}

export interface CascadeActionSummary {
	action: BrowserAction;
	outcomes: CascadeOutcomeSummary;
	routing: CascadeRoutingSummary;
}

export interface CascadeCostSummary {
	total: number;
	primary: number;
	fallback: number;
	pricedRequests: number;
	totalRequests: number;
	complete: boolean;
}

export interface CascadeOperatingPoint {
	threshold: number;
	outcomes: CascadeOutcomeSummary;
	routing: CascadeRoutingSummary;
	resources: {
		primaryElapsedMilliseconds: number;
		fallbackElapsedMilliseconds: number;
		totalElapsedMilliseconds: number;
		primaryRequestBytes: number;
		fallbackRequestBytes: number;
		totalRequestBytes: number;
		usageBySelector: Record<string, Record<string, number>>;
	};
	apiListPriceUsd: CascadeCostSummary | null;
	byAction: CascadeActionSummary[];
}

export interface CascadeCalibration {
	primarySelector: string;
	fallbackSelector: string;
	rule: "fallback-on-primary-error-abstention-or-match-probability-below-threshold";
	operatingPoints: CascadeOperatingPoint[];
}

type EscalationReason = "lowMatchProbability" | "primaryAbstention" | "primaryError";

interface PairedDecision {
	primary: EvaluationCaseResult;
	fallback: EvaluationCaseResult;
	final: EvaluationCaseResult;
	reason: EscalationReason | null;
}

function invalid<T>(message: string): Result<T> {
	return { ok: false, error: { code: "invalid-calibration", message } };
}

function divide(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : numerator / denominator;
}

function numericUsageTotals(cases: EvaluationCaseResult[]): Record<string, number> {
	const totals: Record<string, number> = {};
	for (const result of cases) {
		if (typeof result.usage !== "object" || result.usage === null || Array.isArray(result.usage)) {
			continue;
		}
		for (const [key, value] of Object.entries(result.usage)) {
			if (typeof value === "number" && Number.isFinite(value)) {
				totals[key] = (totals[key] ?? 0) + value;
			}
		}
	}
	return totals;
}

function outcomeSummary(cases: EvaluationCaseResult[]): CascadeOutcomeSummary {
	const summary = summarizeEvaluationCases(cases);
	return {
		totalCases: summary.totalCases,
		completedCases: summary.completedCases,
		correct: summary.correct,
		incorrect: summary.incorrect,
		errors: summary.errors,
		accuracy: summary.accuracy,
		proposals: summary.proposals,
		explicitAbstentions: summary.explicitAbstentions,
		noCandidateCases: summary.noCandidateCases,
		proposalPrecision: summary.proposalPrecision,
	};
}

function escalationReason(
	primary: EvaluationCaseResult,
	threshold: number,
): Result<EscalationReason | null> {
	if (primary.status === "error") return { ok: true, value: "primaryError" };
	if (primary.status === "abstained") return { ok: true, value: "primaryAbstention" };
	if (primary.status === "no-candidates") return { ok: true, value: null };
	if (primary.matchProbability === null) {
		return invalid(`primary proposal ${primary.caseId} is missing match probability`);
	}
	return {
		ok: true,
		value: primary.matchProbability < threshold ? "lowMatchProbability" : null,
	};
}

function pairAtThreshold(
	primaryCases: EvaluationCaseResult[],
	fallbackCases: EvaluationCaseResult[],
	threshold: number,
): Result<PairedDecision[]> {
	const pairs: PairedDecision[] = [];
	for (const [index, primary] of primaryCases.entries()) {
		const fallback = fallbackCases[index];
		if (!fallback || primary.caseId !== fallback.caseId) {
			return invalid(`selector case alignment differs at index ${index}`);
		}
		if (
			primary.action !== fallback.action ||
			primary.expectedRef !== fallback.expectedRef ||
			primary.candidateCount !== fallback.candidateCount
		) {
			return invalid(`selector case metadata differs for ${primary.caseId}`);
		}
		const reason = escalationReason(primary, threshold);
		if (!reason.ok) return reason;
		pairs.push({
			primary,
			fallback,
			final: reason.value ? fallback : primary,
			reason: reason.value,
		});
	}
	return { ok: true, value: pairs };
}

function routingSummary(pairs: PairedDecision[]): CascadeRoutingSummary {
	const primaryRequests = pairs.filter((pair) => pair.primary.requestMade).length;
	const routed = pairs.filter((pair) => pair.reason !== null);
	const fallbackRequests = routed.filter((pair) => pair.fallback.requestMade).length;
	return {
		primaryRequests,
		fallbackRequests,
		fallbackRate: divide(fallbackRequests, primaryRequests),
		reasons: {
			primaryError: routed.filter((pair) => pair.reason === "primaryError").length,
			primaryAbstention: routed.filter((pair) => pair.reason === "primaryAbstention").length,
			lowMatchProbability: routed.filter((pair) => pair.reason === "lowMatchProbability").length,
		},
	};
}

function selectorCost(
	cases: EvaluationCaseResult[],
	pricing: EvaluationPricing["selectors"][string],
): { total: number; pricedRequests: number; totalRequests: number; complete: boolean } {
	let total = 0;
	let pricedRequests = 0;
	const requested = cases.filter((result) => result.requestMade);
	for (const result of requested) {
		const estimate = estimateUsageCost(result.usage, pricing);
		if (!estimate.ok) continue;
		total += estimate.value.totalUsd;
		pricedRequests += 1;
	}
	return {
		total: Number(total.toFixed(12)),
		pricedRequests,
		totalRequests: requested.length,
		complete: pricedRequests === requested.length,
	};
}

function apiListPrice(
	pairs: PairedDecision[],
	primaryName: string,
	fallbackName: string,
	pricing?: EvaluationPricing,
): CascadeCostSummary | null {
	const primaryPricing = pricing?.selectors[primaryName];
	const fallbackPricing = pricing?.selectors[fallbackName];
	if (!primaryPricing || !fallbackPricing) return null;
	const primary = selectorCost(
		pairs.map((pair) => pair.primary),
		primaryPricing,
	);
	const fallback = selectorCost(
		pairs.filter((pair) => pair.reason !== null).map((pair) => pair.fallback),
		fallbackPricing,
	);
	return {
		total: Number((primary.total + fallback.total).toFixed(12)),
		primary: primary.total,
		fallback: fallback.total,
		pricedRequests: primary.pricedRequests + fallback.pricedRequests,
		totalRequests: primary.totalRequests + fallback.totalRequests,
		complete: primary.complete && fallback.complete,
	};
}

function actionSummaries(pairs: PairedDecision[]): CascadeActionSummary[] {
	const actions: BrowserAction[] = ["click", "fill", "select", "check"];
	return actions.flatMap((action) => {
		const actionPairs = pairs.filter((pair) => pair.primary.action === action);
		if (actionPairs.length === 0) return [];
		return [
			{
				action,
				outcomes: outcomeSummary(actionPairs.map((pair) => pair.final)),
				routing: routingSummary(actionPairs),
			},
		];
	});
}

export function buildCascadeCalibration(
	primary: EvaluationSelectorReport,
	fallback: EvaluationSelectorReport,
	options: { thresholds?: readonly number[]; pricing?: EvaluationPricing } = {},
): Result<CascadeCalibration> {
	const thresholds = options.thresholds ?? DEFAULT_CASCADE_THRESHOLDS;
	if (
		thresholds.length < 1 ||
		new Set(thresholds).size !== thresholds.length ||
		!thresholds.every((threshold) => Number.isFinite(threshold) && threshold >= 0 && threshold <= 1)
	) {
		return invalid("thresholds must be unique finite numbers from 0 through 1");
	}
	if (primary.cases.length !== fallback.cases.length) {
		return invalid("selector case counts differ");
	}

	const operatingPoints: CascadeOperatingPoint[] = [];
	for (const threshold of thresholds) {
		const paired = pairAtThreshold(primary.cases, fallback.cases, threshold);
		if (!paired.ok) return paired;
		const fallbackCases = paired.value
			.filter((pair) => pair.reason !== null)
			.map((pair) => pair.fallback);
		const primaryElapsedMilliseconds = primary.cases.reduce(
			(total, result) => total + result.elapsedMilliseconds,
			0,
		);
		const fallbackElapsedMilliseconds = fallbackCases.reduce(
			(total, result) => total + result.elapsedMilliseconds,
			0,
		);
		const primaryRequestBytes = primary.cases.reduce(
			(total, result) => total + result.requestBytes,
			0,
		);
		const fallbackRequestBytes = fallbackCases.reduce(
			(total, result) => total + result.requestBytes,
			0,
		);
		operatingPoints.push({
			threshold,
			outcomes: outcomeSummary(paired.value.map((pair) => pair.final)),
			routing: routingSummary(paired.value),
			resources: {
				primaryElapsedMilliseconds,
				fallbackElapsedMilliseconds,
				totalElapsedMilliseconds: primaryElapsedMilliseconds + fallbackElapsedMilliseconds,
				primaryRequestBytes,
				fallbackRequestBytes,
				totalRequestBytes: primaryRequestBytes + fallbackRequestBytes,
				usageBySelector: {
					[primary.name]: numericUsageTotals(primary.cases),
					[fallback.name]: numericUsageTotals(fallbackCases),
				},
			},
			apiListPriceUsd: apiListPrice(paired.value, primary.name, fallback.name, options.pricing),
			byAction: actionSummaries(paired.value),
		});
	}

	return {
		ok: true,
		value: {
			primarySelector: primary.name,
			fallbackSelector: fallback.name,
			rule: "fallback-on-primary-error-abstention-or-match-probability-below-threshold",
			operatingPoints,
		},
	};
}
