import { rm } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const distPath = fileURLToPath(new URL("../dist", import.meta.url));
if (basename(distPath) !== "dist") throw new Error("refusing to clean an unexpected build path");
await rm(distPath, { recursive: true, force: true });
