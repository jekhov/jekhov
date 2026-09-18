// pattern: Imperative Shell
import type { Frame, Page } from "playwright";
import type { PageObservation, Result } from "./types.js";

const DEFAULT_OBSERVATION_TIMEOUT_MS = 20_000;

class ObservationTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new ObservationTimeout(`browser observation exceeded ${timeoutMs} milliseconds`));
		}, timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

export async function observePlaywrightPage(
	page: Page,
	timeoutMs = DEFAULT_OBSERVATION_TIMEOUT_MS,
): Promise<Result<PageObservation>> {
	let mainFrameNavigated = false;
	const mainFrame = page.mainFrame();
	const observedFrameUrls = new Set(page.frames().map((frame) => frame.url()));
	const onFrameNavigated = (frame: Frame) => {
		observedFrameUrls.add(frame.url());
		if (frame === mainFrame) mainFrameNavigated = true;
	};
	page.on("framenavigated", onFrameNavigated);
	try {
		const observed = await withTimeout(
			(async () => {
				const beforeUrl = page.url();
				const title = await page.title();
				const snapshot = await page.ariaSnapshotJSON({ mode: "ai" });
				const afterUrl = page.url();
				for (const frame of page.frames()) observedFrameUrls.add(frame.url());
				if (mainFrameNavigated || beforeUrl !== afterUrl) {
					throw new Error("page navigated while its accessibility observation was being captured");
				}
				return { url: afterUrl, title, snapshot, frameUrls: [...observedFrameUrls] };
			})(),
			timeoutMs,
		);
		return { ok: true, value: observed };
	} catch (error) {
		return {
			ok: false,
			error: {
				code:
					error instanceof ObservationTimeout
						? "browser-observation-timeout"
						: "browser-observation-failed",
				message: error instanceof Error ? error.message : "Playwright observation failed",
			},
		};
	} finally {
		page.off("framenavigated", onFrameNavigated);
	}
}
