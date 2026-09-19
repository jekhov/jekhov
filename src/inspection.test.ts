// pattern: Imperative Shell
import { describe, expect, it } from "vitest";
import { runInspection } from "./inspection.js";
import type { BrowserObserver, ShadowPlan } from "./types.js";

const plan: ShadowPlan = {
	version: 1,
	mode: "shadow",
	goal: "Open the next page",
	startUrl: "https://catalogue.example/search?session=secret",
	dataClass: "public",
	sourcePolicy: {
		allowedHosts: ["catalogue.example"],
		basis: "terms-reviewed",
		providerDisclosure: "allowed",
		reviewedAt: "2026-09-18",
		note: "Public catalogue pages reviewed for bounded inspection.",
	},
	step: { id: "next", action: "click", goal: "Open the next results page" },
};

describe("runInspection", () => {
	it("adds durable report metadata without exposing URL values", async () => {
		const browser: BrowserObserver = {
			async observe() {
				return {
					ok: true,
					value: {
						url: plan.startUrl,
						title: "Catalogue",
						snapshot: [
							{
								role: "link",
								name: "Next",
								ref: "e1",
								url: "https://catalogue.example/results?page=2",
							},
						],
					},
				};
			},
		};

		const result = await runInspection(plan, browser, {
			generatedAt: () => new Date("2026-09-18T20:00:00.000Z"),
		});

		expect(result).toEqual({
			ok: true,
			value: {
				version: 1,
				jekhovVersion: "0.1.1",
				generatedAt: "2026-09-18T20:00:00.000Z",
				planSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
				sourcePolicySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
				mode: "inspect",
				executed: false,
				stepId: "next",
				observedUrl: "https://catalogue.example/[path]?session=[redacted]",
				pageTitle: "Catalogue",
				candidates: [
					{
						id: "c0",
						ref: "e1",
						role: "link",
						name: "Next",
						context: [],
						url: "https://catalogue.example/[path]?page=[redacted]",
					},
				],
				omittedCandidateCount: 0,
			},
		});
		expect(JSON.stringify(result)).not.toContain("session=secret");
		expect(JSON.stringify(result)).not.toContain("results?page=2");
	});
});
