// pattern: Functional Core
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

export function summarizeEvaluationCases(cases: EvaluationCaseResult[]): EvaluationSummary {
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
	};
}
