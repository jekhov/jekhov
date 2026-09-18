// pattern: Functional Core
import type { BrowserAction, DataClass, Result, ShadowPlan, SourcePolicyBasis } from "./types.js";

const ACTIONS = new Set<BrowserAction>(["check", "click", "fill", "select"]);
const DATA_CLASSES = new Set<DataClass>(["public", "synthetic"]);
const POLICY_BASES = new Set<SourcePolicyBasis>([
	"first-party",
	"synthetic",
	"terms-reviewed",
	"written-permission",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function fail<T>(code: string, message: string): Result<T> {
	return { ok: false, error: { code, message } };
}

function parseUrl(value: string): Result<URL> {
	try {
		return { ok: true, value: new URL(value) };
	} catch {
		return fail("invalid-url", "startUrl must be an absolute URL");
	}
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

export function parseShadowPlan(input: unknown): Result<ShadowPlan> {
	if (!isRecord(input)) return fail("invalid-plan", "plan must be a JSON object");
	if (input.version !== 1) return fail("invalid-plan", "plan.version must be 1");
	if (input.mode !== "shadow") return fail("invalid-plan", "plan.mode must be shadow");
	if (!nonemptyString(input.goal)) return fail("invalid-plan", "plan.goal is required");
	if (!nonemptyString(input.startUrl)) return fail("invalid-plan", "plan.startUrl is required");
	if (!DATA_CLASSES.has(input.dataClass as DataClass)) {
		return fail("invalid-plan", "plan.dataClass must be public or synthetic");
	}
	if (!isRecord(input.sourcePolicy)) {
		return fail("invalid-plan", "plan.sourcePolicy is required");
	}
	if (!Array.isArray(input.sourcePolicy.allowedHosts)) {
		return fail("invalid-plan", "sourcePolicy.allowedHosts must be an array");
	}
	const allowedHosts = input.sourcePolicy.allowedHosts;
	if (!allowedHosts.every((host) => nonemptyString(host) && host === host.toLowerCase())) {
		return fail("invalid-plan", "sourcePolicy.allowedHosts must contain lowercase hostnames");
	}
	if (!POLICY_BASES.has(input.sourcePolicy.basis as SourcePolicyBasis)) {
		return fail("invalid-plan", "sourcePolicy.basis is invalid");
	}
	if (
		!nonemptyString(input.sourcePolicy.reviewedAt) ||
		!isCalendarDate(input.sourcePolicy.reviewedAt)
	) {
		return fail("invalid-plan", "sourcePolicy.reviewedAt must use YYYY-MM-DD");
	}
	if (!nonemptyString(input.sourcePolicy.note) || input.sourcePolicy.note.trim().length < 8) {
		return fail("invalid-plan", "sourcePolicy.note must explain the access basis");
	}
	if (!isRecord(input.step)) return fail("invalid-plan", "plan.step is required");
	if (!nonemptyString(input.step.id)) return fail("invalid-plan", "plan.step.id is required");
	if (!ACTIONS.has(input.step.action as BrowserAction)) {
		return fail("invalid-plan", "plan.step.action is invalid");
	}
	if (!nonemptyString(input.step.goal)) return fail("invalid-plan", "plan.step.goal is required");

	const parsedUrl = parseUrl(input.startUrl);
	if (!parsedUrl.ok) return parsedUrl;
	const dataClass = input.dataClass as DataClass;
	const basis = input.sourcePolicy.basis as SourcePolicyBasis;
	if (dataClass === "public" && input.sourcePolicy.providerDisclosure !== "allowed") {
		return fail(
			"invalid-plan",
			"public sourcePolicy.providerDisclosure must explicitly be allowed",
		);
	}
	if (parsedUrl.value.protocol === "data:") {
		if (dataClass !== "synthetic" || basis !== "synthetic") {
			return fail("invalid-url-policy", "data URLs require synthetic data and policy basis");
		}
	} else {
		if (parsedUrl.value.protocol !== "https:" && parsedUrl.value.protocol !== "http:") {
			return fail("invalid-url-policy", "startUrl must use http, https, or synthetic data");
		}
		if (parsedUrl.value.username || parsedUrl.value.password) {
			return fail("invalid-url-policy", "startUrl must not contain credentials");
		}
		if (!allowedHosts.includes(parsedUrl.value.hostname)) {
			return fail(
				"host-not-allowed",
				`startUrl host ${parsedUrl.value.hostname} is not in sourcePolicy.allowedHosts`,
			);
		}
	}
	if (dataClass === "public" && basis === "synthetic") {
		return fail("invalid-url-policy", "public data cannot use a synthetic policy basis");
	}

	return {
		ok: true,
		value: {
			version: 1,
			mode: "shadow",
			goal: input.goal.trim(),
			startUrl: input.startUrl,
			dataClass,
			sourcePolicy: {
				allowedHosts: [...new Set(allowedHosts)],
				basis,
				...(dataClass === "public" ? { providerDisclosure: "allowed" as const } : {}),
				reviewedAt: input.sourcePolicy.reviewedAt,
				note: input.sourcePolicy.note.trim(),
			},
			step: {
				id: input.step.id.trim(),
				action: input.step.action as BrowserAction,
				goal: input.step.goal.trim(),
			},
		},
	};
}

export function validateObservedFrames(frameUrls: string[], plan: ShadowPlan): Result<undefined> {
	for (const value of frameUrls) {
		if (!value || value === "about:blank" || value === "about:srcdoc") continue;
		const parsed = parseUrl(value);
		if (!parsed.ok) {
			return fail("invalid-observed-frame-url", "browser returned an invalid frame URL");
		}
		if (parsed.value.protocol === "data:" && plan.dataClass === "synthetic") continue;
		if (
			(parsed.value.protocol !== "https:" && parsed.value.protocol !== "http:") ||
			!plan.sourcePolicy.allowedHosts.includes(parsed.value.hostname)
		) {
			return fail(
				"frame-host-not-allowed",
				`observed frame host ${parsed.value.hostname || "(none)"} is not in sourcePolicy.allowedHosts`,
			);
		}
	}
	return { ok: true, value: undefined };
}

export function validateObservedUrl(value: string, plan: ShadowPlan): Result<URL> {
	const parsed = parseUrl(value);
	if (!parsed.ok) return fail("invalid-observed-url", "browser returned an invalid URL");
	if (parsed.value.protocol === "data:" && plan.dataClass === "synthetic") return parsed;
	if (
		(parsed.value.protocol !== "https:" && parsed.value.protocol !== "http:") ||
		!plan.sourcePolicy.allowedHosts.includes(parsed.value.hostname)
	) {
		return fail(
			"redirect-host-not-allowed",
			`observed host ${parsed.value.hostname || "(none)"} is not in sourcePolicy.allowedHosts`,
		);
	}
	return parsed;
}
