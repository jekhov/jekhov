// pattern: Imperative Shell
import { chmod } from "node:fs/promises";

await Promise.all(
	["cli.js", "codex-baseline-client.js", "jev-policy-client.js"].map((file) =>
		chmod(new URL(`../dist/${file}`, import.meta.url), 0o755),
	),
);
