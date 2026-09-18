// pattern: Functional Core
import { describe, expect, it } from "vitest";
import { estimateUsageCost, parseEvaluationPricing } from "./pricing.js";

const pricingInput = {
	version: 1,
	currency: "USD",
	asOf: "2026-09-18",
	selectors: {
		jev: {
			model: "jev-1.13.0",
			sourceUrl: "https://typesafe.ai/pricing",
			components: [
				{ usageField: "input_tokens", usdPerMillion: 0.042 },
				{ usageField: "output_tokens", usdPerMillion: 0 },
			],
		},
		baseline: {
			model: "gpt-5.6-luna",
			sourceUrl: "https://developers.openai.com/api/docs/pricing",
			components: [
				{
					usageField: "input_tokens",
					usdPerMillion: 0.2,
					subtractUsageFields: ["cached_input_tokens", "cache_write_input_tokens"],
				},
				{ usageField: "cached_input_tokens", usdPerMillion: 0.02 },
				{ usageField: "cache_write_input_tokens", usdPerMillion: 0.25 },
				{ usageField: "output_tokens", usdPerMillion: 1.2 },
			],
		},
	},
};

describe("parseEvaluationPricing", () => {
	it("accepts dated selector-specific token rates", () => {
		const result = parseEvaluationPricing(pricingInput);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("pricing should parse");
		expect(result.value.selectors.baseline?.components[0]).toEqual({
			usageField: "input_tokens",
			usdPerMillion: 0.2,
			subtractUsageFields: ["cached_input_tokens", "cache_write_input_tokens"],
		});
	});

	it.each([
		[null, "pricing must be a JSON object"],
		[{ ...pricingInput, version: 2 }, "pricing.version must be 1"],
		[{ ...pricingInput, currency: "EUR" }, "pricing.currency must be USD"],
		[{ ...pricingInput, asOf: "today" }, "pricing.asOf must be an ISO date"],
		[{ ...pricingInput, asOf: "2026-99-99" }, "pricing.asOf must be a real calendar date"],
		[{ ...pricingInput, selectors: null }, "pricing.selectors must be an object"],
		[{ ...pricingInput, selectors: {} }, "pricing.selectors must contain 1-8 selectors"],
		[
			{ ...pricingInput, selectors: { " ": pricingInput.selectors.jev } },
			"pricing selector names must be nonempty",
		],
		[
			{
				...pricingInput,
				selectors: {
					jev: pricingInput.selectors.jev,
					" jev ": pricingInput.selectors.baseline,
				},
			},
			"pricing selector names must be unique after trimming: jev",
		],
		[{ ...pricingInput, selectors: { jev: null } }, "selector jev pricing must be an object"],
		[
			{
				...pricingInput,
				selectors: { jev: { ...pricingInput.selectors.jev, model: " " } },
			},
			"selector jev model is required",
		],
		[
			{
				...pricingInput,
				selectors: {
					jev: { ...pricingInput.selectors.jev, sourceUrl: "file:///tmp/rates" },
				},
			},
			"selector jev sourceUrl must be HTTPS",
		],
		[
			{
				...pricingInput,
				selectors: { jev: { ...pricingInput.selectors.jev, components: [] } },
			},
			"selector jev must contain 1-16 pricing components",
		],
		[
			{
				...pricingInput,
				selectors: { jev: { ...pricingInput.selectors.jev, components: [null] } },
			},
			"selector jev component 1 must be an object",
		],
		[
			{
				...pricingInput,
				selectors: {
					jev: {
						...pricingInput.selectors.jev,
						components: [{ usageField: "Input tokens", usdPerMillion: 0.042 }],
					},
				},
			},
			"selector jev component 1 usageField is invalid",
		],
		[
			{
				...pricingInput,
				selectors: {
					jev: {
						...pricingInput.selectors.jev,
						components: [{ usageField: "input_tokens", usdPerMillion: -1 }],
					},
				},
			},
			"selector jev component input_tokens rate is invalid",
		],
		[
			{
				...pricingInput,
				selectors: {
					jev: {
						...pricingInput.selectors.jev,
						components: [
							{
								usageField: "input_tokens",
								usdPerMillion: 0.042,
								subtractUsageFields: "cached_input_tokens",
							},
						],
					},
				},
			},
			"selector jev component input_tokens subtractUsageFields is invalid",
		],
		[
			{
				...pricingInput,
				selectors: {
					jev: {
						...pricingInput.selectors.jev,
						components: [
							{ usageField: "input_tokens", usdPerMillion: 0.042 },
							{ usageField: "input_tokens", usdPerMillion: 0.1 },
						],
					},
				},
			},
			"selector jev component usage fields must be unique",
		],
	])("rejects invalid pricing %#", (input, message) => {
		expect(parseEvaluationPricing(input)).toEqual({
			ok: false,
			error: { code: "invalid-pricing", message },
		});
	});
});

describe("estimateUsageCost", () => {
	it("prices uncached, cached, cache-write, and output tokens without double counting", () => {
		const parsed = parseEvaluationPricing(pricingInput);
		if (!parsed.ok) throw new Error("pricing should parse");
		const rates = parsed.value.selectors.baseline;
		if (!rates) throw new Error("baseline rates should exist");

		expect(
			estimateUsageCost(
				{
					input_tokens: 1_000_000,
					cached_input_tokens: 200_000,
					cache_write_input_tokens: 100_000,
					output_tokens: 10_000,
					reasoning_output_tokens: 3_000,
				},
				rates,
			),
		).toEqual({
			ok: true,
			value: {
				totalUsd: 0.181,
				components: [
					{
						usageField: "input_tokens",
						billableTokens: 700_000,
						usdPerMillion: 0.2,
						costUsd: 0.14,
					},
					{
						usageField: "cached_input_tokens",
						billableTokens: 200_000,
						usdPerMillion: 0.02,
						costUsd: 0.004,
					},
					{
						usageField: "cache_write_input_tokens",
						billableTokens: 100_000,
						usdPerMillion: 0.25,
						costUsd: 0.025,
					},
					{
						usageField: "output_tokens",
						billableTokens: 10_000,
						usdPerMillion: 1.2,
						costUsd: 0.012,
					},
				],
			},
		});
	});

	it("rejects missing usage and inconsistent inclusive counters", () => {
		const parsed = parseEvaluationPricing(pricingInput);
		if (!parsed.ok) throw new Error("pricing should parse");
		const rates = parsed.value.selectors.baseline;
		if (!rates) throw new Error("baseline rates should exist");

		expect(estimateUsageCost(null, rates)).toMatchObject({
			ok: false,
			error: { code: "unpriced-usage" },
		});
		expect(estimateUsageCost({ input_tokens: 10, cached_input_tokens: 11 }, rates)).toMatchObject({
			ok: false,
			error: { code: "unpriced-usage" },
		});
		expect(estimateUsageCost({}, rates)).toMatchObject({
			ok: false,
			error: { code: "unpriced-usage", message: "usage field input_tokens is missing" },
		});
		expect(
			estimateUsageCost(
				{
					input_tokens: 10,
					cached_input_tokens: 0,
					cache_write_input_tokens: 0,
				},
				rates,
			),
		).toMatchObject({
			ok: false,
			error: { code: "unpriced-usage", message: "usage field output_tokens is missing" },
		});
		expect(estimateUsageCost({ input_tokens: -1 }, rates)).toMatchObject({
			ok: false,
			error: {
				code: "unpriced-usage",
				message: "usage field input_tokens must be a finite nonnegative number",
			},
		});
		expect(
			estimateUsageCost({ input_tokens: 10, cached_input_tokens: "ten" }, rates),
		).toMatchObject({
			ok: false,
			error: {
				code: "unpriced-usage",
				message: "usage field cached_input_tokens must be a finite nonnegative number",
			},
		});
	});
});
