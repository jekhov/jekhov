// pattern: Imperative Shell
import { collectActionCandidates } from "./candidates.js";
import { validateObservedUrl } from "./policy.js";
import type { ActionCandidate, BrowserObserver, Result, ShadowPlan } from "./types.js";

export interface InspectionReport {
	mode: "inspect";
	executed: false;
	stepId: string;
	observedUrl: string;
	pageTitle: string;
	candidates: ActionCandidate[];
	omittedCandidateCount: number;
}

export async function runInspection(
	plan: ShadowPlan,
	browser: BrowserObserver,
): Promise<Result<InspectionReport>> {
	const observed = await browser.observe(plan.startUrl);
	if (!observed.ok) return observed;
	const allowed = validateObservedUrl(observed.value.url, plan);
	if (!allowed.ok) return allowed;
	const collected = collectActionCandidates(observed.value.snapshot, { action: plan.step.action });
	if (!collected.ok) return collected;
	return {
		ok: true,
		value: {
			mode: "inspect",
			executed: false,
			stepId: plan.step.id,
			observedUrl: observed.value.url,
			pageTitle: observed.value.title,
			candidates: collected.value.candidates,
			omittedCandidateCount: collected.value.omittedCount,
		},
	};
}
