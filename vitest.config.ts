// pattern: Imperative Shell
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "happy-dom",
		hookTimeout: 10_000,
		passWithNoTests: true,
		pool: "vmThreads",
		testTimeout: 10_000,
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/*.test.ts",
				"src/cascade-evaluator.ts",
				"src/cli.ts",
				"src/codex-baseline-client.ts",
				"src/evaluation-run.ts",
				"src/index.ts",
				"src/jev-cli-evaluator.ts",
				"src/jev-policy-client.ts",
				"src/miniwob-run.ts",
				"src/playwright-observer.ts",
				"src/playwright-task-page.ts",
				"src/synthetic-task-run.ts",
			],
			thresholds: {
				branches: 95,
				functions: 95,
				lines: 95,
				statements: 95,
			},
		},
	},
});
