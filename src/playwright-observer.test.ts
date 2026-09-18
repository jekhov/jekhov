// pattern: Imperative Shell
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { createPlaywrightObserver, createPlaywrightPageObserver } from "./playwright-observer.js";

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

	it("observes an existing Page without navigating or closing it", async () => {
		const browser = await chromium.launch({
			headless: true,
			...(executablePath ? { executablePath } : {}),
		});
		try {
			const page = await browser.newPage();
			const url = "data:text/html,<title>Existing</title><button>Choose me</button>";
			await page.goto(url);
			const observer = createPlaywrightPageObserver(page);

			const result = await observer.observe(url);

			expect(result.ok).toBe(true);
			expect(page.url()).toBe(url);
			expect(await page.title()).toBe("Existing");
			expect(page.isClosed()).toBe(false);
		} finally {
			await browser.close();
		}
	});
});
