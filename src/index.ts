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
export { createThresholdCascadeEvaluator } from "./cascade-evaluator.js";
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
export type { MiniwobTaskName } from "./miniwob.js";
export { buildMiniwobTaskPlan, MINIWOB_REVISION, MINIWOB_TASKS } from "./miniwob.js";
export type {
	MiniwobBenchmarkCase,
	MiniwobBenchmarkReport,
} from "./miniwob-run.js";
export { captureMiniwobCorpus, runMiniwobBenchmark } from "./miniwob-run.js";
export { createPlaywrightObserver, createPlaywrightPageObserver } from "./playwright-observer.js";
export { runSyntheticTaskInNewBrowser } from "./playwright-task-page.js";
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
	SyntheticTaskPlan,
	SyntheticTaskPostcondition,
	SyntheticTaskStep,
} from "./synthetic-task.js";
export { parseSyntheticTaskPlan } from "./synthetic-task.js";
export type { SyntheticTaskReport, SyntheticTaskStepReport } from "./synthetic-task-run.js";
export type {
	ActionCandidate,
	BrowserAction,
	BrowserObserver,
	CandidateSet,
	DataClass,
	JevEvaluator,
	MatchProbabilitySource,
	PageObservation,
	ParsedSelection,
	Result,
	SelectionProfile,
	SelectionRequest,
	ShadowPlan,
	ShadowReport,
	SourcePolicy,
} from "./types.js";
