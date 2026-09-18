// pattern: Imperative Shell
import { collectActionCandidates } from "./candidates.js";
import { parseShadowPlan, validateObservedFrames, validateObservedUrl } from "./policy.js";
import { createReportMetadata } from "./report-metadata.js";
import { minimizeUrl } from "./selection.js";
import type { ActionCandidate, BrowserObserver, Result } from "./types.js";

export interface InspectionReport {
	version: 1;
	jekhovVersion: string;
	generatedAt: string;
	planSha256: string;
	sourcePolicySha256: string;
	mode: "inspect";
	executed: false;
	stepId: string;
	observedUrl: string;
	pageTitle: string;
	candidates: ActionCandidate[];
	omittedCandidateCount: number;
}

export async function runInspection(
	input: unknown,
	browser: BrowserObserver,
	options: { generatedAt?: () => Date } = {},
): Promise<Result<InspectionReport>> {
	const parsed = parseShadowPlan(input);
	if (!parsed.ok) return parsed;
	const plan = parsed.value;
	const observed = await browser.observe(plan.startUrl);
	if (!observed.ok) return observed;
	const allowed = validateObservedUrl(observed.value.url, plan);
	if (!allowed.ok) return allowed;
	const frames = validateObservedFrames(observed.value.frameUrls ?? [observed.value.url], plan);
	if (!frames.ok) return frames;
	const collected = collectActionCandidates(observed.value.snapshot, { action: plan.step.action });
	if (!collected.ok) return collected;
	const candidates = collected.value.candidates.map((candidate) => ({
		...candidate,
		...(candidate.url ? { url: minimizeUrl(candidate.url) } : {}),
	}));
	return {
		ok: true,
		value: {
			version: 1,
			...createReportMetadata(plan, plan.sourcePolicy, options.generatedAt),
			mode: "inspect",
			executed: false,
			stepId: plan.step.id,
			observedUrl: minimizeUrl(observed.value.url),
			pageTitle: observed.value.title,
			candidates,
			omittedCandidateCount: collected.value.omittedCount,
		},
	};
}
