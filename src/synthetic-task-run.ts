// pattern: Imperative Shell
import { collectActionCandidates } from "./candidates.js";
import { validateObservedUrl } from "./policy.js";
import { buildSelectionRequest, parseSelectionResponse } from "./selection.js";
import type {
	SyntheticTaskAction,
	SyntheticTaskPage,
	SyntheticTaskPlan,
	SyntheticTaskStep,
} from "./synthetic-task.js";
import { parseSyntheticTaskPlan, taskDataClass } from "./synthetic-task.js";
import type {
	ActionCandidate,
	Failure,
	JevEvaluator,
	MatchProbabilitySource,
	Result,
	ShadowPlan,
} from "./types.js";

export interface SyntheticTaskStepReport {
	stepId: string;
	action: SyntheticTaskStep["action"];
	executed: boolean;
	actionConfirmed: boolean;
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
	failure: Failure | null;
}

export interface SyntheticTaskReport {
	mode: "synthetic-task";
	status: "completed" | "stopped";
	goal: string;
	executed: boolean;
	stepCount: number;
	executedStepCount: number;
	confirmedStepCount: number;
	jevRequestCount: number;
	steps: SyntheticTaskStepReport[];
	stop: Failure | null;
}

function shadowPlan(plan: SyntheticTaskPlan, step: SyntheticTaskStep): ShadowPlan {
	return {
		version: 1,
		mode: "shadow",
		goal: plan.goal,
		startUrl: plan.startUrl,
		dataClass: plan.dataClass,
		sourcePolicy: plan.sourcePolicy,
		step: { id: step.id, action: step.action, goal: step.goal },
	};
}

function taskAction(step: SyntheticTaskStep, ref: string, timeoutMs: number): SyntheticTaskAction {
	if (step.action === "fill" || step.action === "select") {
		return { action: step.action, ref, value: step.value ?? "", timeoutMs };
	}
	if (step.action === "check") {
		return { action: "check", ref, checked: step.checked ?? true, timeoutMs };
	}
	return { action: "click", ref, timeoutMs };
}

function validateTaskUrl(value: string, plan: SyntheticTaskPlan, step: SyntheticTaskStep) {
	const validated = validateObservedUrl(value, shadowPlan(plan, step));
	if (!validated.ok) return validated;
	return value === plan.startUrl
		? validated
		: {
				ok: false as const,
				error: {
					code: "task-url-changed",
					message: `task URL changed during step ${step.id}`,
				},
			};
}

function requestCount(value: unknown, maximum: number): number {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return 1;
	const count = (value as Record<string, unknown>).request_count;
	return Number.isSafeInteger(count) && (count as number) >= 1 && (count as number) <= maximum
		? (count as number)
		: 1;
}

export async function runSyntheticTask(
	input: unknown,
	ports: { page: SyntheticTaskPage; jev: JevEvaluator },
): Promise<Result<SyntheticTaskReport>> {
	const parsed = parseSyntheticTaskPlan(input);
	if (!parsed.ok) return parsed;
	return runValidatedSyntheticTask(parsed.value, ports);
}

export async function runValidatedSyntheticTask(
	plan: SyntheticTaskPlan,
	ports: { page: SyntheticTaskPage; jev: JevEvaluator },
): Promise<Result<SyntheticTaskReport>> {
	const reports: SyntheticTaskStepReport[] = [];
	let executedStepCount = 0;
	let confirmedStepCount = 0;
	let jevRequestCount = 0;
	const maximumRequestCount = ports.jev.maximumRequestCount ?? 1;
	if (
		!Number.isSafeInteger(maximumRequestCount) ||
		maximumRequestCount < 1 ||
		maximumRequestCount > 20
	) {
		return {
			ok: false,
			error: {
				code: "invalid-evaluator-request-bound",
				message: "selector request bound must fit the task request budget",
			},
		};
	}

	const finish = (failure: Failure | null): Result<SyntheticTaskReport> => ({
		ok: true,
		value: {
			mode: "synthetic-task",
			status: failure ? "stopped" : "completed",
			goal: plan.goal,
			executed: executedStepCount > 0,
			stepCount: plan.steps.length,
			executedStepCount,
			confirmedStepCount,
			jevRequestCount,
			steps: reports,
			stop: failure,
		},
	});

	for (const step of plan.steps) {
		let candidateCount = 0;
		let omittedCandidateCount = 0;
		let requestBytes = 0;
		let proposal: ActionCandidate | null = null;
		let choiceConfidence: number | null = null;
		let choiceProbabilities: Record<string, number> | null = null;
		let matchProbability: number | null = null;
		let matchProbabilitySource: MatchProbabilitySource | null = null;
		let provenance: Record<string, unknown> | null = null;
		let usage: unknown = null;
		let executed = false;
		let actionConfirmed = false;
		const stop = (failure: Failure): Result<SyntheticTaskReport> => {
			reports.push({
				stepId: step.id,
				action: step.action,
				executed,
				actionConfirmed,
				candidateCount,
				omittedCandidateCount,
				requestBytes,
				proposal,
				choiceConfidence,
				choiceProbabilities,
				matchProbability,
				matchProbabilitySource,
				provenance,
				usage,
				failure,
			});
			return finish(failure);
		};

		const observed = await ports.page.observe();
		if (!observed.ok) return stop(observed.error);
		const allowed = validateTaskUrl(observed.value.url, plan, step);
		if (!allowed.ok) return stop(allowed.error);
		const collected = collectActionCandidates(observed.value.snapshot, { action: step.action });
		if (!collected.ok) return stop(collected.error);
		candidateCount = collected.value.candidates.length;
		omittedCandidateCount = collected.value.omittedCount;
		if (omittedCandidateCount > 0) {
			return stop({
				code: "candidate-set-truncated",
				message: "candidate truncation could hide the labeled target",
			});
		}
		if (candidateCount === 0) {
			return stop({ code: "no-candidates", message: `step ${step.id} has no action candidates` });
		}
		const oracleTargets = collected.value.candidates.filter(
			(candidate) => candidate.role === step.target.role && candidate.name === step.target.name,
		);
		if (oracleTargets.length !== 1) {
			return stop({
				code: "oracle-target-ambiguous",
				message: `labeled target for step ${step.id} resolved ${oracleTargets.length} candidates`,
			});
		}

		const request = buildSelectionRequest({
			goal: step.goal,
			action: step.action,
			pageUrl: observed.value.url,
			pageTitle: observed.value.title,
			candidates: collected.value.candidates,
		});
		requestBytes = Buffer.byteLength(JSON.stringify(request));
		if (jevRequestCount + maximumRequestCount > plan.budget.maxJevRequests) {
			return stop({
				code: "selector-request-budget-exhausted",
				message: `step ${step.id} cannot fit the selector request bound`,
			});
		}
		const evaluated = await ports.jev.evaluate(request, taskDataClass(plan));
		jevRequestCount += evaluated.ok
			? requestCount(evaluated.value, maximumRequestCount)
			: maximumRequestCount;
		if (!evaluated.ok) return stop(evaluated.error);
		const selected = parseSelectionResponse(evaluated.value, collected.value.candidates);
		if (!selected.ok) return stop(selected.error);
		proposal = selected.value.candidate;
		choiceConfidence = selected.value.choiceConfidence;
		choiceProbabilities = selected.value.choiceProbabilities;
		matchProbability = selected.value.matchProbability;
		matchProbabilitySource = selected.value.matchProbabilitySource;
		provenance = selected.value.provenance;
		usage = selected.value.usage;
		if (!proposal) {
			return stop({ code: "selector-abstained", message: `selector abstained on step ${step.id}` });
		}
		if (proposal.role !== step.target.role || proposal.name !== step.target.name) {
			return stop({
				code: "oracle-mismatch",
				message: `proposal does not match the labeled target for step ${step.id}`,
			});
		}

		const fresh = await ports.page.observe();
		if (!fresh.ok) return stop(fresh.error);
		const freshAllowed = validateTaskUrl(fresh.value.url, plan, step);
		if (!freshAllowed.ok) return stop(freshAllowed.error);
		const freshCandidates = collectActionCandidates(fresh.value.snapshot, { action: step.action });
		if (!freshCandidates.ok) return stop(freshCandidates.error);
		if (freshCandidates.value.omittedCount > 0) {
			return stop({
				code: "candidate-set-truncated",
				message: "fresh candidate truncation invalidated the proposal",
			});
		}
		const freshOracleTargets = freshCandidates.value.candidates.filter(
			(candidate) => candidate.role === step.target.role && candidate.name === step.target.name,
		);
		if (freshOracleTargets.length > 1) {
			return stop({
				code: "oracle-target-ambiguous",
				message: `fresh labeled target for step ${step.id} resolved ${freshOracleTargets.length} candidates`,
			});
		}
		const freshProposal = freshCandidates.value.candidates.find(
			(candidate) =>
				candidate.ref === proposal?.ref &&
				candidate.role === proposal.role &&
				candidate.name === proposal.name,
		);
		if (!freshProposal) {
			return stop({
				code: "stale-proposal",
				message: `selected element changed before step ${step.id} could execute`,
			});
		}

		executed = true;
		executedStepCount += 1;
		const acted = await ports.page.act(
			taskAction(step, freshProposal.ref, plan.budget.actionTimeoutMs),
		);
		if (!acted.ok) return stop(acted.error);
		actionConfirmed = true;
		confirmedStepCount += 1;
		const actionUrl = validateTaskUrl(ports.page.currentUrl(), plan, step);
		if (!actionUrl.ok) return stop(actionUrl.error);
		for (const postcondition of step.postconditions) {
			const verified = await ports.page.verify(postcondition);
			if (!verified.ok) return stop(verified.error);
		}
		reports.push({
			stepId: step.id,
			action: step.action,
			executed,
			actionConfirmed,
			candidateCount,
			omittedCandidateCount,
			requestBytes,
			proposal,
			choiceConfidence,
			choiceProbabilities,
			matchProbability,
			matchProbabilitySource,
			provenance,
			usage,
			failure: null,
		});
	}
	return finish(null);
}
