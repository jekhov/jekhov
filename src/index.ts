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
export type { InspectionReport } from "./inspection.js";
export { runInspection } from "./inspection.js";
export {
	createBundledJevEvaluator,
	createJevCliEvaluator,
	createSelectionCliEvaluator,
} from "./jev-cli-evaluator.js";
export { JEV_MODEL, MAX_JEV_REQUEST_BYTES } from "./jev-policy.js";
export { createPlaywrightObserver, createPlaywrightPageObserver } from "./playwright-observer.js";
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
	CandidateSet,
	DataClass,
	JevEvaluator,
	PageObservation,
	ParsedSelection,
	Result,
	SelectionRequest,
	ShadowPlan,
	ShadowReport,
	SourcePolicy,
} from "./types.js";
