// pattern: Imperative Shell
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileTooLargeError, readBoundedJson, writePrivateJson } from "./private-json-file.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("writePrivateJson", () => {
	it("atomically replaces a symlink instead of overwriting its target", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jekhov-private-json-"));
		temporaryDirectories.push(directory);
		const victimPath = join(directory, "victim.txt");
		const outputPath = join(directory, "nested", "report.json");
		await writeFile(victimPath, "keep me\n", { mode: 0o644 });
		await mkdir(join(directory, "nested"));
		await symlink(victimPath, outputPath);

		await writePrivateJson(outputPath, { safe: true });

		expect(await readFile(victimPath, "utf8")).toBe("keep me\n");
		expect((await lstat(outputPath)).isSymbolicLink()).toBe(false);
		expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual({ safe: true });
		expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
	});
});

describe("readBoundedJson", () => {
	it("rejects a file whose on-disk size exceeds the declared boundary", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jekhov-bounded-json-"));
		temporaryDirectories.push(directory);
		const inputPath = join(directory, "input.json");
		await writeFile(inputPath, JSON.stringify({ value: "too large" }));

		await expect(readBoundedJson(inputPath, 4, "fixture")).rejects.toEqual(
			new FileTooLargeError("fixture", 4),
		);
	});
});
