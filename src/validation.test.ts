// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { validateArtifact } from "./validation.js";

const shadowPlan = {
	version: 1,
	mode: "shadow",
	goal: "Open the next page",
	startUrl: "https://catalogue.example/search",
	dataClass: "public",
	sourcePolicy: {
		allowedHosts: ["catalogue.example"],
		basis: "terms-reviewed",
		providerDisclosure: "allowed",
		reviewedAt: "2026-09-18",
		note: "Public catalogue pages reviewed for bounded selection.",
	},
	step: { id: "next", action: "click", goal: "Open the next results page" },
};
const validationReportBase = {
	version: 1,
	jekhovVersion: "0.1.1",
	mode: "validation",
	valid: true,
	executed: false,
	browserOpened: false,
	providerRequestCount: 0,
};

describe("validateArtifact", () => {
	it("summarizes a shadow plan without exposing page content", () => {
		expect(validateArtifact("plan", shadowPlan)).toEqual({
			ok: true,
			value: {
				...validationReportBase,
				artifact: {
					kind: "shadow-plan",
					dataClass: "public",
					actions: ["click"],
					allowedHostCount: 1,
				},
			},
		});
	});

	it("recognizes a synthetic task plan", () => {
		const result = validateArtifact("plan", {
			...shadowPlan,
			mode: "synthetic-task",
			startUrl: "data:text/html,fixture",
			dataClass: "synthetic",
			sourcePolicy: {
				allowedHosts: [],
				basis: "synthetic",
				reviewedAt: "2026-09-18",
				note: "Repository-owned synthetic fixture.",
			},
			budget: { maxSteps: 1, maxJevRequests: 1, actionTimeoutMs: 5_000 },
			steps: [
				{
					id: "submit",
					action: "click",
					goal: "Submit the form",
					target: { role: "button", name: "Submit" },
					postconditions: [{ type: "visible", selector: "#done", equals: true }],
				},
			],
		});

		expect(result).toEqual({
			ok: true,
			value: {
				...validationReportBase,
				artifact: {
					kind: "synthetic-task-plan",
					dataClass: "synthetic",
					actions: ["click"],
					allowedHostCount: 0,
					stepCount: 1,
					maximumProviderRequests: 1,
				},
			},
		});
	});

	it("summarizes evaluation corpora and pricing", () => {
		const corpus = validateArtifact("corpus", {
			version: 1,
			name: "fixture",
			cases: [
				{
					id: "next",
					tags: ["synthetic"],
					plan: shadowPlan,
					observation: {
						url: "https://catalogue.example/search",
						title: "Catalogue",
						snapshot: [{ role: "button", name: "Next", ref: "e1" }],
					},
					label: { expectedRef: "e1" },
				},
			],
		});
		expect(corpus).toEqual({
			ok: true,
			value: {
				...validationReportBase,
				artifact: {
					kind: "evaluation-corpus",
					name: "fixture",
					caseCount: 1,
					actions: ["click"],
				},
			},
		});

		const pricing = validateArtifact("pricing", {
			version: 1,
			currency: "USD",
			asOf: "2026-09-18",
			selectors: {
				jev: {
					model: "fixture",
					sourceUrl: "https://example.com/pricing",
					components: [{ usageField: "input_tokens", usdPerMillion: 1 }],
				},
			},
		});
		expect(pricing).toEqual({
			ok: true,
			value: {
				...validationReportBase,
				artifact: {
					kind: "evaluation-pricing",
					currency: "USD",
					asOf: "2026-09-18",
					selectorCount: 1,
				},
			},
		});
	});

	it("rejects unknown plan modes", () => {
		expect(validateArtifact("plan", { ...shadowPlan, mode: "act" })).toEqual({
			ok: false,
			error: { code: "invalid-plan", message: "plan.mode must be shadow or synthetic-task" },
		});
	});

	it("rejects unknown runtime artifact kinds instead of treating them as plans", () => {
		expect(validateArtifact("shadow-plan" as never, shadowPlan)).toEqual({
			ok: false,
			error: {
				code: "invalid-validation-kind",
				message: "artifact kind must be plan, corpus, or pricing",
			},
		});
	});

	it.each([
		["corpus", null, "invalid-corpus"],
		["pricing", null, "invalid-pricing"],
		["plan", null, "invalid-plan"],
		["plan", { ...shadowPlan, goal: "" }, "invalid-plan"],
		[
			"plan",
			{ ...shadowPlan, mode: "synthetic-task", dataClass: "synthetic", steps: [] },
			"invalid-synthetic-task",
		],
	] as const)("preserves %s parser failures", (kind, input, code) => {
		const result = validateArtifact(kind, input);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("invalid artifact unexpectedly validated");
		expect(result.error.code).toBe(code);
	});
});
