// pattern: Imperative Shell
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEvaluationCorpus } from "./evaluation-corpus.js";

const EXPECTED_SHA256 = "2e1a2c9d3af4162b89d93ea40d0f0f5a6f932000eb49dad15141864052932e81";

describe("checked-in MiniWoB corpus", () => {
	it("enforces the documented schema, case count, and formatted-file hash", async () => {
		const text = await readFile(resolve("corpora/miniwob-v1.json"), "utf8");
		const parsed = parseEvaluationCorpus(JSON.parse(text));

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) throw new Error(parsed.error.message);
		expect(parsed.value.cases).toHaveLength(91);
		expect(createHash("sha256").update(text).digest("hex")).toBe(EXPECTED_SHA256);
	});
});
