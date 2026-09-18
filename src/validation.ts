// pattern: Functional Core
import { parseEvaluationCorpus } from "./evaluation-corpus.js";
import { parseShadowPlan } from "./policy.js";
import { parseEvaluationPricing } from "./pricing.js";
import { JEKHOV_VERSION } from "./report-metadata.js";
import { parseSyntheticTaskPlan } from "./synthetic-task.js";
import type { BrowserAction, DataClass, Result } from "./types.js";

export type ValidationArtifactKind = "corpus" | "plan" | "pricing";

interface ValidationReportBase {
	version: 1;
	jekhovVersion: string;
	mode: "validation";
	valid: true;
	executed: false;
	browserOpened: false;
	providerRequestCount: 0;
}

export interface ShadowPlanValidationSummary {
	kind: "shadow-plan";
	dataClass: DataClass;
	actions: BrowserAction[];
	allowedHostCount: number;
}

export interface SyntheticTaskPlanValidationSummary {
	kind: "synthetic-task-plan";
	dataClass: "synthetic";
	actions: BrowserAction[];
	allowedHostCount: 0;
	stepCount: number;
	maximumProviderRequests: number;
}

export interface CorpusValidationSummary {
	kind: "evaluation-corpus";
	name: string;
	caseCount: number;
	actions: BrowserAction[];
}

export interface PricingValidationSummary {
	kind: "evaluation-pricing";
	currency: "USD";
	asOf: string;
	selectorCount: number;
}

export type ValidationArtifactSummary =
	| ShadowPlanValidationSummary
	| SyntheticTaskPlanValidationSummary
	| CorpusValidationSummary
	| PricingValidationSummary;

export interface ValidationReport extends ValidationReportBase {
	artifact: ValidationArtifactSummary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function report(artifact: ValidationReport["artifact"]): Result<ValidationReport> {
	return {
		ok: true,
		value: {
			version: 1,
			jekhovVersion: JEKHOV_VERSION,
			mode: "validation",
			valid: true,
			executed: false,
			browserOpened: false,
			providerRequestCount: 0,
			artifact,
		},
	};
}

function uniqueActions(actions: BrowserAction[]): BrowserAction[] {
	return [...new Set(actions)];
}

export function validateArtifact(
	kind: ValidationArtifactKind,
	input: unknown,
): Result<ValidationReport> {
	if (kind === "corpus") {
		const parsed = parseEvaluationCorpus(input);
		if (!parsed.ok) return parsed;
		return report({
			kind: "evaluation-corpus",
			name: parsed.value.name,
			caseCount: parsed.value.cases.length,
			actions: uniqueActions(parsed.value.cases.map((item) => item.plan.step.action)),
		});
	}
	if (kind === "pricing") {
		const parsed = parseEvaluationPricing(input);
		if (!parsed.ok) return parsed;
		return report({
			kind: "evaluation-pricing",
			currency: parsed.value.currency,
			asOf: parsed.value.asOf,
			selectorCount: Object.keys(parsed.value.selectors).length,
		});
	}

	if (!isRecord(input) || (input.mode !== "shadow" && input.mode !== "synthetic-task")) {
		return {
			ok: false,
			error: { code: "invalid-plan", message: "plan.mode must be shadow or synthetic-task" },
		};
	}
	if (input.mode === "shadow") {
		const parsed = parseShadowPlan(input);
		if (!parsed.ok) return parsed;
		return report({
			kind: "shadow-plan",
			dataClass: parsed.value.dataClass,
			actions: [parsed.value.step.action],
			allowedHostCount: parsed.value.sourcePolicy.allowedHosts.length,
		});
	}

	const parsed = parseSyntheticTaskPlan(input);
	if (!parsed.ok) return parsed;
	return report({
		kind: "synthetic-task-plan",
		dataClass: parsed.value.dataClass,
		actions: uniqueActions(parsed.value.steps.map((step) => step.action)),
		allowedHostCount: 0,
		stepCount: parsed.value.steps.length,
		maximumProviderRequests: parsed.value.budget.maxJevRequests,
	});
}
