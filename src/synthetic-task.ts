// pattern: Functional Core
import { parseShadowPlan } from "./policy.js";
import type { BrowserAction, DataClass, PageObservation, Result, SourcePolicy } from "./types.js";

const MAX_TASK_STEPS = 20;
const MAX_TEXT_LENGTH = 500;
const MAX_SELECTOR_LENGTH = 200;

export type SyntheticTaskPostcondition =
	| { type: "checked"; selector: string; equals: boolean }
	| { type: "text"; selector: string; equals: string }
	| { type: "value"; selector: string; equals: string }
	| { type: "visible"; selector: string; equals: boolean };

export interface SyntheticTaskStep {
	id: string;
	action: BrowserAction;
	goal: string;
	value?: string;
	checked?: boolean;
	target: { role: string; name: string };
	postconditions: SyntheticTaskPostcondition[];
}

export interface SyntheticTaskPlan {
	version: 1;
	mode: "synthetic-task";
	goal: string;
	startUrl: string;
	dataClass: "synthetic";
	sourcePolicy: SourcePolicy & { basis: "synthetic" };
	budget: { maxSteps: number; maxJevRequests: number; actionTimeoutMs: number };
	steps: SyntheticTaskStep[];
}

export type SyntheticTaskAction =
	| { action: "click"; ref: string; timeoutMs: number }
	| { action: "fill" | "select"; ref: string; value: string; timeoutMs: number }
	| { action: "check"; ref: string; checked: boolean; timeoutMs: number };

export interface SyntheticTaskPage {
	observe(): Promise<Result<PageObservation>>;
	currentUrl(): string;
	act(action: SyntheticTaskAction): Promise<Result<undefined>>;
	verify(postcondition: SyntheticTaskPostcondition): Promise<Result<undefined>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonemptyBoundedString(value: unknown, maximum = MAX_TEXT_LENGTH): value is string {
	return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function invalid<T>(message: string): Result<T> {
	return { ok: false, error: { code: "invalid-synthetic-task", message } };
}

function parsePostcondition(value: unknown): SyntheticTaskPostcondition | undefined {
	if (
		!isRecord(value) ||
		!nonemptyBoundedString(value.selector, MAX_SELECTOR_LENGTH) ||
		(value.type !== "checked" &&
			value.type !== "text" &&
			value.type !== "value" &&
			value.type !== "visible")
	) {
		return undefined;
	}
	if (value.type === "checked" || value.type === "visible") {
		return typeof value.equals === "boolean"
			? { type: value.type, selector: value.selector, equals: value.equals }
			: undefined;
	}
	return typeof value.equals === "string" && value.equals.length <= MAX_TEXT_LENGTH
		? { type: value.type, selector: value.selector, equals: value.equals }
		: undefined;
}

export function parseSyntheticTaskPlan(input: unknown): Result<SyntheticTaskPlan> {
	if (!isRecord(input)) return invalid("task must be a JSON object");
	if (input.version !== 1) return invalid("task.version must be 1");
	if (input.mode !== "synthetic-task") return invalid("task.mode must be synthetic-task");
	if (input.dataClass !== "synthetic") return invalid("synthetic tasks require synthetic data");
	if (typeof input.startUrl !== "string" || !input.startUrl.startsWith("data:")) {
		return invalid("synthetic tasks require a data URL");
	}
	if (!Array.isArray(input.steps) || input.steps.length === 0) {
		return invalid("task.steps must contain at least one step");
	}
	if (!isRecord(input.budget)) return invalid("task.budget is required");
	const { actionTimeoutMs, maxJevRequests, maxSteps } = input.budget;
	if (
		!Number.isInteger(maxSteps) ||
		(maxSteps as number) < 1 ||
		(maxSteps as number) > MAX_TASK_STEPS
	) {
		return invalid(`budget.maxSteps must be 1-${MAX_TASK_STEPS}`);
	}
	if (
		!Number.isInteger(maxJevRequests) ||
		(maxJevRequests as number) < 1 ||
		(maxJevRequests as number) > MAX_TASK_STEPS
	) {
		return invalid(`budget.maxJevRequests must be 1-${MAX_TASK_STEPS}`);
	}
	if (
		!Number.isInteger(actionTimeoutMs) ||
		(actionTimeoutMs as number) < 250 ||
		(actionTimeoutMs as number) > 30_000
	) {
		return invalid("budget.actionTimeoutMs must be 250-30000");
	}
	if (input.steps.length > (maxSteps as number)) {
		return invalid("task.steps exceeds budget.maxSteps");
	}
	if (input.steps.length > (maxJevRequests as number)) {
		return invalid("task.steps exceeds budget.maxJevRequests");
	}

	const firstStep = input.steps[0];
	if (!isRecord(firstStep)) return invalid("task steps must be JSON objects");
	const base = parseShadowPlan({ ...input, mode: "shadow", step: firstStep });
	if (!base.ok) return invalid(base.error.message);
	if (base.value.sourcePolicy.allowedHosts.length !== 0) {
		return invalid("synthetic tasks require an empty host allowlist");
	}
	const steps: SyntheticTaskStep[] = [];
	for (const rawStep of input.steps) {
		if (!isRecord(rawStep)) return invalid("task steps must be JSON objects");
		const parsedStep = parseShadowPlan({ ...input, mode: "shadow", step: rawStep });
		if (!parsedStep.ok) return invalid(parsedStep.error.message);
		const step = parsedStep.value.step;
		if (!isRecord(rawStep.target)) return invalid(`step ${step.id} requires a labeled target`);
		if (
			!nonemptyBoundedString(rawStep.target.role, 40) ||
			!nonemptyBoundedString(rawStep.target.name, 160)
		) {
			return invalid(`step ${step.id} has an invalid labeled target`);
		}
		if (step.action === "click") {
			if (Object.hasOwn(rawStep, "value") || Object.hasOwn(rawStep, "checked")) {
				return invalid(`click step ${step.id} must not declare value or checked`);
			}
		} else if (step.action === "fill" || step.action === "select") {
			if (typeof rawStep.value !== "string" || rawStep.value.length > MAX_TEXT_LENGTH) {
				return invalid(`${step.action} step ${step.id} requires value`);
			}
			if (Object.hasOwn(rawStep, "checked")) {
				return invalid(`${step.action} step ${step.id} must not declare checked`);
			}
		} else {
			if (typeof rawStep.checked !== "boolean") {
				return invalid(`check step ${step.id} requires checked`);
			}
			if (Object.hasOwn(rawStep, "value")) {
				return invalid(`check step ${step.id} must not declare value`);
			}
		}
		if (!Array.isArray(rawStep.postconditions) || rawStep.postconditions.length === 0) {
			return invalid(`step ${step.id} requires at least one deterministic postcondition`);
		}
		const postconditions = rawStep.postconditions.map(parsePostcondition);
		if (postconditions.some((value) => value === undefined)) {
			return invalid(`step ${step.id} has an invalid postcondition`);
		}
		steps.push({
			...step,
			...(step.action === "fill" || step.action === "select"
				? { value: rawStep.value as string }
				: {}),
			...(step.action === "check" ? { checked: rawStep.checked as boolean } : {}),
			target: {
				role: (rawStep.target.role as string).trim(),
				name: (rawStep.target.name as string).trim(),
			},
			postconditions: postconditions as SyntheticTaskPostcondition[],
		});
	}
	if (new Set(steps.map((step) => step.id)).size !== steps.length) {
		return invalid("task step IDs must be unique");
	}

	return {
		ok: true,
		value: {
			version: 1,
			mode: "synthetic-task",
			goal: base.value.goal,
			startUrl: base.value.startUrl,
			dataClass: "synthetic",
			sourcePolicy: base.value.sourcePolicy as SourcePolicy & { basis: "synthetic" },
			budget: {
				maxSteps: maxSteps as number,
				maxJevRequests: maxJevRequests as number,
				actionTimeoutMs: actionTimeoutMs as number,
			},
			steps,
		},
	};
}

export function taskDataClass(_plan: SyntheticTaskPlan): DataClass {
	return "synthetic";
}
