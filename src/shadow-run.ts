// pattern: Imperative Shell
import { runInspection } from "./inspection.js";
import { buildSelectionRequest, parseSelectionResponse } from "./selection.js";
import type { BrowserObserver, JevEvaluator, Result, ShadowPlan, ShadowReport } from "./types.js";

export async function runShadowSelection(
	plan: ShadowPlan,
	ports: { browser: BrowserObserver; jev: JevEvaluator },
): Promise<Result<ShadowReport>> {
	const inspected = await runInspection(plan, ports.browser);
	if (!inspected.ok) return inspected;

	const base = {
		mode: "shadow" as const,
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
				matchProbability: null,
				provenance: null,
				usage: null,
			},
		};
	}

	const request = buildSelectionRequest({
		goal: plan.step.goal,
		action: plan.step.action,
		pageUrl: inspected.value.observedUrl,
		pageTitle: inspected.value.pageTitle,
		candidates: inspected.value.candidates,
	});
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
			matchProbability: selection.value.matchProbability,
			provenance: selection.value.provenance,
			usage: selection.value.usage,
		},
	};
}
