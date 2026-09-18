// pattern: Functional Core
import type { Result } from "./types.js";

const MAX_SELECTORS = 8;
const MAX_COMPONENTS = 16;
const USAGE_FIELD_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export interface PricingComponent {
	usageField: string;
	usdPerMillion: number;
	subtractUsageFields?: string[];
}

export interface SelectorPricing {
	model: string;
	sourceUrl: string;
	components: PricingComponent[];
}

export interface EvaluationPricing {
	version: 1;
	currency: "USD";
	asOf: string;
	selectors: Record<string, SelectorPricing>;
}

export interface UsageCostComponent {
	usageField: string;
	billableTokens: number;
	usdPerMillion: number;
	costUsd: number;
}

export interface UsageCostEstimate {
	totalUsd: number;
	components: UsageCostComponent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function invalid<T>(message: string): Result<T> {
	return { ok: false, error: { code: "invalid-pricing", message } };
}

function unpriced<T>(message: string): Result<T> {
	return { ok: false, error: { code: "unpriced-usage", message } };
}

function finiteNonnegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function roundUsd(value: number): number {
	return Number(value.toFixed(12));
}

function isCalendarDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split("-").map(Number);
	const date = new Date(Date.UTC(year as number, (month as number) - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === (month as number) - 1 &&
		date.getUTCDate() === day
	);
}

function parseComponent(
	input: unknown,
	selectorName: string,
	index: number,
): Result<PricingComponent> {
	if (!isRecord(input)) {
		return invalid(`selector ${selectorName} component ${index + 1} must be an object`);
	}
	if (!nonemptyString(input.usageField) || !USAGE_FIELD_PATTERN.test(input.usageField)) {
		return invalid(`selector ${selectorName} component ${index + 1} usageField is invalid`);
	}
	if (!finiteNonnegative(input.usdPerMillion)) {
		return invalid(`selector ${selectorName} component ${input.usageField} rate is invalid`);
	}
	let subtractUsageFields: string[] | undefined;
	if (input.subtractUsageFields !== undefined) {
		if (
			!Array.isArray(input.subtractUsageFields) ||
			input.subtractUsageFields.length > MAX_COMPONENTS ||
			!input.subtractUsageFields.every(
				(field) =>
					nonemptyString(field) && USAGE_FIELD_PATTERN.test(field) && field !== input.usageField,
			)
		) {
			return invalid(
				`selector ${selectorName} component ${input.usageField} subtractUsageFields is invalid`,
			);
		}
		subtractUsageFields = [...new Set(input.subtractUsageFields)];
	}
	return {
		ok: true,
		value: {
			usageField: input.usageField,
			usdPerMillion: input.usdPerMillion,
			...(subtractUsageFields && subtractUsageFields.length > 0 ? { subtractUsageFields } : {}),
		},
	};
}

export function parseEvaluationPricing(input: unknown): Result<EvaluationPricing> {
	if (!isRecord(input)) return invalid("pricing must be a JSON object");
	if (input.version !== 1) return invalid("pricing.version must be 1");
	if (input.currency !== "USD") return invalid("pricing.currency must be USD");
	if (typeof input.asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) {
		return invalid("pricing.asOf must be an ISO date");
	}
	if (!isCalendarDate(input.asOf)) return invalid("pricing.asOf must be a real calendar date");
	if (!isRecord(input.selectors)) return invalid("pricing.selectors must be an object");
	const entries = Object.entries(input.selectors);
	if (entries.length < 1 || entries.length > MAX_SELECTORS) {
		return invalid(`pricing.selectors must contain 1-${MAX_SELECTORS} selectors`);
	}

	const selectors: Record<string, SelectorPricing> = {};
	const selectorNames = new Set<string>();
	for (const [rawName, value] of entries) {
		const name = rawName.trim();
		if (!name) return invalid("pricing selector names must be nonempty");
		if (selectorNames.has(name)) {
			return invalid(`pricing selector names must be unique after trimming: ${name}`);
		}
		selectorNames.add(name);
		if (!isRecord(value)) return invalid(`selector ${name} pricing must be an object`);
		if (!nonemptyString(value.model)) return invalid(`selector ${name} model is required`);
		if (!nonemptyString(value.sourceUrl) || !value.sourceUrl.startsWith("https://")) {
			return invalid(`selector ${name} sourceUrl must be HTTPS`);
		}
		if (
			!Array.isArray(value.components) ||
			value.components.length < 1 ||
			value.components.length > MAX_COMPONENTS
		) {
			return invalid(`selector ${name} must contain 1-${MAX_COMPONENTS} pricing components`);
		}
		const components: PricingComponent[] = [];
		for (const [index, componentInput] of value.components.entries()) {
			const component = parseComponent(componentInput, name, index);
			if (!component.ok) return component;
			components.push(component.value);
		}
		if (new Set(components.map((component) => component.usageField)).size !== components.length) {
			return invalid(`selector ${name} component usage fields must be unique`);
		}
		selectors[name] = {
			model: value.model.trim(),
			sourceUrl: value.sourceUrl,
			components,
		};
	}

	return {
		ok: true,
		value: { version: 1, currency: "USD", asOf: input.asOf, selectors },
	};
}

function usageCount(usage: Record<string, unknown>, field: string): Result<number> {
	const value = usage[field];
	if (value === undefined) return unpriced(`usage field ${field} is missing`);
	if (!finiteNonnegative(value))
		return unpriced(`usage field ${field} must be a finite nonnegative number`);
	return { ok: true, value };
}

export function estimateUsageCost(
	usage: unknown,
	pricing: SelectorPricing,
): Result<UsageCostEstimate> {
	if (!isRecord(usage)) return unpriced("usage must be an object");
	let totalUsd = 0;
	const components: UsageCostComponent[] = [];
	for (const component of pricing.components) {
		const base = usageCount(usage, component.usageField);
		if (!base.ok) return base;
		let billableTokens = base.value;
		for (const field of component.subtractUsageFields ?? []) {
			const subtracted = usageCount(usage, field);
			if (!subtracted.ok) return subtracted;
			billableTokens -= subtracted.value;
		}
		if (billableTokens < 0) {
			return unpriced(`usage deductions exceed ${component.usageField}`);
		}
		const costUsd = roundUsd((billableTokens * component.usdPerMillion) / 1_000_000);
		totalUsd += costUsd;
		components.push({
			usageField: component.usageField,
			billableTokens,
			usdPerMillion: component.usdPerMillion,
			costUsd,
		});
	}
	return { ok: true, value: { totalUsd: roundUsd(totalUsd), components } };
}
