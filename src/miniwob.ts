// pattern: Functional Core
import type { SyntheticTaskPlan, SyntheticTaskStep } from "./synthetic-task.js";
import type { Result } from "./types.js";

export const MINIWOB_REVISION = "7fd85d71a4b60325c6585396ec4f48377d049838";
export const MINIWOB_TASKS = [
	"choose-list",
	"click-button",
	"click-checkboxes",
	"click-test",
	"enter-text",
] as const;

export type MiniwobTaskName = (typeof MINIWOB_TASKS)[number];

interface MiniwobPlanInput {
	taskName: string;
	goal: string;
	pageUrl: string;
	actionTimeoutMs: number;
	checkboxSelectors?: Record<string, string>;
}

function invalid<T>(message: string): Result<T> {
	return { ok: false, error: { code: "invalid-miniwob-case", message } };
}

function submitStep(index: number): SyntheticTaskStep {
	return {
		id: `step-${index}-submit`,
		action: "click",
		goal: "Click the Submit button to finish the task",
		target: { role: "button", name: "Submit" },
		postconditions: [{ type: "text", selector: "#episode-id", equals: "1" }],
	};
}

function parseQuoted(goal: string, pattern: RegExp): string | undefined {
	return goal.match(pattern)?.[1]?.trim();
}

export function buildMiniwobTaskPlan(input: MiniwobPlanInput): Result<SyntheticTaskPlan> {
	if (!(MINIWOB_TASKS as readonly string[]).includes(input.taskName)) {
		return invalid("unsupported MiniWoB task");
	}
	if (
		!Number.isInteger(input.actionTimeoutMs) ||
		input.actionTimeoutMs < 250 ||
		input.actionTimeoutMs > 30_000
	) {
		return invalid("action timeout must be 250-30000 milliseconds");
	}
	let url: URL;
	try {
		url = new URL(input.pageUrl);
	} catch {
		return invalid("MiniWoB page must be served from loopback HTTP");
	}
	if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
		return invalid("MiniWoB page must be served from loopback HTTP");
	}
	const steps: SyntheticTaskStep[] = [];
	if (input.taskName === "click-test") {
		steps.push({
			id: "step-1-click",
			action: "click",
			goal: input.goal,
			target: { role: "button", name: "Click Me!" },
			postconditions: [{ type: "text", selector: "#episode-id", equals: "1" }],
		});
	} else if (input.taskName === "click-button") {
		const name = parseQuoted(input.goal, /^Click on the "(.+)" button\.$/);
		if (!name) return invalid("could not parse click-button goal");
		steps.push({
			id: "step-1-click",
			action: "click",
			goal: input.goal,
			target: { role: "button", name },
			postconditions: [{ type: "text", selector: "#episode-id", equals: "1" }],
		});
	} else if (input.taskName === "enter-text") {
		const value = parseQuoted(input.goal, /^Enter "(.+)" into the text field and press Submit\.$/);
		if (!value) return invalid("could not parse enter-text goal");
		steps.push(
			{
				id: "step-1-fill",
				action: "fill",
				goal: `Enter ${JSON.stringify(value)} into the text field`,
				value,
				target: { role: "textbox", name: "textbox" },
				postconditions: [{ type: "value", selector: "#tt", equals: value }],
			},
			submitStep(2),
		);
	} else if (input.taskName === "choose-list") {
		const value = parseQuoted(input.goal, /^Select (.+) from the list and click Submit\.$/);
		if (!value) return invalid("could not parse choose-list goal");
		steps.push(
			{
				id: "step-1-select",
				action: "select",
				goal: `Select ${value} from the list`,
				value,
				target: { role: "combobox", name: "combobox" },
				postconditions: [{ type: "value", selector: "#options", equals: value }],
			},
			submitStep(2),
		);
	} else {
		const requested = input.goal.match(/^Select (.+) and click Submit\.$/)?.[1]?.trim();
		if (!requested) return invalid("could not parse click-checkboxes goal");
		const names = requested === "nothing" ? [] : requested.split(/,\s*/);
		for (const [index, name] of names.entries()) {
			const selector = input.checkboxSelectors?.[name];
			if (!selector) return invalid(`checkbox ${name} has no deterministic selector`);
			steps.push({
				id: `step-${index + 1}-check`,
				action: "check",
				goal: `Select the ${name} checkbox`,
				checked: true,
				target: { role: "checkbox", name },
				postconditions: [{ type: "checked", selector, equals: true }],
			});
		}
		steps.push(submitStep(steps.length + 1));
	}

	return {
		ok: true,
		value: {
			version: 1,
			mode: "synthetic-task",
			goal: input.goal,
			startUrl: input.pageUrl,
			dataClass: "synthetic",
			sourcePolicy: {
				allowedHosts: [url.hostname],
				basis: "synthetic",
				reviewedAt: "2026-09-18",
				note: `Pinned MiniWoB++ ${MINIWOB_REVISION} synthetic benchmark.`,
			},
			budget: {
				maxSteps: steps.length,
				maxJevRequests: steps.length,
				actionTimeoutMs: input.actionTimeoutMs,
			},
			steps,
		},
	};
}
