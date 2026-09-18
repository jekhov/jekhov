// pattern: Functional Core

export type {
	CascadeActionSummary,
	CascadeCalibration,
	CascadeCostSummary,
	CascadeOperatingPoint,
	CascadeOutcomeSummary,
	CascadeRoutingSummary,
} from "./calibration.js";
export { buildCascadeCalibration, DEFAULT_CASCADE_THRESHOLDS } from "./calibration.js";
export { collectActionCandidates } from "./candidates.js";
export type {
	EvaluationCaseResult,
	EvaluationOutcome,
	EvaluationSummary,
} from "./evaluation.js";
export { classifyEvaluationOutcome, summarizeEvaluationCases } from "./evaluation.js";
export type {
	EvaluationCase,
	EvaluationCorpus,
	EvaluationLabel,
} from "./evaluation-corpus.js";
export { parseEvaluationCorpus } from "./evaluation-corpus.js";
export type {
	EvaluationReport,
	EvaluationSelector,
	EvaluationSelectorReport,
} from "./evaluation-run.js";
export { runEvaluationCorpus } from "./evaluation-run.js";
export { createJevCliEvaluator, createSelectionCliEvaluator } from "./jev-cli-evaluator.js";
export { createPlaywrightObserver } from "./playwright-observer.js";
export { parseShadowPlan, validateObservedUrl } from "./policy.js";
export type {
	EvaluationPricing,
	PricingComponent,
	SelectorPricing,
	UsageCostComponent,
	UsageCostEstimate,
} from "./pricing.js";
export { estimateUsageCost, parseEvaluationPricing } from "./pricing.js";
export { buildSelectionRequest, parseSelectionResponse } from "./selection.js";
export { runShadowSelection } from "./shadow-run.js";
export type {
	ActionCandidate,
	BrowserAction,
	BrowserObserver,
	DataClass,
	JevEvaluator,
	Result,
	ShadowPlan,
	ShadowReport,
	SourcePolicy,
} from "./types.js";
