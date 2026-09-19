// pattern: Imperative Shell
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export class FileTooLargeError extends Error {
	constructor(
		readonly label: string,
		readonly maximumBytes: number,
	) {
		super(`${label} exceeds ${maximumBytes} bytes`);
		this.name = "FileTooLargeError";
	}
}

export async function readBoundedJson(
	path: string,
	maximumBytes: number,
	label: string,
): Promise<unknown> {
	let file: Awaited<ReturnType<typeof open>> | undefined;
	try {
		file = await open(resolve(path), constants.O_RDONLY | constants.O_NONBLOCK);
		const metadata = await file.stat();
		if (!metadata.isFile()) throw new Error(`${label} must be a regular file`);
		if (metadata.size > maximumBytes) {
			throw new FileTooLargeError(label, maximumBytes);
		}
		const content = Buffer.allocUnsafe(maximumBytes + 1);
		let length = 0;
		while (length < content.byteLength) {
			const { bytesRead } = await file.read(content, length, content.byteLength - length, null);
			if (bytesRead === 0) break;
			length += bytesRead;
		}
		if (length > maximumBytes) {
			throw new FileTooLargeError(label, maximumBytes);
		}
		return JSON.parse(content.toString("utf8", 0, length));
	} finally {
		await file?.close().catch(() => undefined);
	}
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
	const absolute = resolve(path);
	const directory = dirname(absolute);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	try {
		const existing = await lstat(absolute);
		if (!existing.isFile() && !existing.isSymbolicLink()) {
			throw new Error("output path must be a regular file or symbolic link");
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const temporaryPath = join(directory, `.${basename(absolute)}.${randomUUID()}.tmp`);
	try {
		await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
			flag: "wx",
			mode: 0o600,
		});
		await rename(temporaryPath, absolute);
	} catch (error) {
		await rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
}
