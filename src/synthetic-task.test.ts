// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { parseSyntheticTaskPlan } from "./synthetic-task.js";

const validPlan = {
	version: 1,
	mode: "synthetic-task",
	goal: "Submit a synthetic product search",
	startUrl: "data:text/html,fixture",
	dataClass: "synthetic",
	sourcePolicy: {
		allowedHosts: [],
		basis: "synthetic",
		reviewedAt: "2026-09-18",
		note: "Repository-owned synthetic task fixture.",
	},
	budget: { maxSteps: 4, maxJevRequests: 4, actionTimeoutMs: 5_000 },
	steps: [
		{
			id: "query",
			action: "fill",
			goal: "Enter the product query",
			value: "boots",
			target: { role: "textbox", name: "Product" },
			postconditions: [{ type: "value", selector: "#query", equals: "boots" }],
		},
		{
			id: "submit",
			action: "click",
			goal: "Submit the search",
			target: { role: "button", name: "Search" },
			postconditions: [{ type: "text", selector: "#result", equals: "boots" }],
		},
	],
};

describe("parseSyntheticTaskPlan", () => {
	it("parses a bounded, labeled synthetic task", () => {
		const result = parseSyntheticTaskPlan(validPlan);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("task should parse");
		expect(result.value.steps).toHaveLength(2);
		expect(result.value.steps[0]?.target).toEqual({ role: "textbox", name: "Product" });
	});

	it.each([
		[{ ...validPlan, dataClass: "public" }, "synthetic tasks require synthetic data"],
		[{ ...validPlan, startUrl: "https://example.com/task" }, "synthetic tasks require a data URL"],
		[
			{
				...validPlan,
				sourcePolicy: { ...validPlan.sourcePolicy, allowedHosts: ["public.example"] },
			},
			"synthetic tasks require an empty host allowlist",
		],
		[{ ...validPlan, steps: [] }, "task.steps must contain at least one step"],
		[
			{ ...validPlan, budget: { ...validPlan.budget, maxSteps: 1 } },
			"task.steps exceeds budget.maxSteps",
		],
		[
			{ ...validPlan, budget: { ...validPlan.budget, maxJevRequests: 1 } },
			"task.steps exceeds budget.maxJevRequests",
		],
		[
			{
				...validPlan,
				steps: [{ ...validPlan.steps[0], action: "click", value: "unexpected" }],
			},
			"click step query must not declare value or checked",
		],
		[
			{
				...validPlan,
				steps: [{ ...validPlan.steps[0], value: undefined }],
			},
			"fill step query requires value",
		],
		[
			{
				...validPlan,
				steps: [{ ...validPlan.steps[0], action: "check", value: undefined }],
			},
			"check step query requires checked",
		],
		[
			{
				...validPlan,
				steps: [{ ...validPlan.steps[0], postconditions: [] }],
			},
			"step query requires at least one deterministic postcondition",
		],
	] as const)("rejects unsafe or incomplete task plans", (input, message) => {
		const result = parseSyntheticTaskPlan(input);
		expect(result).toEqual({
			ok: false,
			error: { code: "invalid-synthetic-task", message },
		});
	});

	it("rejects duplicate step IDs and malformed postconditions", () => {
		const duplicate = {
			...validPlan,
			steps: [validPlan.steps[0], { ...validPlan.steps[1], id: "query" }],
		};
		expect(parseSyntheticTaskPlan(duplicate)).toEqual({
			ok: false,
			error: { code: "invalid-synthetic-task", message: "task step IDs must be unique" },
		});

		const malformed = {
			...validPlan,
			steps: [
				{
					...validPlan.steps[0],
					postconditions: [{ type: "value", selector: "", equals: "boots" }],
				},
			],
		};
		expect(parseSyntheticTaskPlan(malformed)).toEqual({
			ok: false,
			error: {
				code: "invalid-synthetic-task",
				message: "step query has an invalid postcondition",
			},
		});
	});

	it.each([
		null,
		{ ...validPlan, version: 2 },
		{ ...validPlan, mode: "shadow" },
		{ ...validPlan, budget: null },
		{ ...validPlan, budget: { ...validPlan.budget, maxSteps: 0 } },
		{ ...validPlan, budget: { ...validPlan.budget, maxSteps: 21 } },
		{ ...validPlan, budget: { ...validPlan.budget, maxSteps: 1.5 } },
		{ ...validPlan, budget: { ...validPlan.budget, maxJevRequests: 0 } },
		{ ...validPlan, budget: { ...validPlan.budget, maxJevRequests: 21 } },
		{ ...validPlan, budget: { ...validPlan.budget, actionTimeoutMs: 249 } },
		{ ...validPlan, budget: { ...validPlan.budget, actionTimeoutMs: 30_001 } },
		{ ...validPlan, steps: [null] },
		{ ...validPlan, steps: [validPlan.steps[0], null] },
		{ ...validPlan, steps: [{ ...validPlan.steps[0], action: "hover" }] },
		{ ...validPlan, steps: [{ ...validPlan.steps[0], target: null }] },
		{ ...validPlan, steps: [{ ...validPlan.steps[0], target: { role: "", name: "Product" } }] },
		{
			...validPlan,
			steps: [{ ...validPlan.steps[0], target: { role: "textbox", name: "" } }],
		},
		{ ...validPlan, steps: [{ ...validPlan.steps[0], checked: false }] },
		{
			...validPlan,
			steps: [
				{
					...validPlan.steps[0],
					action: "check",
					value: "unexpected",
					checked: true,
				},
			],
		},
		{
			...validPlan,
			steps: [{ ...validPlan.steps[0], postconditions: [null] }],
		},
		{
			...validPlan,
			steps: [
				{
					...validPlan.steps[0],
					postconditions: [{ type: "unknown", selector: "#query", equals: "boots" }],
				},
			],
		},
		{
			...validPlan,
			steps: [
				{
					...validPlan.steps[0],
					postconditions: [{ type: "visible", selector: "#query", equals: "yes" }],
				},
			],
		},
	] as const)("rejects additional malformed plan shapes", (input) => {
		const result = parseSyntheticTaskPlan(input);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("malformed task unexpectedly parsed");
		expect(result.error.code).toBe("invalid-synthetic-task");
	});
});
