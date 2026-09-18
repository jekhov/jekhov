// pattern: Imperative Shell
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createJevCliEvaluator } from "./jev-cli-evaluator.js";
import { buildSelectionRequest } from "./selection.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function fakeClient(source: string): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "jev-playwright-test-"));
	temporaryDirectories.push(directory);
	const path = join(directory, "fake-client.mjs");
	await writeFile(path, source, { mode: 0o700 });
	await chmod(path, 0o700);
	return path;
}

const request = buildSelectionRequest({
	goal: "Continue",
	action: "click",
	pageUrl: "data:text/html,test",
	pageTitle: "Test",
	candidates: [{ id: "c0", ref: "e2", role: "button", name: "Continue", context: [] }],
});

describe("createJevCliEvaluator", () => {
	it("routes the request through the configured wrapper and reads its output", async () => {
		const clientPath = await fakeClient(`
import { readFileSync, writeFileSync } from "node:fs";
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith("--")) pairs.push([value, all[index + 1]]);
  return pairs;
}, []));
const request = JSON.parse(readFileSync(args["--input"], "utf8"));
if (args["--data-class"] !== "synthetic" || !request.questions.next_element) process.exit(4);
writeFileSync(args["--output"], JSON.stringify({
  provenance: { provider: "typesafe", cache_hit: false },
  usage: { input_tokens: 20 },
  answers: { next_element: { choice: "c0" }, unambiguous_match: { noul: 0.91 } }
}));
`);
		const evaluator = createJevCliEvaluator({ clientPath });

		const result = await evaluator.evaluate(request, "synthetic");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("fake Jev call should succeed");
		expect(result.value).toMatchObject({
			provenance: { provider: "typesafe" },
			answers: { next_element: { choice: "c0" } },
		});
	});

	it("returns wrapper failures explicitly", async () => {
		const clientPath = await fakeClient(
			`process.stderr.write("policy denied\\n"); process.exit(3);`,
		);
		const evaluator = createJevCliEvaluator({ clientPath });

		await expect(evaluator.evaluate(request, "public")).resolves.toEqual({
			ok: false,
			error: { code: "jev-client-failed", message: "policy denied" },
		});
	});

	it("rejects invalid wrapper JSON", async () => {
		const clientPath = await fakeClient(`
import { writeFileSync } from "node:fs";
const outputIndex = process.argv.indexOf("--output") + 1;
writeFileSync(process.argv[outputIndex], "not-json");
`);
		const evaluator = createJevCliEvaluator({ clientPath });
		const result = await evaluator.evaluate(request, "synthetic");
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("invalid output unexpectedly parsed");
		expect(result.error.code).toBe("invalid-jev-output");
	});
});
