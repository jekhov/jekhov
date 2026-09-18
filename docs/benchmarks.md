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

The implemented Jekhov slice is intentionally narrower than the full agent benchmark:

- Pin the upstream source revision and a declared seed list.
- Cover five templates whose `click`, `fill`, `select`, and `check` operations are already fixed.
- Render each task locally, collect Playwright's AI accessibility snapshot, and preserve the task's
  oracle target outside the selector request.
- Measure candidate recall first, then target accuracy and abstention conditional on recall.
- Execute complete seeded tasks behind the withheld-label gate and use the native environment reward
  as a separate execution metric.

This keeps source policy synthetic and deterministic while exercising Jekhov's actual Playwright
representation. Results must be labeled **MiniWoB++ single-step grounding slice**, not BrowserGym or
MiniWoB++ end-to-end agent success.

The adapter pins revision `7fd85d71a4b60325c6585396ec4f48377d049838`, matching BrowserGym's
MiniWoB setup. `corpora/miniwob-v1.json` contains 91 deterministic cases captured from seeds 0-9:
49 labeled clicks, 21 checks, 10 fills, 10 selects, and one click expected to abstain because the
accessible target identity is duplicated. Its SHA-256 is
`2e1a2c9d3af4162b89d93ea40d0f0f5a6f932000eb49dad15141864052932e81` after repository
formatting.

Fifty-three of the 91 cases have a single eligible candidate, including every fill and select case.
Results should therefore include candidate-count strata rather than present the aggregate as 91
equally difficult grounding decisions.

The execution report is a different artifact. It groups the real selection and action steps by
seeded task, retains stops and wrapper failures, and records MiniWoB++ terminal reward. A successful
task proves bounded plan/select/act/verify execution for this slice; it does not establish general
browser-agent performance. The adapter raises `EPISODE_MAX_TIME` to 1,000,000 seconds so sequential
provider calls do not expire the episode; native correctness rewards remain active, but the run is
not a native timing benchmark.

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
MiniWoB++ slice establishes a production action threshold; Jekhov's general runner remains
shadow-only.

The checked-in complete-task fixture is an execution smoke test, not calibration evidence. Its
oracle gate verifies the exact labeled target before each action, so successful execution must not
be reported as autonomous selector precision.
