// pattern: Imperative Shell
import { execFile } from "node:child_process";
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { FileTooLargeError, readBoundedJson, writePrivateJson } from "./private-json-file.js";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

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

	it("keeps a complete file visible while publishing its replacement", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jekhov-private-json-atomic-"));
		temporaryDirectories.push(directory);
		const outputPath = join(directory, "report.json");
		await writePrivateJson(outputPath, { version: "old", payload: "old" });

		let writing = true;
		const invalidReads: string[] = [];
		const reader = (async () => {
			while (writing) {
				try {
					const observed = JSON.parse(await readFile(outputPath, "utf8")) as { version?: string };
					if (observed.version !== "old" && observed.version !== "new") {
						invalidReads.push("unexpected value");
					}
				} catch (error) {
					invalidReads.push(error instanceof Error ? error.message : "invalid read");
				}
			}
		})();
		await writePrivateJson(outputPath, { version: "new", payload: "x".repeat(4 * 1024 * 1024) });
		writing = false;
		await reader;

		expect(invalidReads).toEqual([]);
		expect(JSON.parse(await readFile(outputPath, "utf8"))).toMatchObject({ version: "new" });
	});

	it("rejects non-regular output targets without creating a temporary file", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jekhov-private-json-target-"));
		temporaryDirectories.push(directory);
		const outputPath = join(directory, "report.json");
		await mkdir(outputPath);

		await expect(writePrivateJson(outputPath, { safe: true })).rejects.toThrow(
			"output path must be a regular file or symbolic link",
		);
		expect(await readdir(directory)).toEqual(["report.json"]);
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

	it("accepts the exact byte boundary and rejects the next byte", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jekhov-bounded-json-edge-"));
		temporaryDirectories.push(directory);
		const inputPath = join(directory, "input.json");
		const encoded = JSON.stringify({ a: 1 });
		await writeFile(inputPath, encoded);

		await expect(
			readBoundedJson(inputPath, Buffer.byteLength(encoded), "fixture"),
		).resolves.toEqual({
			a: 1,
		});
		await expect(
			readBoundedJson(inputPath, Buffer.byteLength(encoded) - 1, "fixture"),
		).rejects.toEqual(new FileTooLargeError("fixture", Buffer.byteLength(encoded) - 1));
	});

	it.runIf(process.platform !== "win32")(
		"rejects FIFOs without blocking or replacing them",
		async () => {
			const directory = await mkdtemp(join(tmpdir(), "jekhov-bounded-json-fifo-"));
			temporaryDirectories.push(directory);
			const fifoPath = join(directory, "input.json");
			await execFileAsync("mkfifo", [fifoPath]);

			await expect(readBoundedJson(fifoPath, 1024, "fixture")).rejects.toThrow(
				"fixture must be a regular file",
			);
			await expect(writePrivateJson(fifoPath, { safe: true })).rejects.toThrow(
				"output path must be a regular file or symbolic link",
			);
			expect((await lstat(fifoPath)).isFIFO()).toBe(true);
		},
	);

	it.runIf(process.platform === "linux")(
		"bounds a regular pseudo-file whose reported size is zero",
		async () => {
			await expect(readBoundedJson("/proc/self/cmdline", 1, "fixture")).rejects.toEqual(
				new FileTooLargeError("fixture", 1),
			);
		},
	);

	it("removes the temporary path when publication fails", async () => {
		const directory = await mkdtemp(join(tmpdir(), "jekhov-private-json-cleanup-"));
		temporaryDirectories.push(directory);
		const outputPath = join(directory, "x".repeat(250));

		await expect(writePrivateJson(outputPath, { safe: true })).rejects.toMatchObject({
			code: "ENAMETOOLONG",
		});
		expect(await readdir(directory)).toEqual([]);
	});
});
