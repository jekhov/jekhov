// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { buildMiniwobTaskPlan, MINIWOB_REVISION } from "./miniwob.js";

const base = {
	pageUrl: "http://127.0.0.1:43123/miniwob/task.html",
	actionTimeoutMs: 5_000,
};

describe("buildMiniwobTaskPlan", () => {
	it("pins the same MiniWoB++ revision as BrowserGym", () => {
		expect(MINIWOB_REVISION).toBe("7fd85d71a4b60325c6585396ec4f48377d049838");
	});

	it.each([
		[
			"click-test",
			"Click the button.",
			[{ action: "click", target: { role: "button", name: "Click Me!" } }],
		],
		[
			"click-button",
			'Click on the "Next" button.',
			[{ action: "click", target: { role: "button", name: "Next" } }],
		],
		[
			"enter-text",
			'Enter "Ada" into the text field and press Submit.',
			[
				{ action: "fill", value: "Ada", target: { role: "textbox", name: "textbox" } },
				{ action: "click", target: { role: "button", name: "Submit" } },
			],
		],
		[
			"choose-list",
			"Select Finland from the list and click Submit.",
			[
				{ action: "select", value: "Finland", target: { role: "combobox", name: "combobox" } },
				{ action: "click", target: { role: "button", name: "Submit" } },
			],
		],
	] as const)("builds deterministic %s steps from its goal", (taskName, goal, expected) => {
		const result = buildMiniwobTaskPlan({ ...base, taskName, goal });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("MiniWoB plan should build");
		expect(result.value.steps).toMatchObject(expected);
		expect(result.value.budget.maxSteps).toBe(expected.length);
		expect(result.value.budget.maxJevRequests).toBe(expected.length);
	});

	it("builds one check per named checkbox before submit", () => {
		const result = buildMiniwobTaskPlan({
			...base,
			taskName: "click-checkboxes",
			goal: "Select alpha, beta and click Submit.",
			checkboxSelectors: { alpha: "#ch0", beta: "#ch2" },
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("checkbox plan should build");
		expect(result.value.steps.at(-1)?.goal).toBe("Click the Submit button to finish the task");
		expect(result.value.steps).toMatchObject([
			{
				action: "check",
				checked: true,
				target: { role: "checkbox", name: "alpha" },
				postconditions: [{ type: "checked", selector: "#ch0", equals: true }],
			},
			{
				action: "check",
				checked: true,
				target: { role: "checkbox", name: "beta" },
				postconditions: [{ type: "checked", selector: "#ch2", equals: true }],
			},
			{ action: "click", target: { role: "button", name: "Submit" } },
		]);
	});

	it("handles the no-checkbox task variant", () => {
		const result = buildMiniwobTaskPlan({
			...base,
			taskName: "click-checkboxes",
			goal: "Select nothing and click Submit.",
			checkboxSelectors: {},
		});
		expect(result.ok && result.value.steps).toHaveLength(1);
		expect(result.ok && result.value.steps[0]?.action).toBe("click");
	});

	it.each([
		[{ ...base, taskName: "unsupported", goal: "Do it" }, "unsupported MiniWoB task"],
		[
			{ ...base, pageUrl: "https://example.com/task", taskName: "click-test", goal: "Click" },
			"MiniWoB page must be served from loopback HTTP",
		],
		[
			{ ...base, taskName: "click-button", goal: "Click any button" },
			"could not parse click-button goal",
		],
		[
			{ ...base, taskName: "enter-text", goal: "Enter some text" },
			"could not parse enter-text goal",
		],
		[
			{ ...base, taskName: "choose-list", goal: "Choose something" },
			"could not parse choose-list goal",
		],
		[
			{ ...base, actionTimeoutMs: 100, taskName: "click-test", goal: "Click" },
			"action timeout must be 250-30000 milliseconds",
		],
		[
			{
				...base,
				taskName: "click-checkboxes",
				goal: "Select alpha and click Submit.",
				checkboxSelectors: {},
			},
			"checkbox alpha has no deterministic selector",
		],
	] as const)("rejects unsupported or unparseable cases", (input, message) => {
		expect(buildMiniwobTaskPlan(input)).toEqual({
			ok: false,
			error: { code: "invalid-miniwob-case", message },
		});
	});
});
