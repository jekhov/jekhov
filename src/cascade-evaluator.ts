// pattern: Imperative Shell

import { projectSafeProvenance } from "./selection.js";
import type { BrowserAction, Failure, JevEvaluator, Result } from "./types.js";

type CascadeReason =
	| "invalid-primary-response"
	| "low-match-probability"
	| "primary-abstention"
	| "primary-error";

interface RawSelectionResponse {
	answers: Record<string, unknown>;
	choice: string;
	matchProbability: number;
	provenance: Record<string, unknown>;
	usage: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRawSelection(
	value: unknown,
	allowedChoices: ReadonlySet<string>,
	requiresAmbiguity: boolean,
): RawSelectionResponse | undefined {
	if (!isRecord(value) || !isRecord(value.provenance) || !isRecord(value.answers)) return undefined;
	const nextElement = value.answers.next_element;
	const unambiguousMatch = value.answers.unambiguous_match;
	const choiceConfidence =
		nextElement && isRecord(nextElement) ? nextElement.confidence : undefined;
	if (
		!isRecord(nextElement) ||
		typeof nextElement.choice !== "string" ||
		!allowedChoices.has(nextElement.choice) ||
		(requiresAmbiguity
			? !isRecord(unambiguousMatch) ||
				typeof unambiguousMatch.noul !== "number" ||
				!Number.isFinite(unambiguousMatch.noul) ||
				unambiguousMatch.noul < 0 ||
				unambiguousMatch.noul > 1
			: typeof choiceConfidence !== "number" ||
				!Number.isFinite(choiceConfidence) ||
				choiceConfidence < 0 ||
				choiceConfidence > 1)
	) {
		return undefined;
	}
	return {
		answers: value.answers,
		choice: nextElement.choice,
		matchProbability: requiresAmbiguity
			? ((unambiguousMatch as Record<string, unknown>).noul as number)
			: (choiceConfidence as number),
		provenance: value.provenance,
		usage: Object.hasOwn(value, "usage") ? value.usage : null,
	};
}

function withTelemetry(
	failure: Failure,
	input: {
		primaryResult: Result<unknown>;
		primary: RawSelectionResponse | undefined;
		reason: CascadeReason;
		threshold: number;
		requestCount: number;
	},
): Result<never> {
	const failureProvenance = (value: Failure): Record<string, unknown> => ({
		...projectSafeProvenance(value.telemetry?.provenance ?? {}),
		failure: { code: value.code },
	});
	return {
		ok: false,
		error: {
			...failure,
			telemetry: {
				requestCount: input.requestCount,
				provenance: {
					provider: "jekhov-cascade",
					route: "fallback",
					reason: input.reason,
					threshold: input.threshold,
					primary:
						input.primary?.provenance ??
						(input.primaryResult.ok
							? { invalid_response: true }
							: failureProvenance(input.primaryResult.error)),
					fallback: failureProvenance(failure),
				},
				usage: numericUsage(
					input.primary?.usage,
					input.primaryResult.ok ? null : input.primaryResult.error.telemetry?.usage,
					failure.telemetry?.usage,
				),
			},
		},
	};
}

function numericUsage(...values: unknown[]): Record<string, number> | null {
	const totals: Record<string, number> = {};
	for (const value of values) {
		if (!isRecord(value)) continue;
		for (const [key, item] of Object.entries(value)) {
			if (typeof item === "number" && Number.isFinite(item)) {
				totals[key] = (totals[key] ?? 0) + item;
			}
		}
	}
	return Object.keys(totals).length > 0 ? totals : null;
}

function invalidThreshold(
	thresholds: Record<BrowserAction, number>,
): { action: BrowserAction; message: string } | undefined {
	for (const action of ["click", "fill", "select", "check"] as const) {
		const threshold = thresholds[action];
		if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
			return { action, message: `${action} threshold must be 0-1` };
		}
	}
	return undefined;
}

export function createThresholdCascadeEvaluator(options: {
	primary: JevEvaluator;
	fallback: JevEvaluator;
	thresholds: Record<BrowserAction, number>;
}): JevEvaluator {
	const thresholdFailure = invalidThreshold(options.thresholds);
	return {
		maximumRequestCount: 2,
		async evaluate(request, dataClass): Promise<Result<unknown>> {
			if (thresholdFailure) {
				return {
					ok: false,
					error: { code: "invalid-cascade-threshold", message: thresholdFailure.message },
				};
			}
			const threshold = options.thresholds[request.state.intended_action];
			const allowedChoices = new Set(Object.keys(request.questions.next_element.criteria));
			const requiresAmbiguity = Object.hasOwn(request.questions, "unambiguous_match");
			const primaryResult = await options.primary.evaluate(request, dataClass);
			const primary = primaryResult.ok
				? parseRawSelection(primaryResult.value, allowedChoices, requiresAmbiguity)
				: undefined;
			let reason: CascadeReason | null = null;
			if (!primaryResult.ok) reason = "primary-error";
			else if (!primary) reason = "invalid-primary-response";
			else if (primary.choice === "none") reason = "primary-abstention";
			else if (primary.matchProbability < threshold) reason = "low-match-probability";

			if (!reason && primary) {
				return {
					ok: true,
					value: {
						request_count: 1,
						provenance: {
							provider: "jekhov-cascade",
							route: "primary",
							threshold,
							primary: primary.provenance,
						},
						usage: primary.usage,
						answers: primary.answers,
					},
				};
			}

			const fallbackResult = await options.fallback.evaluate(request, dataClass);
			if (!fallbackResult.ok) {
				return withTelemetry(fallbackResult.error, {
					primaryResult,
					primary,
					reason: reason as CascadeReason,
					threshold,
					requestCount: 2,
				});
			}
			const fallback = parseRawSelection(fallbackResult.value, allowedChoices, requiresAmbiguity);
			if (!fallback) {
				return withTelemetry(
					{
						code: "invalid-fallback-response",
						message: "fallback response is missing a valid selection decision",
					},
					{
						primaryResult,
						primary,
						reason: reason as CascadeReason,
						threshold,
						requestCount: 2,
					},
				);
			}
			return {
				ok: true,
				value: {
					request_count: 2,
					provenance: {
						provider: "jekhov-cascade",
						route: "fallback",
						reason,
						threshold,
						primary:
							primary?.provenance ??
							(primaryResult.ok ? { invalid_response: true } : { failure: primaryResult.error }),
						fallback: fallback.provenance,
					},
					usage: numericUsage(primary?.usage, fallback.usage),
					answers: fallback.answers,
				},
			};
		},
	};
}
