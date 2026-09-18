// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { buildSelectionRequest, parseSelectionResponse } from "./selection.js";
import type { ActionCandidate } from "./types.js";

const candidates: ActionCandidate[] = [
	{
		id: "c0",
		ref: "e4",
		role: "link",
		name: "Next",
		context: ["Pagination"],
		url: "/search?page=2",
	},
	{
		id: "c1",
		ref: "e5",
		role: "button",
		name: "Save search",
		context: [],
	},
];

describe("buildSelectionRequest", () => {
	it("sends compact candidates and an explicit abstention option", () => {
		const request = buildSelectionRequest({
			goal: "Open the next results page",
			action: "click",
			pageUrl: "https://shop.example/search?page=1",
			pageTitle: "Jackets",
			candidates,
		});

		expect(request.state).toEqual({
			goal: "Open the next results page",
			intended_action: "click",
			page: { title: "Jackets", url: "https://shop.example/search?page=[redacted]" },
			candidates: [
				{
					id: "c0",
					role: "link",
					name: "Next",
					context: ["Pagination"],
					url: "/search?page=[redacted]",
				},
				{ id: "c1", role: "button", name: "Save search", context: [] },
			],
		});
		expect(request.questions.next_element.criteria).toEqual({
			c0: 'link named "Next" in Pagination; url=/search?page=[redacted]',
			c1: 'button named "Save search"',
			none: "No candidate clearly advances the stated goal",
		});
		expect(request.questions.unambiguous_match.type).toBe("noul");
	});

	it("includes optional target clues without disclosing Playwright refs", () => {
		const request = buildSelectionRequest({
			goal: "Search",
			action: "fill",
			pageUrl: "data:text/html,test",
			pageTitle: "Test",
			candidates: [
				{
					id: "c0",
					ref: "e9",
					role: "textbox",
					name: "Search",
					context: [],
					placeholder: "Find items",
					cursor: "text",
				},
			],
		});

		expect(request.state.candidates[0]).toEqual({
			id: "c0",
			role: "textbox",
			name: "Search",
			context: [],
			placeholder: "Find items",
			cursor: "text",
		});
		expect(JSON.stringify(request)).not.toContain("e9");
		expect(request.state.page.url).toBe("data:text/html,[omitted]");
	});

	it("redacts query values and fragments before disclosure", () => {
		const request = buildSelectionRequest({
			goal: "Open item",
			action: "click",
			pageUrl: "https://shop.example/search?q=jacket&token=secret#results",
			pageTitle: "Search",
			candidates: [
				{
					id: "c0",
					ref: "e2",
					role: "link",
					name: "Item",
					context: [],
					url: "https://shop.example/item/1?signature=secret#photo",
				},
			],
		});

		expect(request.state.page.url).toBe(
			"https://shop.example/search?q=[redacted]&token=[redacted]",
		);
		expect(request.state.candidates[0]?.url).toBe(
			"https://shop.example/item/1?signature=[redacted]",
		);
		expect(JSON.stringify(request)).not.toContain("secret");
	});
});

describe("parseSelectionResponse", () => {
	it("keeps provenance, usage, and the Jev ambiguity probability", () => {
		const response = parseSelectionResponse(
			{
				provenance: {
					provider: "typesafe",
					requested_model: "jev-1.13.0",
					request_sha256: "abc",
					cache_hit: false,
				},
				usage: { input_tokens: 120, output_tokens: 8 },
				answers: {
					next_element: { choice: "c0" },
					unambiguous_match: { noul: 0.93 },
				},
			},
			candidates,
		);

		expect(response).toEqual({
			ok: true,
			value: {
				candidate: candidates[0],
				matchProbability: 0.93,
				provenance: {
					provider: "typesafe",
					requested_model: "jev-1.13.0",
					request_sha256: "abc",
					cache_hit: false,
				},
				usage: { input_tokens: 120, output_tokens: 8 },
			},
		});
	});

	it("represents abstention without inventing an element", () => {
		const response = parseSelectionResponse(
			{
				provenance: { provider: "typesafe" },
				usage: null,
				answers: {
					next_element: { choice: "none" },
					unambiguous_match: { noul: 0.21 },
				},
			},
			candidates,
		);

		expect(response.ok && response.value.candidate).toBeNull();
		expect(response.ok && response.value.usage).toBeNull();
	});

	it("rejects choices outside the candidate set", () => {
		expect(
			parseSelectionResponse(
				{
					provenance: { provider: "typesafe" },
					answers: {
						next_element: { choice: "c99" },
						unambiguous_match: { noul: 0.9 },
					},
				},
				candidates,
			),
		).toEqual({
			ok: false,
			error: {
				code: "invalid-jev-response",
				message: "Jev selected unknown candidate c99",
			},
		});
	});

	it.each([
		[null, "Jev response is missing provenance or answers"],
		[{ provenance: {}, answers: null }, "Jev response is missing provenance or answers"],
		[
			{ provenance: {}, answers: { next_element: null, unambiguous_match: { noul: 0.5 } } },
			"Jev response is missing next_element.choice",
		],
		[
			{
				provenance: {},
				answers: { next_element: { choice: "none" }, unambiguous_match: null },
			},
			"Jev response unambiguous_match.noul must be between 0 and 1",
		],
		[
			{
				provenance: {},
				answers: { next_element: { choice: "none" }, unambiguous_match: { noul: -0.1 } },
			},
			"Jev response unambiguous_match.noul must be between 0 and 1",
		],
		[
			{
				provenance: {},
				answers: { next_element: { choice: "none" }, unambiguous_match: { noul: 1.1 } },
			},
			"Jev response unambiguous_match.noul must be between 0 and 1",
		],
	])("rejects malformed response %#", (input, message) => {
		expect(parseSelectionResponse(input, candidates)).toEqual({
			ok: false,
			error: { code: "invalid-jev-response", message },
		});
	});
});
