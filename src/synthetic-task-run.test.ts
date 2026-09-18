// pattern: Imperative Shell
import { describe, expect, it, vi } from "vitest";
import { createThresholdCascadeEvaluator } from "./cascade-evaluator.js";
import type { SyntheticTaskPage, SyntheticTaskPlan } from "./synthetic-task.js";
import { runSyntheticTask } from "./synthetic-task-run.js";
import type { JevEvaluator, PageObservation, Result } from "./types.js";

const plan: SyntheticTaskPlan = {
	version: 1,
	mode: "synthetic-task",
	goal: "Complete a synthetic form",
	startUrl: "data:text/html,fixture",
	dataClass: "synthetic",
	sourcePolicy: {
		allowedHosts: [],
		basis: "synthetic",
		reviewedAt: "2026-09-18",
		note: "Repository-owned synthetic task fixture.",
	},
	budget: { maxSteps: 2, maxJevRequests: 2, actionTimeoutMs: 5_000 },
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

const snapshots = {
	query: [{ role: "textbox", name: "Product", ref: "e1" }],
	submit: [{ role: "button", name: "Search", ref: "e2" }],
};

function successfulPage(observations: unknown[]): SyntheticTaskPage {
	let index = 0;
	return {
		observe: vi.fn(
			async (): Promise<Result<PageObservation>> => ({
				ok: true,
				value: {
					url: plan.startUrl,
					title: "Fixture",
					snapshot: observations[index++],
				},
			}),
		),
		currentUrl: vi.fn(() => plan.startUrl),
		act: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
		verify: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
	};
}

function choiceEvaluator(choices: string[]): JevEvaluator {
	let index = 0;
	return {
		evaluate: vi.fn(async (request): Promise<Result<unknown>> => {
			const choice = choices[index++] ?? "none";
			return {
				ok: true,
				value: {
					provenance: { provider: "fixture" },
					usage: { input_tokens: 10 },
					answers: {
						next_element: {
							type: "choice",
							choice,
							confidence: 0.8,
							probabilities: Object.fromEntries(
								Object.keys(request.questions.next_element.criteria).map((key) => [
									key,
									key === choice ? 1 : 0,
								]),
							),
						},
						unambiguous_match: { noul: 0.9 },
					},
				},
			};
		}),
	};
}

describe("runSyntheticTask", () => {
	it("selects, freshness-checks, executes, and verifies every labeled step", async () => {
		const page = successfulPage([
			snapshots.query,
			snapshots.query,
			snapshots.submit,
			snapshots.submit,
		]);
		const jev = choiceEvaluator(["c0", "c0"]);

		const result = await runSyntheticTask(
			plan,
			{ page, jev },
			{ generatedAt: () => new Date("2026-09-18T12:00:00.000Z") },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("task should complete");
		expect(result.value.status).toBe("completed");
		expect(result.value).toMatchObject({
			version: 1,
			jekhovVersion: "0.1.0",
			generatedAt: "2026-09-18T12:00:00.000Z",
			planSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
			sourcePolicySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		expect(result.value.executedStepCount).toBe(2);
		expect(result.value.jevRequestCount).toBe(2);
		expect(page.act).toHaveBeenNthCalledWith(1, {
			action: "fill",
			ref: "e1",
			value: "boots",
			timeoutMs: 5_000,
		});
		expect(page.act).toHaveBeenNthCalledWith(2, {
			action: "click",
			ref: "e2",
			timeoutMs: 5_000,
		});
		expect(page.verify).toHaveBeenCalledTimes(2);
		expect(result.value.steps.every((step) => step.executed)).toBe(true);
		expect(result.value.steps[0]).toMatchObject({
			choiceConfidence: 0.8,
			choiceProbabilities: { c0: 1, none: 0 },
			matchProbabilitySource: "unambiguous-noul",
		});
	});

	it("accounts for both selector legs when a live cascade falls back", async () => {
		const oneStepPlan = {
			...plan,
			budget: { ...plan.budget, maxSteps: 1, maxJevRequests: 2 },
			steps: [plan.steps[0]],
		};
		const page = successfulPage([snapshots.query, snapshots.query]);
		const cascade = createThresholdCascadeEvaluator({
			primary: choiceEvaluator(["c0"]),
			fallback: choiceEvaluator(["c0"]),
			thresholds: { click: 0.8, fill: 0.95, select: 0.8, check: 0.8 },
		});

		const result = await runSyntheticTask(oneStepPlan, { page, jev: cascade });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("cascaded task should complete");
		expect(result.value.status).toBe("completed");
		expect(result.value.jevRequestCount).toBe(2);
	});

	it("reserves the cascade request bound before calling either selector", async () => {
		const oneStepPlan = {
			...plan,
			budget: { ...plan.budget, maxSteps: 1, maxJevRequests: 1 },
			steps: [plan.steps[0]],
		};
		const page = successfulPage([snapshots.query]);
		const primary = choiceEvaluator(["c0"]);
		const fallback = choiceEvaluator(["c0"]);
		const cascade = createThresholdCascadeEvaluator({
			primary,
			fallback,
			thresholds: { click: 0.8, fill: 0.95, select: 0.8, check: 0.8 },
		});

		const result = await runSyntheticTask(oneStepPlan, { page, jev: cascade });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("task should return a stopped report");
		expect(result.value.stop?.code).toBe("selector-request-budget-exhausted");
		expect(primary.evaluate).not.toHaveBeenCalled();
		expect(fallback.evaluate).not.toHaveBeenCalled();
	});

	it("charges the declared evaluator bound even when its response underreports calls", async () => {
		const boundedPlan = {
			...plan,
			budget: { ...plan.budget, maxJevRequests: 3 },
		};
		const page = successfulPage([snapshots.query, snapshots.query, snapshots.submit]);
		let providerCalls = 0;
		const evaluator: JevEvaluator = {
			maximumRequestCount: 2,
			async evaluate(request) {
				providerCalls += 2;
				return {
					ok: true,
					value: {
						request_count: 1,
						provenance: { provider: "fixture" },
						answers: {
							next_element: {
								choice: request.state.candidates[0]?.id ?? "none",
							},
							unambiguous_match: { noul: 1 },
						},
					},
				};
			},
		};

		const result = await runSyntheticTask(boundedPlan, { page, jev: evaluator });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("task should return a bounded report");
		expect(result.value.status).toBe("stopped");
		expect(result.value.jevRequestCount).toBe(2);
		expect(result.value.stop?.code).toBe("selector-request-budget-exhausted");
		expect(providerCalls).toBe(2);
	});

	it("stops before acting when Jev does not select the labeled target", async () => {
		const page = successfulPage([
			[
				{ role: "textbox", name: "Wrong", ref: "e0" },
				{ role: "textbox", name: "Product", ref: "e1" },
			],
		]);
		const jev = choiceEvaluator(["c0"]);

		const result = await runSyntheticTask(plan, { page, jev });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("task should return a stopped report");
		expect(result.value.status).toBe("stopped");
		expect(result.value.stop?.code).toBe("oracle-mismatch");
		expect(page.act).not.toHaveBeenCalled();
	});

	it("stops before spending when the labeled target identity is not unique", async () => {
		const page = successfulPage([
			[
				{ role: "textbox", name: "Product", ref: "e1" },
				{ role: "textbox", name: "Product", ref: "e2" },
			],
		]);
		const jev = choiceEvaluator(["c0"]);

		const result = await runSyntheticTask(plan, { page, jev });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("task should return a stopped report");
		expect(result.value.stop?.code).toBe("oracle-target-ambiguous");
		expect(jev.evaluate).not.toHaveBeenCalled();
		expect(page.act).not.toHaveBeenCalled();
	});

	it("stops before spending a request when candidate truncation could hide the target", async () => {
		const submitStep = plan.steps[1];
		if (!submitStep) throw new Error("fixture submit step is missing");
		const candidates = Array.from({ length: 49 }, (_, index) => ({
			role: "button",
			name: `Button ${index}`,
			ref: `e${index}`,
		}));
		const page = successfulPage([candidates]);
		const jev = choiceEvaluator([]);

		const result = await runSyntheticTask(
			{
				...plan,
				steps: [
					{
						...submitStep,
						target: { role: "button", name: "Button 48" },
					},
				],
			},
			{ page, jev },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("task should return a stopped report");
		expect(result.value.stop?.code).toBe("candidate-set-truncated");
		expect(jev.evaluate).not.toHaveBeenCalled();
		expect(page.act).not.toHaveBeenCalled();
	});

	it("rechecks the selected reference and identity immediately before acting", async () => {
		const page = successfulPage([snapshots.query, []]);
		const jev = choiceEvaluator(["c0"]);

		const result = await runSyntheticTask(plan, { page, jev });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("task should return a stopped report");
		expect(result.value.stop?.code).toBe("stale-proposal");
		expect(page.act).not.toHaveBeenCalled();
	});

	it("stops after an action when a deterministic postcondition fails", async () => {
		const page = successfulPage([snapshots.query, snapshots.query]);
		page.verify = vi.fn().mockResolvedValue({
			ok: false,
			error: { code: "postcondition-failed", message: "value did not match" },
		});
		const jev = choiceEvaluator(["c0"]);

		const result = await runSyntheticTask(plan, { page, jev });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("task should return a stopped report");
		expect(result.value.status).toBe("stopped");
		expect(result.value.executedStepCount).toBe(1);
		expect(result.value.stop?.code).toBe("postcondition-failed");
	});

	it("records a possibly mutating action attempt even when the adapter reports failure", async () => {
		const page = successfulPage([snapshots.query, snapshots.query]);
		page.act = vi.fn().mockResolvedValue({
			ok: false,
			error: { code: "browser-action-failed", message: "navigation timed out after dispatch" },
		});
		const jev = choiceEvaluator(["c0"]);

		const result = await runSyntheticTask(plan, { page, jev });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("task should return a stopped report");
		expect(result.value.executed).toBe(true);
		expect(result.value.executedStepCount).toBe(1);
		expect(result.value.confirmedStepCount).toBe(0);
		expect(result.value.steps[0]).toMatchObject({ executed: true, actionConfirmed: false });
	});

	it("stops immediately when an action leaves the declared source policy", async () => {
		const page = successfulPage([snapshots.query, snapshots.query]);
		page.currentUrl = vi.fn(() => "https://unreviewed.example/");
		const jev = choiceEvaluator(["c0"]);

		const result = await runSyntheticTask(plan, { page, jev });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("task should return a stopped report");
		expect(result.value.stop?.code).toBe("redirect-host-not-allowed");
		expect(page.verify).not.toHaveBeenCalled();
	});
});
