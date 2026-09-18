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
import { JEKHOV_VERSION } from "./report-metadata.js";
import { projectSafeFailure, projectSafeProvenance } from "./selection.js";
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
	jekhovVersion: string;
	generatedAt: string;
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
		generatedAt?: () => Date;
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
	const requestBounds = new Map<string, number>();
	for (const selector of selectors) {
		const name = selector.name.trim();
		if (!name) return invalid("selector names must be nonempty");
		if (names.has(name)) return invalid(`selector names must be unique: ${name}`);
		names.add(name);
		const requestBound = selector.evaluator.maximumRequestCount ?? 1;
		if (!Number.isSafeInteger(requestBound) || requestBound < 1 || requestBound > 20) {
			return invalid(`selector ${name} request bound must be 1-20`);
		}
		requestBounds.set(name, requestBound);
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
			let requestCount = 0;
			let requestBytes = 0;
			const requestBound = requestBounds.get(selector.name.trim()) ?? 1;
			const trackingEvaluator: JevEvaluator = {
				maximumRequestCount: requestBound,
				async evaluate(request: SelectionRequest, dataClass) {
					requestMade = true;
					requestBytes = Buffer.byteLength(JSON.stringify(request));
					const evaluated = await selector.evaluator.evaluate(request, dataClass);
					if (!evaluated.ok) {
						requestCount = evaluated.error.telemetry?.requestCount ?? requestBound;
						return evaluated;
					}
					const reported =
						typeof evaluated.value === "object" &&
						evaluated.value !== null &&
						!Array.isArray(evaluated.value)
							? (evaluated.value as Record<string, unknown>).request_count
							: undefined;
					requestCount =
						Number.isSafeInteger(reported) &&
						(reported as number) >= 1 &&
						(reported as number) <= requestBound
							? (reported as number)
							: 1;
					return evaluated;
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
					requestCount,
					requestBytes,
					elapsedMilliseconds,
					choiceConfidence: null,
					choiceProbabilities: null,
					matchProbability: null,
					matchProbabilitySource: null,
					candidateCount: candidates.value.candidates.length,
					omittedCandidateCount: candidates.value.omittedCount,
					provenance: result.error.telemetry
						? projectSafeProvenance(result.error.telemetry.provenance)
						: null,
					usage: result.error.telemetry?.usage ?? null,
					failure: projectSafeFailure(result.error),
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
				requestCount,
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
			jekhovVersion: JEKHOV_VERSION,
			generatedAt: (options.generatedAt ?? (() => new Date()))().toISOString(),
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
				maximumRequests:
					[...requestBounds.values()].reduce((sum, value) => sum + value, 0) *
					validatedCorpus.cases.length,
			},
			pricing: pricing ?? null,
			selectors: selectorReports,
			cascade,
		},
	};
}
