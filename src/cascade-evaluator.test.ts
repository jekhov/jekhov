// pattern: Functional Core
import { describe, expect, it, vi } from "vitest";
import { createThresholdCascadeEvaluator } from "./cascade-evaluator.js";
import type { BrowserAction, JevEvaluator, Result, SelectionRequest } from "./types.js";

const thresholds: Record<BrowserAction, number> = {
	click: 0.5,
	fill: 0.6,
	select: 0.7,
	check: 0.8,
};

const request: SelectionRequest = {
	state: {
		goal: "Click Save",
		intended_action: "click",
		page: { title: "Fixture", url: "data:text/html,[omitted]" },
		candidates: [{ id: "c0", role: "button", name: "Save", context: [] }],
	},
	questions: {
		next_element: {
			type: "choice",
			instructions: "Choose",
			criteria: { c0: "Save", none: "None" },
		},
		unambiguous_match: { type: "noul", instructions: "Is it clear?" },
	},
};

function response(choice: string, probability: number, provider: string, inputTokens: number) {
	return {
		provenance: { provider },
		usage: { input_tokens: inputTokens, output_tokens: 2 },
		answers: {
			next_element: { choice },
			unambiguous_match: { noul: probability },
		},
	};
}

function evaluator(result: Result<unknown>): JevEvaluator {
	return { evaluate: vi.fn().mockResolvedValue(result) };
}

describe("createThresholdCascadeEvaluator", () => {
	it("keeps a primary proposal at or above its action threshold", async () => {
		const primary = evaluator({ ok: true, value: response("c0", 0.5, "primary", 10) });
		const fallback = evaluator({ ok: true, value: response("c0", 0.9, "fallback", 20) });
		const cascade = createThresholdCascadeEvaluator({ primary, fallback, thresholds });

		const result = await cascade.evaluate(request, "synthetic");

		expect(result.ok).toBe(true);
		expect(fallback.evaluate).not.toHaveBeenCalled();
		expect(result.ok && result.value).toMatchObject({
			provenance: { provider: "jekhov-cascade", route: "primary", threshold: 0.5 },
			usage: { input_tokens: 10, output_tokens: 2 },
		});
	});

	it("routes a low-confidence proposal to the fallback and sums numeric usage", async () => {
		const primary = evaluator({ ok: true, value: response("c0", 0.49, "primary", 10) });
		const fallback = evaluator({ ok: true, value: response("c0", 0.91, "fallback", 20) });
		const cascade = createThresholdCascadeEvaluator({ primary, fallback, thresholds });

		const result = await cascade.evaluate(request, "synthetic");

		expect(result.ok && result.value).toMatchObject({
			provenance: {
				provider: "jekhov-cascade",
				route: "fallback",
				reason: "low-match-probability",
				threshold: 0.5,
			},
			usage: { input_tokens: 30, output_tokens: 4 },
		});
	});

	it.each([
		["primary-abstention", { ok: true, value: response("none", 0.9, "primary", 10) }],
		["primary-error", { ok: false, error: { code: "primary-failed", message: "offline" } }],
		["invalid-primary-response", { ok: true, value: { provenance: { provider: "primary" } } }],
		[
			"invalid-primary-response",
			{ ok: true, value: response("not-a-candidate", 0.9, "primary", 10) },
		],
	] as const)("routes %s to the fallback", async (reason, primaryResult) => {
		const primary = evaluator(primaryResult);
		const fallback = evaluator({ ok: true, value: response("c0", 0.9, "fallback", 20) });
		const cascade = createThresholdCascadeEvaluator({ primary, fallback, thresholds });

		const result = await cascade.evaluate(request, "synthetic");

		expect(result.ok && result.value).toMatchObject({
			provenance: { provider: "jekhov-cascade", route: "fallback", reason },
		});
		expect(fallback.evaluate).toHaveBeenCalledOnce();
	});

	it("rejects an unknown fallback candidate", async () => {
		const primary = evaluator({ ok: true, value: response("c0", 0.1, "primary", 10) });
		const fallback = evaluator({
			ok: true,
			value: response("not-a-candidate", 0.9, "fallback", 20),
		});
		const cascade = createThresholdCascadeEvaluator({ primary, fallback, thresholds });

		await expect(cascade.evaluate(request, "synthetic")).resolves.toMatchObject({
			ok: false,
			error: {
				code: "invalid-fallback-response",
				message: "fallback response is missing a valid selection decision",
			},
		});
	});

	it("fails closed before either selector when an action threshold is invalid", async () => {
		const primary = evaluator({ ok: true, value: response("c0", 0.9, "primary", 10) });
		const fallback = evaluator({ ok: true, value: response("c0", 0.9, "fallback", 20) });
		const cascade = createThresholdCascadeEvaluator({
			primary,
			fallback,
			thresholds: { ...thresholds, click: 1.1 },
		});

		await expect(cascade.evaluate(request, "synthetic")).resolves.toEqual({
			ok: false,
			error: { code: "invalid-cascade-threshold", message: "click threshold must be 0-1" },
		});
		expect(primary.evaluate).not.toHaveBeenCalled();
		expect(fallback.evaluate).not.toHaveBeenCalled();
	});

	it("accepts compatible choice-only selectors", async () => {
		const choiceOnlyRequest: SelectionRequest = {
			...request,
			state: { ...request.state, candidates: [] },
			questions: { next_element: request.questions.next_element },
		};
		const choiceOnlyResponse = {
			provenance: { provider: "fixture" },
			usage: { input_tokens: 1 },
			answers: {
				next_element: {
					type: "choice",
					choice: "c0",
					confidence: 0.9,
					probabilities: { c0: 0.9, none: 0.1 },
				},
			},
		};
		const primary = evaluator({ ok: true, value: choiceOnlyResponse });
		const fallback = evaluator({ ok: true, value: choiceOnlyResponse });
		const cascade = createThresholdCascadeEvaluator({ primary, fallback, thresholds });

		await expect(cascade.evaluate(choiceOnlyRequest, "synthetic")).resolves.toMatchObject({
			ok: true,
			value: { request_count: 1, provenance: { route: "primary" } },
		});
		expect(fallback.evaluate).not.toHaveBeenCalled();
	});

	it("retains primary telemetry when a fallback call fails", async () => {
		const primary = evaluator({ ok: true, value: response("c0", 0.1, "primary", 10) });
		const fallback = evaluator({
			ok: false,
			error: {
				code: "fallback-failed",
				message: "offline",
				telemetry: {
					requestCount: 1,
					provenance: { provider: "fallback", request_sha256: "private" },
					usage: { input_tokens: 20, output_tokens: 1 },
				},
			},
		});
		const cascade = createThresholdCascadeEvaluator({ primary, fallback, thresholds });

		await expect(cascade.evaluate(request, "synthetic")).resolves.toMatchObject({
			ok: false,
			error: {
				code: "fallback-failed",
				telemetry: {
					requestCount: 2,
					usage: { input_tokens: 30, output_tokens: 3 },
					provenance: {
						provider: "jekhov-cascade",
						route: "fallback",
						fallback: {
							provider: "fallback",
							failure: { code: "fallback-failed" },
						},
					},
				},
			},
		});
	});

	it("retains failed-primary telemetry when the fallback also fails", async () => {
		const primary = evaluator({
			ok: false,
			error: {
				code: "primary-failed",
				message: "offline",
				telemetry: {
					requestCount: 1,
					provenance: { provider: "primary" },
					usage: { input_tokens: 7 },
				},
			},
		});
		const fallback = evaluator({
			ok: false,
			error: {
				code: "fallback-failed",
				message: "offline",
				telemetry: {
					requestCount: 1,
					provenance: { provider: "fallback" },
					usage: { input_tokens: 11 },
				},
			},
		});
		const cascade = createThresholdCascadeEvaluator({ primary, fallback, thresholds });

		await expect(cascade.evaluate(request, "synthetic")).resolves.toMatchObject({
			ok: false,
			error: {
				telemetry: {
					requestCount: 2,
					usage: { input_tokens: 18 },
					provenance: {
						primary: { provider: "primary", failure: { code: "primary-failed" } },
						fallback: { provider: "fallback", failure: { code: "fallback-failed" } },
					},
				},
			},
		});
	});
});
