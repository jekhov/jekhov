// pattern: Imperative Shell
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Frame, Page } from "playwright";
import { chromium } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { createPlaywrightObserver, createPlaywrightPageObserver } from "./playwright-observer.js";
import { runShadowSelection } from "./shadow-run.js";
import type { JevEvaluator, ShadowPlan } from "./types.js";

const managedChromium = chromium.executablePath();
const executablePath =
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
	(existsSync(managedChromium)
		? undefined
		: existsSync("/snap/bin/chromium")
			? "/snap/bin/chromium"
			: undefined);
const browserAvailable = executablePath !== undefined || existsSync(managedChromium);

describe("createPlaywrightPageObserver bounds", () => {
	it("fails a stalled observation within its declared timeout", async () => {
		const mainFrame = { url: () => "https://shop.example/" } as Frame;
		const handlers = new Set<(frame: Frame) => void>();
		const page = {
			on: (_event: string, handler: (frame: Frame) => void) => handlers.add(handler),
			off: (_event: string, handler: (frame: Frame) => void) => handlers.delete(handler),
			mainFrame: () => mainFrame,
			url: () => "https://shop.example/",
			frames: () => [mainFrame],
			title: () => new Promise<string>(() => undefined),
			ariaSnapshotJSON: () => Promise.resolve([]),
		} as unknown as Page;
		const observer = createPlaywrightPageObserver(page, { observationTimeoutMs: 20 });

		await expect(observer.observe("https://shop.example/")).resolves.toEqual({
			ok: false,
			error: {
				code: "browser-observation-timeout",
				message: "browser observation exceeded 20 milliseconds",
			},
		});
	});

	it("rejects a page navigation that occurs during observation", async () => {
		let currentUrl = "https://shop.example/allowed";
		const handlers = new Set<(frame: Frame) => void>();
		const mainFrame = { url: () => currentUrl } as Frame;
		const page = {
			on: (_event: string, handler: (frame: Frame) => void) => handlers.add(handler),
			off: (_event: string, handler: (frame: Frame) => void) => handlers.delete(handler),
			mainFrame: () => mainFrame,
			url: () => currentUrl,
			frames: () => [mainFrame],
			title: async () => {
				currentUrl = "https://unreviewed.example/private";
				for (const handler of handlers) handler(mainFrame);
				return "Private";
			},
			ariaSnapshotJSON: async () => [{ role: "button", name: "Private", ref: "e1" }],
		} as unknown as Page;

		await expect(
			createPlaywrightPageObserver(page).observe("https://shop.example/allowed"),
		).resolves.toMatchObject({
			ok: false,
			error: {
				code: "browser-observation-failed",
				message: "page navigated while its accessibility observation was being captured",
			},
		});
	});
});

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

	it("withholds a cross-host iframe snapshot from the selector", async () => {
		let port = 0;
		const server = createServer((request, response) => {
			response.setHeader("content-type", "text/html");
			if (request.url === "/frame") {
				response.end("<button>Cross-host secret</button>");
				return;
			}
			response.end(`<title>Allowed</title><iframe src="http://127.0.0.2:${port}/frame"></iframe>`);
		});
		await new Promise<void>((resolveListen, reject) => {
			server.once("error", reject);
			server.listen(0, "0.0.0.0", resolveListen);
		});
		try {
			port = (server.address() as AddressInfo).port;
			const startUrl = `http://127.0.0.1:${port}/`;
			const plan: ShadowPlan = {
				version: 1,
				mode: "shadow",
				goal: "Inspect an allowed fixture",
				startUrl,
				dataClass: "public",
				sourcePolicy: {
					allowedHosts: ["127.0.0.1"],
					basis: "first-party",
					providerDisclosure: "allowed",
					reviewedAt: "2026-09-18",
					note: "Local first-party browser boundary fixture.",
				},
				step: { id: "inspect", action: "click", goal: "Choose the allowed control" },
			};
			const jev: JevEvaluator = { evaluate: vi.fn() };
			const result = await runShadowSelection(plan, {
				browser: createPlaywrightObserver(executablePath ? { executablePath } : {}),
				jev,
			});

			expect(result).toEqual({
				ok: false,
				error: {
					code: "frame-host-not-allowed",
					message: "observed frame host 127.0.0.2 is not in sourcePolicy.allowedHosts",
				},
			});
			expect(jev.evaluate).not.toHaveBeenCalled();
		} finally {
			await new Promise<void>((resolveClose, reject) => {
				server.close((error) => (error ? reject(error) : resolveClose()));
			});
		}
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
