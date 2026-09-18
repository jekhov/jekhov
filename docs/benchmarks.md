# Benchmark Plan

Jekhov needs benchmarks that separate three questions:

1. Did deterministic filtering retain the correct element?
2. Given the retained candidates, did the selector propose the correct element or abstain?
3. For a future action runner, did the fixed action satisfy the task validator?

Candidate recall, conditional selection accuracy, abstention, request size, latency, and cost should
therefore be reported separately. A Jekhov selector result is not a full browser-agent success rate.

## First external benchmark: MiniWoB++

[MiniWoB++](https://github.com/Farama-Foundation/miniwob-plusplus) is the best near-term fit. It is
an MIT-licensed suite of more than 100 locally hosted synthetic browser tasks with task utterances,
DOM-backed targets, actions, and reward checks. [BrowserGym](https://github.com/ServiceNow/BrowserGym)
provides a Playwright-based integration for its 125 task templates.

The proposed Jekhov slice is intentionally narrower than the full agent benchmark:

- Pin the upstream source revision and a declared seed list.
- Start with single-step `click`, `fill`, `select`, and `check` cases whose operation is already
  fixed.
- Render each task locally, collect Playwright's AI accessibility snapshot, and preserve the task's
  oracle target outside the selector request.
- Measure candidate recall first, then target accuracy and abstention conditional on recall.
- Use the environment validator only as a separate future execution metric.

This keeps source policy synthetic and deterministic while exercising Jekhov's actual Playwright
representation. Results must be labeled **MiniWoB++ single-step grounding slice**, not BrowserGym or
MiniWoB++ end-to-end agent success.

## Second external benchmark: Mind2Web

[Mind2Web](https://github.com/OSU-NLP-Group/Mind2Web) contains more than 2,000 tasks spanning 137
websites and 31 domains. Its action-prediction setup supplies positive and negative element
candidates, which makes it useful for larger-scale semantic grounding and abstention work.

It is not the first release gate. Mind2Web stores real-world DOM snapshots rather than
Playwright `ariaSnapshotJSON({ mode: "ai" })` observations, so an adapter would test selection over
its candidate representation, not Jekhov's complete extraction path. Any public result must name
that representation mismatch and follow the dataset's CC BY 4.0 terms.

## Release benchmark boundary

The checked-in synthetic corpora are public calibration fixtures. Provider outputs and performance
reports remain unpublished until separately authorized. Neither the internal fixtures nor the
proposed MiniWoB++ slice establishes a production action threshold; Jekhov remains shadow-only.
