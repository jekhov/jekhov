// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { JEV_MODEL, validateJevPolicyRequest, validateJevPolicyResponse } from "./jev-policy.js";
import { buildSelectionRequest } from "./selection.js";

const request = buildSelectionRequest({
	goal: "Continue",
	action: "click",
	pageUrl: "data:text/html,test",
	pageTitle: "Test",
	candidates: [{ id: "c0", ref: "e2", role: "button", name: "Continue", context: [] }],
});

describe("validateJevPolicyRequest", () => {
	it("accepts bounded Jekhov selection requests and pins the model", () => {
		const result = validateJevPolicyRequest(request, "synthetic");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("request should be accepted");
		expect(result.value).toEqual({ ...request, model: JEV_MODEL });
	});

	it.each([
		["private-approved", request, "data class must be public or synthetic"],
		["synthetic", null, "request must be a JSON object"],
		[
			"synthetic",
			{ ...request, model: "jev-latest" },
			`request must not set model; the wrapper pins ${JEV_MODEL}`,
		],
		[
			"synthetic",
			{ ...request, questions: {} },
			"request must contain next_element and unambiguous_match questions",
		],
		[
			"synthetic",
			{
				...request,
				questions: {
					...request.questions,
					next_element: { ...request.questions.next_element, criteria: { only: "one" } },
				},
			},
			"next_element must be a choice question with at least two criteria",
		],
		[
			"synthetic",
			{
				...request,
				questions: {
					...request.questions,
					unambiguous_match: { type: "score", instructions: "wrong type" },
				},
			},
			"unambiguous_match must be a noul question",
		],
	] as const)("rejects policy-invalid input", (dataClass, input, message) => {
		expect(validateJevPolicyRequest(input, dataClass)).toEqual({
			ok: false,
			error: { code: "jev-policy-denied", message },
		});
	});

	it("rejects identifiers that public requests must strip", () => {
		const input = structuredClone(request);
		input.state.goal = "inspect did:plc:sensitive";

		expect(validateJevPolicyRequest(input, "public")).toEqual({
			ok: false,
			error: {
				code: "jev-policy-denied",
				message: "public requests must strip AT Protocol DIDs and URIs",
			},
		});
	});
});

describe("validateJevPolicyResponse", () => {
	it("accepts the pinned response with requested answers", () => {
		const response = {
			model: JEV_MODEL,
			answers: {
				next_element: { type: "choice", choice: "c0", confidence: 0.9 },
				unambiguous_match: { type: "noul", noul: 0.92 },
			},
			usage: { input_tokens: 10, output_tokens: 2 },
		};

		expect(validateJevPolicyResponse(response, request.questions)).toEqual({
			ok: true,
			value: response,
		});
	});

	it.each([
		[null, `response did not confirm pinned model ${JEV_MODEL}`],
		[{ model: "jev-latest", answers: {} }, `response did not confirm pinned model ${JEV_MODEL}`],
		[
			{ model: JEV_MODEL, answers: {} },
			"response next_element.choice is not one of the request criteria",
		],
		[
			{
				model: JEV_MODEL,
				answers: {
					next_element: { choice: "c0" },
					unambiguous_match: { noul: 2 },
				},
			},
			"response unambiguous_match.noul must be between 0 and 1",
		],
	] as const)("rejects malformed provider responses", (response, message) => {
		expect(validateJevPolicyResponse(response, request.questions)).toEqual({
			ok: false,
			error: { code: "invalid-jev-response", message },
		});
	});
});
