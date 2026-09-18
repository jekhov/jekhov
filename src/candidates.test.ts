// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { collectActionCandidates, MAX_SNAPSHOT_ENTRIES } from "./candidates.js";

const snapshot = [
	{
		role: "main",
		ref: "e1",
		children: [
			{ role: "heading", name: "Shop", level: 1, ref: "e2" },
			{
				role: "list",
				name: "Results",
				ref: "e3",
				children: [
					{
						role: "listitem",
						name: "Outerwear",
						ref: "e4",
						children: [
							{
								role: "link",
								name: "Blue jacket",
								url: "/item/1",
								ref: "e5",
							},
						],
					},
					{ role: "button", name: "Next", ref: "e6", disabled: true },
				],
			},
			{ role: "textbox", name: "Search", placeholder: "Find items", ref: "e7" },
			{ role: "generic", name: "Open filters", cursor: "pointer", ref: "e8" },
		],
	},
];

describe("collectActionCandidates", () => {
	it("returns only enabled candidates compatible with the intended action", () => {
		const result = collectActionCandidates(snapshot, { action: "click", limit: 10 });

		expect(result).toEqual({
			ok: true,
			value: {
				candidates: [
					{
						id: "c0",
						ref: "e5",
						role: "link",
						name: "Blue jacket",
						context: ["Results", "Outerwear"],
						url: "/item/1",
					},
					{
						id: "c1",
						ref: "e8",
						role: "generic",
						name: "Open filters",
						context: [],
						cursor: "pointer",
					},
				],
				omittedCount: 0,
			},
		});
	});

	it("uses editable roles for fill and caps candidates deterministically", () => {
		const result = collectActionCandidates(snapshot, { action: "fill", limit: 1 });

		expect(result).toEqual({
			ok: true,
			value: {
				candidates: [
					{
						id: "c0",
						ref: "e7",
						role: "textbox",
						name: "Search",
						context: [],
						placeholder: "Find items",
					},
				],
				omittedCount: 0,
			},
		});
	});

	it("rejects malformed snapshots instead of silently inventing candidates", () => {
		expect(collectActionCandidates({ role: "button" }, { action: "click" })).toEqual({
			ok: false,
			error: {
				code: "invalid-snapshot",
				message: "Playwright accessibility snapshot must be an array",
			},
		});
	});

	it("supports check and select intents", () => {
		const mixed = [
			{ role: "checkbox", name: "Used", ref: "e1" },
			{ role: "combobox", name: "Size", ref: "e2" },
		];

		expect(collectActionCandidates(mixed, { action: "check" })).toMatchObject({
			ok: true,
			value: { candidates: [{ role: "checkbox" }] },
		});
		expect(collectActionCandidates(mixed, { action: "select" })).toMatchObject({
			ok: true,
			value: { candidates: [{ role: "combobox" }] },
		});
	});

	it("caps results, counts omissions, deduplicates refs, and falls back to placeholders", () => {
		const result = collectActionCandidates(
			[
				{ role: "textbox", placeholder: "  Search\u0000 items  ", ref: "e1" },
				{ role: "textbox", name: "duplicate", ref: "e1" },
				{ role: "searchbox", ref: "e2" },
			],
			{ action: "fill", limit: 1 },
		);

		expect(result).toEqual({
			ok: true,
			value: {
				candidates: [
					{
						id: "c0",
						ref: "e1",
						role: "textbox",
						name: "Search items",
						context: [],
						placeholder: "Search items",
					},
				],
				omittedCount: 1,
			},
		});
	});

	it.each([0, 64, 1.5])("rejects candidate limit %s", (limit) => {
		expect(collectActionCandidates([], { action: "click", limit })).toEqual({
			ok: false,
			error: { code: "invalid-candidate-limit", message: "candidate limit must be 1-63" },
		});
	});

	it("ignores primitive, malformed, and nonmatching nodes", () => {
		expect(
			collectActionCandidates(
				[
					null,
					"text",
					{ role: 4, ref: "e1" },
					{ role: "button", name: "No ref" },
					{ role: "generic", cursor: "pointer", ref: "e2", children: "not-an-array" },
				],
				{ action: "fill" },
			),
		).toEqual({ ok: true, value: { candidates: [], omittedCount: 0 } });
	});

	it("handles deeply nested snapshots without exhausting the JavaScript call stack", () => {
		let nested: Record<string, unknown> = {
			role: "button",
			name: "Deep target",
			ref: "e1",
		};
		for (let index = 0; index < 20_000; index += 1) {
			nested = { role: "group", name: `Layer ${index}`, children: [nested] };
		}

		expect(collectActionCandidates([nested], { action: "click" })).toMatchObject({
			ok: true,
			value: {
				candidates: [{ name: "Deep target", context: ["Layer 1", "Layer 0"] }],
				omittedCount: 0,
			},
		});
	});

	it("rejects snapshots that exceed the deterministic traversal budget", () => {
		expect(
			collectActionCandidates(
				Array.from({ length: MAX_SNAPSHOT_ENTRIES + 1 }, () => "text"),
				{
					action: "click",
				},
			),
		).toEqual({
			ok: false,
			error: {
				code: "snapshot-too-large",
				message: `accessibility snapshot exceeds ${MAX_SNAPSHOT_ENTRIES} entries`,
			},
		});
	});

	it("rejects oversized nested child lists before adding them to the traversal stack", () => {
		expect(
			collectActionCandidates(
				[
					{
						role: "group",
						children: Array.from({ length: MAX_SNAPSHOT_ENTRIES }, () => "text"),
					},
				],
				{ action: "click" },
			),
		).toMatchObject({ ok: false, error: { code: "snapshot-too-large" } });
	});

	it("does not loop when a library caller supplies a cyclic snapshot", () => {
		const cyclic: Record<string, unknown> = { role: "group", name: "Cycle" };
		cyclic.children = [cyclic, { role: "button", name: "Continue", ref: "e1" }];

		expect(collectActionCandidates([cyclic], { action: "click" })).toMatchObject({
			ok: true,
			value: { candidates: [{ name: "Continue" }], omittedCount: 0 },
		});
	});
});
