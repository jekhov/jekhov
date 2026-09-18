// pattern: Imperative Shell
import { describe, expect, it, vi } from "vitest";
import type { EvaluationCorpus } from "./evaluation-corpus.js";
import { runEvaluationCorpus } from "./evaluation-run.js";
import type { JevEvaluator, SelectionRequest, ShadowPlan } from "./types.js";

const plan: ShadowPlan = {
	version: 1,
	mode: "shadow",
	goal: "Complete a synthetic workflow",
	startUrl: "data:text/html,<button>Continue</button>",
	dataClass: "synthetic",
	sourcePolicy: {
		allowedHosts: [],
		basis: "synthetic",
		reviewedAt: "2026-09-17",
		note: "Repository-owned synthetic evaluation fixture.",
	},
	step: { id: "continue", action: "click", goal: "Continue" },
};

const corpus: EvaluationCorpus = {
	version: 1,
	name: "two-cases",
	cases: [
		{
			id: "continue",
			tags: ["click"],
			plan,
			observation: {
				url: plan.startUrl,
				title: "Continue",
				snapshot: [{ role: "button", name: "Continue", ref: "continue-ref" }],
			},
			label: { expectedRef: "continue-ref" },
		},
		{
			id: "ambiguous",
			tags: ["click", "ambiguous"],
			plan: { ...plan, step: { ...plan.step, id: "ambiguous", goal: "Save" } },
			observation: {
				url: plan.startUrl,
				title: "Ambiguous",
				snapshot: [
					{ role: "button", name: "Save", ref: "save-one" },
					{ role: "button", name: "Save", ref: "save-two" },
				],
			},
			label: { expectedRef: null },
		},
	],
};

function evaluator(
	choiceByGoal: Record<string, string>,
	calls: string[],
	requests: string[],
): JevEvaluator {
	return {
		evaluate: vi.fn(async (request: SelectionRequest) => {
			calls.push(request.state.goal);
			requests.push(JSON.stringify(request));
			return {
				ok: true as const,
				value: {
					provenance: { provider: "fixture" },
					usage: { input_tokens: 10, cost_usd: 0.0001 },
					answers: {
						next_element: { choice: choiceByGoal[request.state.goal] ?? "none" },
						unambiguous_match: { noul: 0.5 },
					},
				},
			};
		}),
	};
}

describe("runEvaluationCorpus", () => {
	it("replays cases sequentially for each selector without exposing labels or acting", async () => {
		const calls: string[] = [];
		const requests: string[] = [];
		let time = 0;
		const result = await runEvaluationCorpus(
			corpus,
			[
				{
					name: "jev",
					evaluator: evaluator({ Continue: "c0", Save: "none" }, calls, requests),
				},
				{
					name: "baseline",
					evaluator: evaluator({ Continue: "none", Save: "c0" }, calls, requests),
				},
			],
			{
				now: () => (time += 5),
				cascade: { primarySelector: "jev", fallbackSelector: "baseline", thresholds: [0.5] },
			},
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("evaluation should succeed");
		expect(calls).toEqual(["Continue", "Save", "Continue", "Save"]);
		expect(result.value).toMatchObject({
			version: 2,
			mode: "shadow-evaluation",
			executed: false,
			corpus: { name: "two-cases", caseCount: 2 },
			requestBudget: { selectors: 2, casesPerSelector: 2, maximumRequests: 4 },
			pricing: null,
		});
		expect(result.value.corpus.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(result.value.selectors[0]?.summary).toMatchObject({
			correct: 2,
			incorrect: 0,
			requestsMade: 2,
		});
		expect(result.value.selectors[1]?.summary).toMatchObject({
			correct: 0,
			incorrect: 2,
			requestsMade: 2,
		});
		expect(result.value.cascade).toMatchObject({
			primarySelector: "jev",
			fallbackSelector: "baseline",
			operatingPoints: [
				{
					threshold: 0.5,
					outcomes: { correct: 1, totalCases: 2 },
					routing: { primaryRequests: 2, fallbackRequests: 1, fallbackRate: 0.5 },
					apiListPriceUsd: null,
				},
			],
		});
		expect(result.value.selectors[0]?.cases[0]).toMatchObject({
			action: "click",
			tags: ["click"],
			expectedRef: "continue-ref",
			actualRef: "continue-ref",
			outcome: "correct-selection",
			status: "proposed",
			requestMade: true,
			elapsedMilliseconds: 5,
			candidateCount: 1,
			omittedCandidateCount: 0,
			provenance: { provider: "fixture" },
		});
		expect(requests).toHaveLength(4);
		expect(requests[0]).toBe(requests[2]);
		expect(requests[1]).toBe(requests[3]);
		expect(requests.join("\n")).not.toContain("continue-ref");
		expect(requests.join("\n")).not.toContain("save-one");
	});

	it("compares the choice-only request profile in the same bounded evaluation", async () => {
		const requests: SelectionRequest[] = [];
		const choiceOnly: JevEvaluator = {
			evaluate: vi.fn(async (request) => {
				requests.push(request);
				const choice = request.state.goal === "Continue" ? "c0" : "none";
				const probabilityKeys = Object.keys(request.questions.next_element.criteria);
				return {
					ok: true as const,
					value: {
						provenance: { provider: "fixture" },
						answers: {
							next_element: {
								type: "choice",
								choice,
								confidence: choice === "none" ? 0.6 : 0.8,
								probabilities: Object.fromEntries(
									probabilityKeys.map((key) => [key, key === choice ? 1 : 0]),
								),
							},
						},
					},
				};
			}),
		};

		const result = await runEvaluationCorpus(corpus, [
			{ name: "jev-choice-only", evaluator: choiceOnly, selectionProfile: "choice-only" },
		]);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("evaluation should succeed");
		expect(requests).toHaveLength(2);
		expect(requests.every((request) => request.state.candidates.length === 0)).toBe(true);
		expect(requests.every((request) => !("unambiguous_match" in request.questions))).toBe(true);
		expect(result.value.selectors[0]?.summary.correct).toBe(2);
		expect(result.value.selectors[0]?.cases[0]).toMatchObject({
			choiceConfidence: 0.8,
			matchProbability: 0.8,
			matchProbabilitySource: "choice-confidence",
		});
	});

	it("rejects cascade selector names that are absent from the run", async () => {
		const unused: JevEvaluator = { evaluate: vi.fn() };

		const result = await runEvaluationCorpus(corpus, [{ name: "jev", evaluator: unused }], {
			cascade: { primarySelector: "jev", fallbackSelector: "missing" },
		});

		expect(result).toEqual({
			ok: false,
			error: {
				code: "invalid-evaluation",
				message: "cascade selectors must name selectors in this evaluation",
			},
		});
		expect(unused.evaluate).not.toHaveBeenCalled();
	});

	it("records selector failures and continues through the corpus", async () => {
		let call = 0;
		const failing: JevEvaluator = {
			evaluate: vi.fn(async () => {
				call += 1;
				return call === 1
					? { ok: false as const, error: { code: "client-failed", message: "offline" } }
					: {
							ok: true as const,
							value: {
								provenance: {},
								answers: {
									next_element: { choice: "none" },
									unambiguous_match: { noul: 0.2 },
								},
							},
						};
			}),
		};

		const result = await runEvaluationCorpus(corpus, [{ name: "jev", evaluator: failing }]);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("provider errors belong in the report");
		expect(result.value.selectors[0]?.cases[0]).toMatchObject({
			status: "error",
			outcome: "error",
			requestMade: true,
			failure: { code: "client-failed", message: "offline" },
		});
		expect(result.value.selectors[0]?.summary.errors).toBe(1);
		expect(failing.evaluate).toHaveBeenCalledTimes(2);
	});

	it("rejects missing or duplicate selector names before making requests", async () => {
		const unused: JevEvaluator = { evaluate: vi.fn() };

		expect(await runEvaluationCorpus(corpus, [])).toEqual({
			ok: false,
			error: { code: "invalid-evaluation", message: "at least one selector is required" },
		});
		expect(
			await runEvaluationCorpus(corpus, [
				{ name: "same", evaluator: unused },
				{ name: "same", evaluator: unused },
			]),
		).toEqual({
			ok: false,
			error: { code: "invalid-evaluation", message: "selector names must be unique: same" },
		});
		expect(unused.evaluate).not.toHaveBeenCalled();
	});

	it("revalidates programmatic corpus input before making requests", async () => {
		const unused: JevEvaluator = { evaluate: vi.fn() };
		const invalidCorpus = {
			...corpus,
			cases: [
				{
					...corpus.cases[0],
					label: { expectedRef: "not-a-candidate" },
				},
			],
		} as EvaluationCorpus;

		const result = await runEvaluationCorpus(invalidCorpus, [{ name: "jev", evaluator: unused }]);

		expect(result).toEqual({
			ok: false,
			error: {
				code: "invalid-corpus",
				message: "case continue expectedRef not-a-candidate is not an eligible click candidate",
			},
		});
		expect(unused.evaluate).not.toHaveBeenCalled();
	});
});
