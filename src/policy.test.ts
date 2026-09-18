// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { parseShadowPlan, validateObservedFrames, validateObservedUrl } from "./policy.js";

const publicPlan = {
	version: 1,
	mode: "shadow",
	goal: "Find the next results page",
	startUrl: "https://shop.example/search?q=jacket",
	dataClass: "public",
	sourcePolicy: {
		allowedHosts: ["shop.example"],
		basis: "terms-reviewed",
		providerDisclosure: "allowed",
		reviewedAt: "2026-09-17",
		note: "Public search pages reviewed for this bounded evaluation.",
	},
	step: { id: "next-page", action: "click", goal: "Open the next results page" },
};

describe("parseShadowPlan", () => {
	it("accepts an explicit public-source policy", () => {
		const result = parseShadowPlan(publicPlan);

		expect(result.ok).toBe(true);
	});

	it("rejects a public URL unless its exact host is allowlisted", () => {
		const result = parseShadowPlan({
			...publicPlan,
			sourcePolicy: { ...publicPlan.sourcePolicy, allowedHosts: ["example.com"] },
		});

		expect(result).toEqual({
			ok: false,
			error: {
				code: "host-not-allowed",
				message: "startUrl host shop.example is not in sourcePolicy.allowedHosts",
			},
		});
	});

	it("allows data URLs only for declared synthetic input", () => {
		const result = parseShadowPlan({
			...publicPlan,
			startUrl: "data:text/html,<button>Continue</button>",
			dataClass: "synthetic",
			sourcePolicy: {
				allowedHosts: [],
				basis: "synthetic",
				reviewedAt: "2026-09-17",
				note: "Repository-owned test fixture.",
			},
		});

		expect(result.ok).toBe(true);
	});

	it("rejects redirects outside the allowlist", () => {
		const parsed = parseShadowPlan(publicPlan);
		if (!parsed.ok) throw new Error("fixture plan must parse");

		expect(validateObservedUrl("https://auth.example/login", parsed.value)).toEqual({
			ok: false,
			error: {
				code: "redirect-host-not-allowed",
				message: "observed host auth.example is not in sourcePolicy.allowedHosts",
			},
		});
	});

	it("rejects an accessibility observation containing a disallowed child frame", () => {
		const parsed = parseShadowPlan(publicPlan);
		if (!parsed.ok) throw new Error("fixture plan must parse");

		expect(
			validateObservedFrames(
				["https://shop.example/search", "https://tracking.example/private-frame"],
				parsed.value,
			),
		).toEqual({
			ok: false,
			error: {
				code: "frame-host-not-allowed",
				message: "observed frame host tracking.example is not in sourcePolicy.allowedHosts",
			},
		});
	});

	it.each([
		[null, "invalid-plan"],
		[{ ...publicPlan, version: 2 }, "invalid-plan"],
		[{ ...publicPlan, mode: "act" }, "invalid-plan"],
		[{ ...publicPlan, goal: "" }, "invalid-plan"],
		[{ ...publicPlan, startUrl: "" }, "invalid-plan"],
		[{ ...publicPlan, dataClass: "private" }, "invalid-plan"],
		[{ ...publicPlan, sourcePolicy: null }, "invalid-plan"],
		[
			{ ...publicPlan, sourcePolicy: { ...publicPlan.sourcePolicy, allowedHosts: "shop.example" } },
			"invalid-plan",
		],
		[
			{
				...publicPlan,
				sourcePolicy: { ...publicPlan.sourcePolicy, allowedHosts: ["SHOP.EXAMPLE"] },
			},
			"invalid-plan",
		],
		[
			{ ...publicPlan, sourcePolicy: { ...publicPlan.sourcePolicy, basis: "guess" } },
			"invalid-plan",
		],
		[
			{
				...publicPlan,
				sourcePolicy: { ...publicPlan.sourcePolicy, providerDisclosure: undefined },
			},
			"invalid-plan",
		],
		[
			{ ...publicPlan, sourcePolicy: { ...publicPlan.sourcePolicy, reviewedAt: "yesterday" } },
			"invalid-plan",
		],
		[
			{ ...publicPlan, sourcePolicy: { ...publicPlan.sourcePolicy, reviewedAt: "2026-99-99" } },
			"invalid-plan",
		],
		[
			{ ...publicPlan, sourcePolicy: { ...publicPlan.sourcePolicy, note: "short" } },
			"invalid-plan",
		],
		[{ ...publicPlan, step: null }, "invalid-plan"],
		[{ ...publicPlan, step: { ...publicPlan.step, id: "" } }, "invalid-plan"],
		[{ ...publicPlan, step: { ...publicPlan.step, action: "type" } }, "invalid-plan"],
		[{ ...publicPlan, step: { ...publicPlan.step, goal: "" } }, "invalid-plan"],
		[{ ...publicPlan, startUrl: "not a url" }, "invalid-url"],
		[{ ...publicPlan, startUrl: "ftp://shop.example/file" }, "invalid-url-policy"],
		[{ ...publicPlan, startUrl: "https://user:pass@shop.example/" }, "invalid-url-policy"],
		[
			{ ...publicPlan, sourcePolicy: { ...publicPlan.sourcePolicy, basis: "synthetic" } },
			"invalid-url-policy",
		],
	])("rejects malformed policy input %#", (input, code) => {
		const result = parseShadowPlan(input);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("invalid fixture unexpectedly parsed");
		expect(result.error.code).toBe(code);
	});

	it("deduplicates allowed hosts", () => {
		const result = parseShadowPlan({
			...publicPlan,
			sourcePolicy: {
				...publicPlan.sourcePolicy,
				allowedHosts: ["shop.example", "shop.example"],
			},
		});
		if (!result.ok) throw new Error("fixture should parse");
		expect(result.value.sourcePolicy.allowedHosts).toEqual(["shop.example"]);
	});

	it("accepts an allowlisted observed URL and rejects malformed observations", () => {
		const parsed = parseShadowPlan(publicPlan);
		if (!parsed.ok) throw new Error("fixture plan must parse");
		expect(validateObservedUrl("https://shop.example/results", parsed.value).ok).toBe(true);
		expect(validateObservedUrl("not a url", parsed.value)).toEqual({
			ok: false,
			error: { code: "invalid-observed-url", message: "browser returned an invalid URL" },
		});
	});

	it("accepts an observed data URL for a synthetic plan", () => {
		const parsed = parseShadowPlan({
			...publicPlan,
			startUrl: "data:text/html,test",
			dataClass: "synthetic",
			sourcePolicy: {
				allowedHosts: [],
				basis: "synthetic",
				reviewedAt: "2026-09-17",
				note: "Repository fixture data.",
			},
		});
		if (!parsed.ok) throw new Error("fixture plan must parse");
		expect(validateObservedUrl("data:text/html,result", parsed.value).ok).toBe(true);
	});
});
