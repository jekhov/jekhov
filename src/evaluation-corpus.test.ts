// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { parseEvaluationCorpus } from "./evaluation-corpus.js";

const syntheticPlan = {
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
	step: { id: "continue", action: "click", goal: "Continue to the next step" },
};

const validCorpus = {
	version: 1,
	name: "synthetic-core-v1",
	cases: [
		{
			id: "unique-continue",
			tags: ["unique", "click", "click"],
			plan: syntheticPlan,
			observation: {
				url: syntheticPlan.startUrl,
				title: "Synthetic form",
				snapshot: [{ role: "button", name: "Continue", ref: "continue-button" }],
			},
			label: { expectedRef: "continue-button" },
		},
	],
};

describe("parseEvaluationCorpus", () => {
	it("accepts a declared synthetic case and normalizes duplicate tags", () => {
		const result = parseEvaluationCorpus(validCorpus);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("valid corpus should parse");
		expect(result.value.cases[0]?.tags).toEqual(["unique", "click"]);
		expect(result.value.cases[0]?.label.expectedRef).toBe("continue-button");
	});

	it("accepts an explicit abstention label", () => {
		const result = parseEvaluationCorpus({
			...validCorpus,
			cases: [
				{
					...validCorpus.cases[0],
					label: { expectedRef: null },
				},
			],
		});

		expect(result.ok && result.value.cases[0]?.label.expectedRef).toBeNull();
	});

	it("rejects duplicate case IDs", () => {
		const result = parseEvaluationCorpus({
			...validCorpus,
			cases: [validCorpus.cases[0], validCorpus.cases[0]],
		});

		expect(result).toEqual({
			ok: false,
			error: { code: "invalid-corpus", message: "case IDs must be unique: unique-continue" },
		});
	});

	it("rejects candidate labels that are absent after deterministic filtering", () => {
		const result = parseEvaluationCorpus({
			...validCorpus,
			cases: [
				{
					...validCorpus.cases[0],
					label: { expectedRef: "missing-button" },
				},
			],
		});

		expect(result).toEqual({
			ok: false,
			error: {
				code: "invalid-corpus",
				message:
					"case unique-continue expectedRef missing-button is not an eligible click candidate",
			},
		});
	});

	it("rejects observations outside the plan's source policy", () => {
		const validCase = validCorpus.cases[0];
		if (!validCase) throw new Error("fixture case is required");
		const result = parseEvaluationCorpus({
			...validCorpus,
			cases: [
				{
					...validCase,
					plan: {
						...syntheticPlan,
						startUrl: "https://allowed.example/start",
						dataClass: "public",
						sourcePolicy: {
							allowedHosts: ["allowed.example"],
							basis: "terms-reviewed",
							providerDisclosure: "allowed",
							reviewedAt: "2026-09-17",
							note: "Public fixture retained under reviewed source terms.",
						},
					},
					observation: {
						...validCase.observation,
						url: "https://redirected.example/result",
					},
				},
			],
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("out-of-policy observation unexpectedly parsed");
		expect(result.error.code).toBe("redirect-host-not-allowed");
	});

	it.each([
		[null, "corpus must be a JSON object"],
		[{ ...validCorpus, version: 2 }, "corpus.version must be 1"],
		[{ ...validCorpus, name: "" }, "corpus.name is required"],
		[{ ...validCorpus, cases: [] }, "corpus.cases must contain 1-200 cases"],
		[{ ...validCorpus, cases: [null] }, "case 1 must be a JSON object"],
		[{ ...validCorpus, cases: [{ ...validCorpus.cases[0], id: "" }] }, "case 1 id is required"],
		[
			{ ...validCorpus, cases: [{ ...validCorpus.cases[0], tags: "click" }] },
			"case unique-continue tags must be an array",
		],
		[
			{ ...validCorpus, cases: [{ ...validCorpus.cases[0], tags: Array(17).fill("tag") }] },
			"case unique-continue tags must contain at most 16 nonempty strings",
		],
		[
			{ ...validCorpus, cases: [{ ...validCorpus.cases[0], tags: [""] }] },
			"case unique-continue tags must contain at most 16 nonempty strings",
		],
		[
			{ ...validCorpus, cases: [{ ...validCorpus.cases[0], observation: null }] },
			"case unique-continue observation is required",
		],
		[
			{
				...validCorpus,
				cases: [
					{
						...validCorpus.cases[0],
						observation: { ...validCorpus.cases[0]?.observation, url: "" },
					},
				],
			},
			"case unique-continue observation.url is required",
		],
		[
			{
				...validCorpus,
				cases: [
					{
						...validCorpus.cases[0],
						observation: { ...validCorpus.cases[0]?.observation, title: null },
					},
				],
			},
			"case unique-continue observation.title must be a string",
		],
		[
			{ ...validCorpus, cases: [{ ...validCorpus.cases[0], label: {} }] },
			"case unique-continue label.expectedRef must be a string or null",
		],
		[
			{ ...validCorpus, cases: [{ ...validCorpus.cases[0], label: { expectedRef: 7 } }] },
			"case unique-continue label.expectedRef must be a string or null",
		],
	])("rejects malformed corpus input %#", (input, message) => {
		expect(parseEvaluationCorpus(input)).toEqual({
			ok: false,
			error: { code: "invalid-corpus", message },
		});
	});

	it("propagates plan and snapshot validation failures", () => {
		expect(
			parseEvaluationCorpus({
				...validCorpus,
				cases: [{ ...validCorpus.cases[0], plan: null }],
			}),
		).toMatchObject({ ok: false, error: { code: "invalid-plan" } });
		expect(
			parseEvaluationCorpus({
				...validCorpus,
				cases: [
					{
						...validCorpus.cases[0],
						observation: { ...validCorpus.cases[0]?.observation, snapshot: {} },
					},
				],
			}),
		).toMatchObject({ ok: false, error: { code: "invalid-snapshot" } });
	});
});
