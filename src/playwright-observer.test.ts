// pattern: Imperative Shell
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { createPlaywrightObserver } from "./playwright-observer.js";

const managedChromium = chromium.executablePath();
const executablePath =
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
	(existsSync(managedChromium)
		? undefined
		: existsSync("/snap/bin/chromium")
			? "/snap/bin/chromium"
			: undefined);
const browserAvailable = executablePath !== undefined || existsSync(managedChromium);

describe.runIf(browserAvailable)("createPlaywrightObserver", () => {
	it("captures Playwright's AI accessibility JSON without acting", async () => {
		const observer = createPlaywrightObserver(executablePath ? { executablePath } : {});
		const result = await observer.observe(
			"data:text/html,<title>Fixture</title><main><button>Continue</button></main>",
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("synthetic observation should succeed");
		expect(result.value.title).toBe("Fixture");
		expect(result.value.snapshot).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: "main",
					children: expect.arrayContaining([
						expect.objectContaining({ role: "button", name: "Continue", ref: expect.any(String) }),
					]),
				}),
			]),
		);
	});
});
