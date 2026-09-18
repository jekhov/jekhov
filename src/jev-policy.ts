// pattern: Functional Core
import type { EntryType, Questions, SystemOneRequest } from "@typesafe-ai/sdk";
import type { Result } from "./types.js";

export const JEV_MODEL = "jev-1.13.0";
export const MAX_JEV_REQUEST_BYTES = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function denied<T>(message: string): Result<T> {
	return { ok: false, error: { code: "jev-policy-denied", message } };
}

function invalidResponse<T>(message: string): Result<T> {
	return { ok: false, error: { code: "invalid-jev-response", message } };
}

export function validateJevPolicyRequest(
	input: unknown,
	dataClass: unknown,
): Result<SystemOneRequest<Questions>> {
	if (dataClass !== "public" && dataClass !== "synthetic") {
		return denied("data class must be public or synthetic");
	}
	if (!isRecord(input)) return denied("request must be a JSON object");
	if (Object.hasOwn(input, "model")) {
		return denied(`request must not set model; the wrapper pins ${JEV_MODEL}`);
	}
	if (!isRecord(input.state)) return denied("request.state must be a JSON object");
	if (!isRecord(input.questions)) {
		return denied("request must contain next_element and unambiguous_match questions");
	}
	const questionNames = Object.keys(input.questions);
	const nextElement = input.questions.next_element;
	const unambiguousMatch = input.questions.unambiguous_match;
	if (questionNames.length !== 2 || !isRecord(nextElement) || !isRecord(unambiguousMatch)) {
		return denied("request must contain next_element and unambiguous_match questions");
	}
	if (
		nextElement.type !== "choice" ||
		typeof nextElement.instructions !== "string" ||
		!nextElement.instructions.trim() ||
		!isRecord(nextElement.criteria) ||
		Object.keys(nextElement.criteria).length < 2 ||
		!Object.values(nextElement.criteria).every((value) => typeof value === "string")
	) {
		return denied("next_element must be a choice question with at least two criteria");
	}
	if (
		unambiguousMatch.type !== "noul" ||
		typeof unambiguousMatch.instructions !== "string" ||
		!unambiguousMatch.instructions.trim()
	) {
		return denied("unambiguous_match must be a noul question");
	}

	const request = {
		state: input.state as EntryType,
		questions: input.questions as unknown as Questions,
		model: JEV_MODEL,
	};
	const serialized = JSON.stringify(request);
	if (Buffer.byteLength(serialized, "utf8") > MAX_JEV_REQUEST_BYTES) {
		return denied(`request exceeds the ${MAX_JEV_REQUEST_BYTES}-byte local ceiling`);
	}
	if (dataClass === "public" && /(?:did:plc:|at:\/\/)/i.test(serialized)) {
		return denied("public requests must strip AT Protocol DIDs and URIs");
	}
	return { ok: true, value: request };
}

export function validateJevPolicyResponse(
	input: unknown,
	questions: Questions,
): Result<Record<string, unknown>> {
	if (!isRecord(input) || input.model !== JEV_MODEL) {
		return invalidResponse(`response did not confirm pinned model ${JEV_MODEL}`);
	}
	const answers = input.answers;
	const criteria = questions.next_element;
	if (!isRecord(answers) || !isRecord(criteria) || criteria.type !== "choice") {
		return invalidResponse("response next_element.choice is not one of the request criteria");
	}
	const nextElement = answers.next_element;
	if (
		!isRecord(nextElement) ||
		typeof nextElement.choice !== "string" ||
		!Object.hasOwn(criteria.criteria, nextElement.choice)
	) {
		return invalidResponse("response next_element.choice is not one of the request criteria");
	}
	const unambiguousMatch = answers.unambiguous_match;
	if (
		!isRecord(unambiguousMatch) ||
		typeof unambiguousMatch.noul !== "number" ||
		unambiguousMatch.noul < 0 ||
		unambiguousMatch.noul > 1
	) {
		return invalidResponse("response unambiguous_match.noul must be between 0 and 1");
	}
	return { ok: true, value: input };
}
