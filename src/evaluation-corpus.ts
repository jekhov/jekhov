// pattern: Functional Core
import { collectActionCandidates } from "./candidates.js";
import { parseShadowPlan, validateObservedUrl } from "./policy.js";
import type { PageObservation, Result, ShadowPlan } from "./types.js";

const MAX_CASES = 200;
const MAX_TAGS = 16;

export interface EvaluationLabel {
	expectedRef: string | null;
}

export interface EvaluationCase {
	id: string;
	tags: string[];
	plan: ShadowPlan;
	observation: PageObservation;
	label: EvaluationLabel;
}

export interface EvaluationCorpus {
	version: 1;
	name: string;
	cases: EvaluationCase[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function invalid<T>(message: string): Result<T> {
	return { ok: false, error: { code: "invalid-corpus", message } };
}

function parseCase(input: unknown, index: number): Result<EvaluationCase> {
	if (!isRecord(input)) return invalid(`case ${index + 1} must be a JSON object`);
	if (!nonemptyString(input.id)) return invalid(`case ${index + 1} id is required`);
	const id = input.id.trim();
	if (!Array.isArray(input.tags)) return invalid(`case ${id} tags must be an array`);
	if (
		input.tags.length > MAX_TAGS ||
		!input.tags.every((tag) => nonemptyString(tag) && tag.trim().length <= 80)
	) {
		return invalid(`case ${id} tags must contain at most ${MAX_TAGS} nonempty strings`);
	}

	const plan = parseShadowPlan(input.plan);
	if (!plan.ok) return plan;
	if (!isRecord(input.observation)) return invalid(`case ${id} observation is required`);
	if (!nonemptyString(input.observation.url)) {
		return invalid(`case ${id} observation.url is required`);
	}
	if (typeof input.observation.title !== "string") {
		return invalid(`case ${id} observation.title must be a string`);
	}
	const observedUrl = validateObservedUrl(input.observation.url, plan.value);
	if (!observedUrl.ok) return observedUrl;
	const candidates = collectActionCandidates(input.observation.snapshot, {
		action: plan.value.step.action,
	});
	if (!candidates.ok) return candidates;

	if (!isRecord(input.label) || !Object.hasOwn(input.label, "expectedRef")) {
		return invalid(`case ${id} label.expectedRef must be a string or null`);
	}
	const expectedRef = input.label.expectedRef;
	if (expectedRef !== null && !nonemptyString(expectedRef)) {
		return invalid(`case ${id} label.expectedRef must be a string or null`);
	}
	const normalizedExpectedRef = expectedRef === null ? null : expectedRef.trim();
	if (
		normalizedExpectedRef !== null &&
		!candidates.value.candidates.some((candidate) => candidate.ref === normalizedExpectedRef)
	) {
		return invalid(
			`case ${id} expectedRef ${normalizedExpectedRef} is not an eligible ${plan.value.step.action} candidate`,
		);
	}

	return {
		ok: true,
		value: {
			id,
			tags: [...new Set(input.tags.map((tag) => tag.trim()))],
			plan: plan.value,
			observation: {
				url: input.observation.url,
				title: input.observation.title.slice(0, 500),
				snapshot: input.observation.snapshot,
			},
			label: { expectedRef: normalizedExpectedRef },
		},
	};
}

export function parseEvaluationCorpus(input: unknown): Result<EvaluationCorpus> {
	if (!isRecord(input)) return invalid("corpus must be a JSON object");
	if (input.version !== 1) return invalid("corpus.version must be 1");
	if (!nonemptyString(input.name)) return invalid("corpus.name is required");
	if (!Array.isArray(input.cases) || input.cases.length < 1 || input.cases.length > MAX_CASES) {
		return invalid(`corpus.cases must contain 1-${MAX_CASES} cases`);
	}

	const cases: EvaluationCase[] = [];
	const ids = new Set<string>();
	for (const [index, value] of input.cases.entries()) {
		const parsed = parseCase(value, index);
		if (!parsed.ok) return parsed;
		if (ids.has(parsed.value.id)) {
			return invalid(`case IDs must be unique: ${parsed.value.id}`);
		}
		ids.add(parsed.value.id);
		cases.push(parsed.value);
	}

	return {
		ok: true,
		value: { version: 1, name: input.name.trim(), cases },
	};
}
