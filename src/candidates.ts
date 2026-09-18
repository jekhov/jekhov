// pattern: Functional Core
import type { ActionCandidate, BrowserAction, CandidateSet, Result } from "./types.js";

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 63;
const TEXT_LIMIT = 160;

const ACTION_ROLES: Record<BrowserAction, ReadonlySet<string>> = {
	check: new Set(["checkbox", "radio", "switch"]),
	click: new Set([
		"button",
		"checkbox",
		"link",
		"menuitem",
		"menuitemcheckbox",
		"menuitemradio",
		"option",
		"radio",
		"switch",
		"tab",
		"treeitem",
	]),
	fill: new Set(["searchbox", "spinbutton", "textbox"]),
	select: new Set(["combobox", "listbox"]),
};

const CONTEXT_ROLES = new Set([
	"article",
	"dialog",
	"form",
	"group",
	"list",
	"listitem",
	"navigation",
	"region",
	"row",
	"table",
]);

type SnapshotRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SnapshotRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const withoutControls = Array.from(value, (character) => {
		const code = character.charCodeAt(0);
		return code < 32 || code === 127 ? " " : character;
	}).join("");
	const cleaned = withoutControls.replace(/\s+/g, " ").trim();
	if (!cleaned) return undefined;
	return cleaned.slice(0, TEXT_LIMIT);
}

function isCandidate(node: SnapshotRecord, action: BrowserAction): boolean {
	const role = cleanText(node.role);
	if (!role || !cleanText(node.ref) || node.disabled === true) return false;
	if (ACTION_ROLES[action].has(role)) return true;
	return action === "click" && node.cursor === "pointer";
}

function toCandidate(
	node: SnapshotRecord,
	context: string[],
	id: string,
): ActionCandidate | undefined {
	const ref = cleanText(node.ref);
	const role = cleanText(node.role);
	if (!ref || !role) return undefined;
	const placeholder = cleanText(node.placeholder);
	const name = cleanText(node.name) ?? placeholder ?? role;
	const url = cleanText(node.url);
	const cursor = cleanText(node.cursor);
	return {
		id,
		ref,
		role,
		name,
		context,
		...(url ? { url } : {}),
		...(placeholder ? { placeholder } : {}),
		...(cursor ? { cursor } : {}),
	};
}

export function collectActionCandidates(
	snapshot: unknown,
	options: { action: BrowserAction; limit?: number },
): Result<CandidateSet> {
	if (!Array.isArray(snapshot)) {
		return {
			ok: false,
			error: {
				code: "invalid-snapshot",
				message: "Playwright accessibility snapshot must be an array",
			},
		};
	}
	const limit = options.limit ?? DEFAULT_LIMIT;
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
		return {
			ok: false,
			error: { code: "invalid-candidate-limit", message: `candidate limit must be 1-${MAX_LIMIT}` },
		};
	}

	const found: ActionCandidate[] = [];
	const seenRefs = new Set<string>();
	let matchingCount = 0;

	const visit = (value: unknown, context: string[]): void => {
		if (typeof value === "string") return;
		if (!isRecord(value)) return;

		if (isCandidate(value, options.action)) {
			const ref = cleanText(value.ref);
			if (ref && !seenRefs.has(ref)) {
				seenRefs.add(ref);
				const candidate = toCandidate(value, context.slice(-2), `c${matchingCount}`);
				matchingCount += 1;
				if (candidate && found.length < limit) found.push({ ...candidate, id: `c${found.length}` });
			}
		}

		const role = cleanText(value.role);
		const name = cleanText(value.name);
		const childContext = role && name && CONTEXT_ROLES.has(role) ? [...context, name] : context;
		if (Array.isArray(value.children)) {
			for (const child of value.children) visit(child, childContext);
		}
	};

	for (const node of snapshot) visit(node, []);
	return {
		ok: true,
		value: { candidates: found, omittedCount: Math.max(0, matchingCount - found.length) },
	};
}
