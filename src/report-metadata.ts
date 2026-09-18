// pattern: Functional Core
import { createHash } from "node:crypto";
import { minimizeUrl } from "./selection.js";
import type { SyntheticTaskPlan } from "./synthetic-task.js";
import type { ShadowPlan, SourcePolicy } from "./types.js";

export const JEKHOV_VERSION = "0.1.0";

export interface ReportMetadata {
	jekhovVersion: string;
	generatedAt: string;
	planSha256: string;
	sourcePolicySha256: string;
}

function sha256(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeSourcePolicy(sourcePolicy: SourcePolicy): Record<string, unknown> {
	return {
		allowedHosts: sourcePolicy.allowedHosts,
		basis: sourcePolicy.basis,
		...(sourcePolicy.providerDisclosure
			? { providerDisclosure: sourcePolicy.providerDisclosure }
			: {}),
		reviewedAt: sourcePolicy.reviewedAt,
	};
}

function safePlanStructure(
	plan: ShadowPlan | SyntheticTaskPlan,
	sourcePolicy: SourcePolicy,
): Record<string, unknown> {
	const base = {
		version: plan.version,
		mode: plan.mode,
		dataClass: plan.dataClass,
		startUrl: minimizeUrl(plan.startUrl),
		sourcePolicy: safeSourcePolicy(sourcePolicy),
	};
	if (plan.mode === "shadow") return { ...base, step: { action: plan.step.action } };
	return {
		...base,
		budget: plan.budget,
		steps: plan.steps.map((step) => ({
			action: step.action,
			postconditions: step.postconditions.map((postcondition) => ({ type: postcondition.type })),
		})),
	};
}

export function createReportMetadata(
	plan: ShadowPlan | SyntheticTaskPlan,
	sourcePolicy: SourcePolicy,
	generatedAt: () => Date = () => new Date(),
): ReportMetadata {
	return {
		jekhovVersion: JEKHOV_VERSION,
		generatedAt: generatedAt().toISOString(),
		planSha256: sha256(safePlanStructure(plan, sourcePolicy)),
		sourcePolicySha256: sha256(safeSourcePolicy(sourcePolicy)),
	};
}
