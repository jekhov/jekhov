// pattern: Imperative Shell
import { describe, expect, it } from "vitest";
import { captureMiniwobCorpus, runMiniwobBenchmark } from "./miniwob-run.js";
import type { JevEvaluator } from "./types.js";

const rootPath = process.env.JEKHOV_MINIWOB_ROOT;

function oracleEvaluator(): JevEvaluator {
	return {
		async evaluate(request) {
			const { candidates, goal, intended_action: action } = request.state;
			let name: string | undefined;
			if (action === "check") name = goal.match(/^Select the (.+) checkbox$/)?.[1];
			else if (action === "click") {
				name =
					goal === "Click the Submit button to finish the task"
						? "Submit"
						: (goal.match(/^Click on the "(.+)" button\.$/)?.[1] ?? "Click Me!");
			}
			const target = candidates.find((candidate) => {
				if (action === "fill") return candidate.role === "textbox";
				if (action === "select") return candidate.role === "combobox";
				return candidate.name === name;
			});
			return {
				ok: true,
				value: {
					provenance: { provider: "synthetic-oracle" },
					answers: {
						next_element: { choice: target?.id ?? "none" },
						unambiguous_match: { noul: target ? 1 : 0 },
					},
				},
			};
		},
	};
}

describe.runIf(rootPath)("pinned MiniWoB++ integration", () => {
	it("captures replayable labeled cases and explicit ambiguity", async () => {
		const result = await captureMiniwobCorpus({ rootPath: rootPath ?? "", seeds: [0] });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("MiniWoB corpus should capture");
		expect(result.value.cases).toHaveLength(8);
		expect(result.value.cases.filter((item) => item.label.expectedRef === null)).toHaveLength(1);
	});

	it("executes unambiguous tasks and stops before an ambiguous oracle target", async () => {
		const result = await runMiniwobBenchmark({
			rootPath: rootPath ?? "",
			seeds: [0],
			jev: oracleEvaluator(),
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("MiniWoB benchmark should run");
		expect(result.value).toMatchObject({ caseCount: 5, passed: 4, stopped: 1, failed: 0 });
		expect(result.value.cases.find((item) => item.status === "stopped")?.failure?.code).toBe(
			"oracle-target-ambiguous",
		);
	});
});
