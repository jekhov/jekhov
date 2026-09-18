// pattern: Imperative Shell
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "happy-dom",
		hookTimeout: 10_000,
		passWithNoTests: true,
		testTimeout: 10_000,
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/*.test.ts",
				"src/cli.ts",
				"src/index.ts",
				"src/jev-cli-evaluator.ts",
				"src/playwright-observer.ts",
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
