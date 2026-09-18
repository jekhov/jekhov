// pattern: Functional Core

export type BrowserAction = "check" | "click" | "fill" | "select";
export type DataClass = "public" | "synthetic";
export type SourcePolicyBasis =
	| "first-party"
	| "synthetic"
	| "terms-reviewed"
	| "written-permission";

export interface Failure {
	code: string;
	message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: Failure };

export interface SourcePolicy {
	allowedHosts: string[];
	basis: SourcePolicyBasis;
	reviewedAt: string;
	note: string;
}

export interface ShadowStep {
	id: string;
	action: BrowserAction;
	goal: string;
}

export interface ShadowPlan {
	version: 1;
	mode: "shadow";
	goal: string;
	startUrl: string;
	dataClass: DataClass;
	sourcePolicy: SourcePolicy;
	step: ShadowStep;
}

export interface ActionCandidate {
	id: string;
	ref: string;
	role: string;
	name: string;
	context: string[];
	url?: string;
	placeholder?: string;
	cursor?: string;
}

export interface CandidateSet {
	candidates: ActionCandidate[];
	omittedCount: number;
}

export interface PageObservation {
	url: string;
	title: string;
	snapshot: unknown;
}

export interface BrowserObserver {
	observe(url: string): Promise<Result<PageObservation>>;
}

export interface ChoiceQuestion {
	type: "choice";
	instructions: string;
	criteria: Record<string, string>;
}

export interface NoulQuestion {
	type: "noul";
	instructions: string;
}

export type SelectionProfile = "choice-only" | "choice-with-ambiguity";
export type MatchProbabilitySource = "choice-confidence" | "unambiguous-noul";

export interface SelectionState {
	goal: string;
	intended_action: BrowserAction;
	page: { title: string; url: string };
	candidates: Array<{
		id: string;
		role: string;
		name: string;
		context: string[];
		url?: string;
		placeholder?: string;
		cursor?: string;
	}>;
}

export interface ChoiceOnlySelectionRequest {
	state: SelectionState;
	questions: {
		next_element: ChoiceQuestion;
	};
}

export interface ChoiceWithAmbiguitySelectionRequest {
	state: SelectionState;
	questions: {
		next_element: ChoiceQuestion;
		unambiguous_match: NoulQuestion;
	};
}

export type SelectionRequest = ChoiceOnlySelectionRequest | ChoiceWithAmbiguitySelectionRequest;

export interface JevEvaluator {
	maximumRequestCount?: number;
	evaluate(request: SelectionRequest, dataClass: DataClass): Promise<Result<unknown>>;
}

export interface ParsedSelection {
	candidate: ActionCandidate | null;
	choiceConfidence: number | null;
	choiceProbabilities: Record<string, number> | null;
	matchProbability: number;
	matchProbabilitySource: MatchProbabilitySource;
	provenance: Record<string, unknown>;
	usage: unknown;
}

export interface ShadowReport {
	mode: "shadow";
	selectionProfile: SelectionProfile;
	status: "abstained" | "no-candidates" | "proposed";
	executed: false;
	stepId: string;
	observedUrl: string;
	pageTitle: string;
	candidateCount: number;
	omittedCandidateCount: number;
	requestBytes: number;
	proposal: ActionCandidate | null;
	choiceConfidence: number | null;
	choiceProbabilities: Record<string, number> | null;
	matchProbability: number | null;
	matchProbabilitySource: MatchProbabilitySource | null;
	provenance: Record<string, unknown> | null;
	usage: unknown;
}
