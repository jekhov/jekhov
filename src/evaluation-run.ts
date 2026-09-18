// pattern: Imperative Shell
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
	buildCascadeCalibration,
	type CascadeCalibration,
	DEFAULT_CASCADE_THRESHOLDS,
} from "./calibration.js";
import { collectActionCandidates } from "./candidates.js";
import {
	classifyEvaluationOutcome,
	type EvaluationCaseResult,
	type EvaluationSummary,
	summarizeEvaluationCases,
} from "./evaluation.js";
import { type EvaluationCorpus, parseEvaluationCorpus } from "./evaluation-corpus.js";
import { type EvaluationPricing, parseEvaluationPricing } from "./pricing.js";
import { runShadowSelection } from "./shadow-run.js";
import type {
	BrowserObserver,
	JevEvaluator,
	Result,
	SelectionProfile,
	SelectionRequest,
} from "./types.js";

const MAX_SELECTORS = 8;

export interface EvaluationSelector {
	name: string;
	evaluator: JevEvaluator;
	selectionProfile?: SelectionProfile;
}

export interface EvaluationSelectorReport {
	name: string;
	summary: EvaluationSummary;
	cases: EvaluationCaseResult[];
}

export interface EvaluationReport {
	version: 2;
	mode: "shadow-evaluation";
	executed: false;
	corpus: { name: string; caseCount: number; sha256: string };
	requestBudget: { selectors: number; casesPerSelector: number; maximumRequests: number };
	pricing: EvaluationPricing | null;
	selectors: EvaluationSelectorReport[];
	cascade: CascadeCalibration | null;
}

function invalid(message: string): Result<EvaluationReport> {
	return { ok: false, error: { code: "invalid-evaluation", message } };
}

function replayObserver(
	observation: EvaluationCorpus["cases"][number]["observation"],
): BrowserObserver {
	return {
		async observe() {
			return { ok: true, value: observation };
		},
	};
}

export async function runEvaluationCorpus(
	corpus: EvaluationCorpus,
	selectors: EvaluationSelector[],
	options: {
		now?: () => number;
		pricing?: EvaluationPricing;
		cascade?: {
			primarySelector: string;
			fallbackSelector: string;
			thresholds?: readonly number[];
		};
	} = {},
): Promise<Result<EvaluationReport>> {
	const parsedCorpus = parseEvaluationCorpus(corpus);
	if (!parsedCorpus.ok) return parsedCorpus;
	const validatedCorpus = parsedCorpus.value;
	const corpusSha256 = createHash("sha256").update(JSON.stringify(validatedCorpus)).digest("hex");
	if (selectors.length < 1) return invalid("at least one selector is required");
	if (selectors.length > MAX_SELECTORS) {
		return invalid(`at most ${MAX_SELECTORS} selectors are supported`);
	}
	const names = new Set<string>();
	for (const selector of selectors) {
		const name = selector.name.trim();
		if (!name) return invalid("selector names must be nonempty");
		if (names.has(name)) return invalid(`selector names must be unique: ${name}`);
		names.add(name);
	}
	if (
		options.cascade &&
		(!names.has(options.cascade.primarySelector) || !names.has(options.cascade.fallbackSelector))
	) {
		return invalid("cascade selectors must name selectors in this evaluation");
	}
	const parsedPricing = options.pricing ? parseEvaluationPricing(options.pricing) : null;
	if (parsedPricing && !parsedPricing.ok) return parsedPricing;
	const pricing = parsedPricing?.ok ? parsedPricing.value : undefined;

	const now = options.now ?? (() => performance.now());
	const selectorReports: EvaluationSelectorReport[] = [];
	for (const selector of selectors) {
		const caseResults: EvaluationCaseResult[] = [];
		for (const evaluationCase of validatedCorpus.cases) {
			const candidates = collectActionCandidates(evaluationCase.observation.snapshot, {
				action: evaluationCase.plan.step.action,
			});
			if (!candidates.ok) return candidates;
			let requestMade = false;
			let requestBytes = 0;
			const trackingEvaluator: JevEvaluator = {
				evaluate(request: SelectionRequest, dataClass) {
					requestMade = true;
					requestBytes = Buffer.byteLength(JSON.stringify(request));
					return selector.evaluator.evaluate(request, dataClass);
				},
			};
			const startedAt = now();
			const result = await runShadowSelection(
				evaluationCase.plan,
				{
					browser: replayObserver(evaluationCase.observation),
					jev: trackingEvaluator,
				},
				{
					selectionProfile: selector.selectionProfile ?? "choice-with-ambiguity",
				},
			);
			const elapsedMilliseconds = Math.max(0, now() - startedAt);

			if (!result.ok) {
				caseResults.push({
					caseId: evaluationCase.id,
					action: evaluationCase.plan.step.action,
					tags: evaluationCase.tags,
					expectedRef: evaluationCase.label.expectedRef,
					actualRef: null,
					outcome: "error",
					status: "error",
					requestMade,
					requestBytes,
					elapsedMilliseconds,
					choiceConfidence: null,
					choiceProbabilities: null,
					matchProbability: null,
					matchProbabilitySource: null,
					candidateCount: candidates.value.candidates.length,
					omittedCandidateCount: candidates.value.omittedCount,
					provenance: null,
					usage: null,
					failure: result.error,
				});
				continue;
			}

			const actualRef = result.value.proposal?.ref ?? null;
			caseResults.push({
				caseId: evaluationCase.id,
				action: evaluationCase.plan.step.action,
				tags: evaluationCase.tags,
				expectedRef: evaluationCase.label.expectedRef,
				actualRef,
				outcome: classifyEvaluationOutcome(evaluationCase.label.expectedRef, actualRef),
				status: result.value.status,
				requestMade,
				requestBytes,
				elapsedMilliseconds,
				choiceConfidence: result.value.choiceConfidence,
				choiceProbabilities: result.value.choiceProbabilities,
				matchProbability: result.value.matchProbability,
				matchProbabilitySource: result.value.matchProbabilitySource,
				candidateCount: candidates.value.candidates.length,
				omittedCandidateCount: candidates.value.omittedCount,
				provenance: result.value.provenance,
				usage: result.value.usage,
			});
		}
		selectorReports.push({
			name: selector.name.trim(),
			summary: summarizeEvaluationCases(caseResults, pricing?.selectors[selector.name.trim()]),
			cases: caseResults,
		});
	}
	let cascade: CascadeCalibration | null = null;
	if (options.cascade) {
		const primary = selectorReports.find(
			(selector) => selector.name === options.cascade?.primarySelector,
		);
		const fallback = selectorReports.find(
			(selector) => selector.name === options.cascade?.fallbackSelector,
		);
		if (!primary || !fallback) {
			return invalid("cascade selectors must name selectors in this evaluation");
		}
		const calibrated = buildCascadeCalibration(primary, fallback, {
			thresholds: options.cascade.thresholds ?? DEFAULT_CASCADE_THRESHOLDS,
			...(pricing ? { pricing } : {}),
		});
		if (!calibrated.ok) return calibrated;
		cascade = calibrated.value;
	}

	return {
		ok: true,
		value: {
			version: 2,
			mode: "shadow-evaluation",
			executed: false,
			corpus: {
				name: validatedCorpus.name,
				caseCount: validatedCorpus.cases.length,
				sha256: corpusSha256,
			},
			requestBudget: {
				selectors: selectors.length,
				casesPerSelector: validatedCorpus.cases.length,
				maximumRequests: selectors.length * validatedCorpus.cases.length,
			},
			pricing: pricing ?? null,
			selectors: selectorReports,
			cascade,
		},
	};
}
