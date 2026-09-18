// pattern: Imperative Shell
import { describe, expect, it, vi } from "vitest";
import { runShadowSelection } from "./shadow-run.js";
import type { BrowserObserver, JevEvaluator, ShadowPlan } from "./types.js";

const plan: ShadowPlan = {
	version: 1,
	mode: "shadow",
	goal: "Find the next results page",
	startUrl: "https://shop.example/search?page=1",
	dataClass: "public",
	sourcePolicy: {
		allowedHosts: ["shop.example"],
		basis: "terms-reviewed",
		reviewedAt: "2026-09-17",
		note: "Public search pages reviewed for this bounded evaluation.",
	},
	step: { id: "next-page", action: "click", goal: "Open the next results page" },
};

describe("runShadowSelection", () => {
	it("observes and evaluates once without asking the browser to act", async () => {
		const browser: BrowserObserver = {
			observe: vi.fn().mockResolvedValue({
				ok: true,
				value: {
					url: "https://shop.example/search?page=1",
					title: "Jackets",
					snapshot: [{ role: "link", name: "Next", url: "/search?page=2", ref: "e2" }],
				},
			}),
		};
		const jev: JevEvaluator = {
			evaluate: vi.fn().mockResolvedValue({
				ok: true,
				value: {
					provenance: { provider: "typesafe", cache_hit: true },
					usage: { input_tokens: 80 },
					answers: {
						next_element: { choice: "c0" },
						unambiguous_match: { noul: 0.96 },
					},
				},
			}),
		};

		const result = await runShadowSelection(plan, { browser, jev });

		expect(result.ok).toBe(true);
		expect(browser.observe).toHaveBeenCalledOnce();
		expect(jev.evaluate).toHaveBeenCalledOnce();
		if (!result.ok) throw new Error("shadow run should succeed");
		expect(result.value.status).toBe("proposed");
		expect(result.value.proposal?.ref).toBe("e2");
		expect(result.value.executed).toBe(false);
	});

	it("blocks a redirect before page data reaches Jev", async () => {
		const browser: BrowserObserver = {
			observe: vi.fn().mockResolvedValue({
				ok: true,
				value: {
					url: "https://auth.example/login",
					title: "Login",
					snapshot: [{ role: "textbox", name: "Email", ref: "e2" }],
				},
			}),
		};
		const jev: JevEvaluator = { evaluate: vi.fn() };

		const result = await runShadowSelection(plan, { browser, jev });

		expect(result).toEqual({
			ok: false,
			error: {
				code: "redirect-host-not-allowed",
				message: "observed host auth.example is not in sourcePolicy.allowedHosts",
			},
		});
		expect(jev.evaluate).not.toHaveBeenCalled();
	});

	it("does not spend a Jev request when the page has no compatible candidates", async () => {
		const browser: BrowserObserver = {
			observe: vi.fn().mockResolvedValue({
				ok: true,
				value: {
					url: "https://shop.example/search?page=1",
					title: "Empty",
					snapshot: [{ role: "heading", name: "Nothing here", ref: "e2" }],
				},
			}),
		};
		const jev: JevEvaluator = { evaluate: vi.fn() };

		const result = await runShadowSelection(plan, { browser, jev });

		expect(result.ok && result.value.status).toBe("no-candidates");
		expect(jev.evaluate).not.toHaveBeenCalled();
	});

	it("propagates browser and Jev boundary failures", async () => {
		const browserFailure: BrowserObserver = {
			observe: vi.fn().mockResolvedValue({
				ok: false,
				error: { code: "browser-observation-failed", message: "timeout" },
			}),
		};
		const unusedJev: JevEvaluator = { evaluate: vi.fn() };
		expect(await runShadowSelection(plan, { browser: browserFailure, jev: unusedJev })).toEqual({
			ok: false,
			error: { code: "browser-observation-failed", message: "timeout" },
		});

		const browser: BrowserObserver = {
			observe: vi.fn().mockResolvedValue({
				ok: true,
				value: {
					url: plan.startUrl,
					title: "Jackets",
					snapshot: [{ role: "button", name: "Next", ref: "e2" }],
				},
			}),
		};
		const jevFailure: JevEvaluator = {
			evaluate: vi.fn().mockResolvedValue({
				ok: false,
				error: { code: "jev-client-failed", message: "denied" },
			}),
		};
		expect(await runShadowSelection(plan, { browser, jev: jevFailure })).toEqual({
			ok: false,
			error: { code: "jev-client-failed", message: "denied" },
		});
	});

	it("reports Jev abstention", async () => {
		const browser: BrowserObserver = {
			observe: vi.fn().mockResolvedValue({
				ok: true,
				value: {
					url: plan.startUrl,
					title: "Jackets",
					snapshot: [{ role: "button", name: "Maybe", ref: "e2" }],
				},
			}),
		};
		const jev: JevEvaluator = {
			evaluate: vi.fn().mockResolvedValue({
				ok: true,
				value: {
					provenance: { provider: "typesafe" },
					answers: {
						next_element: { choice: "none" },
						unambiguous_match: { noul: 0.2 },
					},
				},
			}),
		};

		const result = await runShadowSelection(plan, { browser, jev });
		expect(result.ok && result.value.status).toBe("abstained");
		expect(result.ok && result.value.proposal).toBeNull();
	});

	it("rejects malformed snapshots before Jev", async () => {
		const browser: BrowserObserver = {
			observe: vi.fn().mockResolvedValue({
				ok: true,
				value: { url: plan.startUrl, title: "Broken", snapshot: {} },
			}),
		};
		const jev: JevEvaluator = { evaluate: vi.fn() };
		const result = await runShadowSelection(plan, { browser, jev });
		expect(result.ok).toBe(false);
		expect(jev.evaluate).not.toHaveBeenCalled();
	});
});
