// pattern: Imperative Shell
import { runInspection } from "./inspection.js";
import { parseShadowPlan } from "./policy.js";
import { buildSelectionRequest, parseSelectionResponse } from "./selection.js";
import type {
	BrowserObserver,
	JevEvaluator,
	Result,
	SelectionProfile,
	ShadowReport,
} from "./types.js";

export async function runShadowSelection(
	input: unknown,
	ports: { browser: BrowserObserver; jev: JevEvaluator },
	options: { selectionProfile?: SelectionProfile } = {},
): Promise<Result<ShadowReport>> {
	const parsed = parseShadowPlan(input);
	if (!parsed.ok) return parsed;
	const plan = parsed.value;
	const inspected = await runInspection(plan, ports.browser);
	if (!inspected.ok) return inspected;

	const base = {
		mode: "shadow" as const,
		selectionProfile: options.selectionProfile ?? "choice-with-ambiguity",
		executed: false as const,
		stepId: plan.step.id,
		observedUrl: inspected.value.observedUrl,
		pageTitle: inspected.value.pageTitle,
		candidateCount: inspected.value.candidates.length,
		omittedCandidateCount: inspected.value.omittedCandidateCount,
	};
	if (inspected.value.candidates.length === 0) {
		return {
			ok: true,
			value: {
				...base,
				status: "no-candidates",
				requestBytes: 0,
				proposal: null,
				choiceConfidence: null,
				choiceProbabilities: null,
				matchProbability: null,
				matchProbabilitySource: null,
				provenance: null,
				usage: null,
			},
		};
	}

	const requestInput = {
		goal: plan.step.goal,
		action: plan.step.action,
		pageUrl: inspected.value.observedUrl,
		pageTitle: inspected.value.pageTitle,
		candidates: inspected.value.candidates,
	};
	const request =
		base.selectionProfile === "choice-only"
			? buildSelectionRequest(requestInput, { profile: "choice-only" })
			: buildSelectionRequest(requestInput, { profile: "choice-with-ambiguity" });
	const evaluated = await ports.jev.evaluate(request, plan.dataClass);
	if (!evaluated.ok) return evaluated;
	const selection = parseSelectionResponse(evaluated.value, inspected.value.candidates);
	if (!selection.ok) return selection;

	return {
		ok: true,
		value: {
			...base,
			status: selection.value.candidate ? "proposed" : "abstained",
			requestBytes: Buffer.byteLength(JSON.stringify(request)),
			proposal: selection.value.candidate,
			choiceConfidence: selection.value.choiceConfidence,
			choiceProbabilities: selection.value.choiceProbabilities,
			matchProbability: selection.value.matchProbability,
			matchProbabilitySource: selection.value.matchProbabilitySource,
			provenance: selection.value.provenance,
			usage: selection.value.usage,
		},
	};
}
