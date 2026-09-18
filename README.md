# Jekhov

Policy-bounded [Jev](https://github.com/typesafe-ai/jev) element selection and calibration for
standard [Playwright](https://playwright.dev/).

Status: experimental `0.1.0`. The public-site runner remains shadow-only. A separately labeled,
synthetic-only task harness can execute complete multi-step fixtures and a pinned MiniWoB++ slice
behind an exact oracle gate.

Canonical project terminology lives in [the Jekhov glossary](docs/glossary.md).

## Why

General-purpose browser agents repeatedly send large page snapshots to a general LLM. Jekhov tests
a cheaper split:

1. A planner fixes the next operation.
2. Playwright 1.63 captures its AI accessibility tree as JSON.
3. A deterministic core filters that tree to action-compatible candidates.
4. Jev chooses one candidate or abstains and separately estimates whether the match is unambiguous.
5. Playwright eventually performs the fixed operation behind calibrated gates and postconditions.

Steps 1–4 exist for public and synthetic shadow runs. The synthetic task harness exercises step 5
only when the proposal exactly matches the fixture's hidden label; general action mode remains
disabled.

## Quick start

Requires Node 22 or newer and a [Jev](https://typesafe.ai/) API key.

```sh
npm install jekhov
npx playwright install chromium
export TYPESAFE_API_KEY=your_key_here
npx jekhov demo
```

`demo` uses a bundled synthetic page, proposes one target through the bundled policy wrapper, and
prints a report with `executed: false`. It does not perform the proposed action. On a machine with a
system Chromium, add `--chromium /path/to/chromium`.

To inspect the repository fixture without making a Jev request:

```sh
git clone https://github.com/proptermalone/jekhov.git
cd jekhov
npm install
npm run build
node dist/cli.js inspect --plan examples/synthetic-plan.json
```

## Safety boundary

- Plans declare `public` or `synthetic` data. Private data is unsupported.
- Every HTTP(S) plan carries an exact hostname allowlist and a documented access basis.
- Plans are runtime-validated before browser observation, including through the exported API.
- The observed final URL is validated before page-derived data reaches Jev.
- Page text is treated as untrusted evidence, not instructions.
- Jev receives bounded candidate metadata without Playwright element references or URL query
  values.
- Production requests go through a bundled policy-enforcing subprocess using TypeSafe's official
  SDK. Jekhov contains no direct provider HTTP implementation.
- Executable synthetic tasks require one uniquely matching oracle label, a fresh matching
  accessibility reference, deterministic postconditions, and explicit step/request/time budgets.
- Fresh-browser data fixtures run in an offline Playwright context with service workers blocked.
  MiniWoB++ execution is confined to the exact URL served from its verified pinned worktree.
- The source-policy declaration is a guardrail, not a legal opinion. Do not bypass bot controls or
  automate a service that prohibits automation.

Requested-URL and final-URL checks form a data-release gate, not network confinement. A browser may
receive a redirect response before Jekhov rejects the destination and withholds page data from Jev.

## Shadow selection

The default wrapper pins the Jev model, accepts only declared public or synthetic data, validates
requests and responses, caps request size, refuses provider redirects, records provenance, and
maintains a private content-addressed cache. It reads `TYPESAFE_API_KEY` from the environment.

```sh
node dist/cli.js shadow --plan examples/synthetic-plan.json
```

`--jev-client /path/to/compatible-wrapper.mjs` remains available for an audited replacement. A
report includes request bytes, provider usage, cache status, elapsed time, the chosen candidate or
abstention, Choice confidence and probabilities, and `executed: false`. Each shadow step makes at
most one Jev request containing one choice question and one ambiguity-probability question.

## Existing Playwright pages

Library users can inspect a caller-owned Playwright `Page` without opening another browser:

```js
import {
  createBundledJevEvaluator,
  createPlaywrightPageObserver,
  runShadowSelection,
} from "jekhov";

const report = await runShadowSelection(plan, {
  browser: createPlaywrightPageObserver(page),
  jev: createBundledJevEvaluator(),
});
```

The page adapter reads the current page; it does not navigate or close it. The runner validates the
plan before observation and validates `page.url()` before releasing page-derived candidates.

## Complete synthetic tasks

The repository includes a four-action task covering `fill`, `select`, `check`, and `click`:

```sh
export TYPESAFE_API_KEY=your_key_here
node dist/cli.js task --plan examples/synthetic-task.json
```

Every step has a labeled role/name target stored outside Jev's request. Jekhov stops without
spending a request when that identity is absent or ambiguous, and stops without acting if the
selector abstains, chooses a different target, truncates candidates, or if a fresh snapshot cannot
reproduce the selected reference and identity. After acting, it validates the URL and every declared
DOM postcondition before continuing.

Reports mark `executed` as soon as Playwright is asked to dispatch an action, because an adapter
error may occur after a mutation. `actionConfirmed` and `confirmedStepCount` separately record
actions for which the adapter returned success. Jekhov stops rather than retrying an uncertain
action.

This command intentionally rejects public pages. It proves the complete plan/select/act/verify loop
and supplies an execution benchmark, but it is not the calibrated public-site action mode.

## MiniWoB++ benchmark

Jekhov includes a five-template adapter for the pinned MiniWoB++ revision used by BrowserGym. It
covers `choose-list`, `click-button`, `click-checkboxes`, `click-test`, and `enter-text` using the
real task utterances and native reward checks.

```sh
git clone https://github.com/Farama-Foundation/miniwob-plusplus.git .benchmarks/miniwob-plusplus
git -C .benchmarks/miniwob-plusplus checkout 7fd85d71a4b60325c6585396ec4f48377d049838

# Deterministically rebuild the public 91-case, seeds 0-9 grounding corpus. No Jev call.
node dist/cli.js miniwob capture \
  --root .benchmarks/miniwob-plusplus \
  --seeds 0-9 \
  --output corpora/miniwob-v1.json
npx biome format --write corpora/miniwob-v1.json

# Execute complete seeded tasks through Jev behind the oracle gate.
node dist/cli.js miniwob run \
  --root .benchmarks/miniwob-plusplus \
  --seeds 0-9 \
  --output reports/miniwob.json
```

`--tasks` accepts a comma-separated subset and `--seeds` accepts comma-separated integers or
inclusive ranges. Corpus capture advances the synthetic page with the withheld oracle so every step
can be recorded. A duplicated target identity is labeled as an expected abstention. Execution stops
before a Jev request when the same identity is ambiguous.

This is a bounded, preplanned MiniWoB++ slice, not the full 125-template BrowserGym benchmark and
not autonomous planning. The checked-in corpus is public; provider run reports remain private.

## Plan format

```json
{
  "version": 1,
  "mode": "shadow",
  "goal": "Navigate a public product catalogue",
  "startUrl": "https://catalogue.example/search",
  "dataClass": "public",
  "sourcePolicy": {
    "allowedHosts": ["catalogue.example"],
    "basis": "terms-reviewed",
    "reviewedAt": "2026-09-17",
    "note": "Public catalogue pages permit this bounded read-only evaluation."
  },
  "step": {
    "id": "next-page",
    "action": "click",
    "goal": "Open the next page of product results"
  }
}
```

Supported actions are `click`, `fill`, `select`, and `check`. They filter candidates; shadow mode
does not execute them.

## Evaluation

The repository-owned smoke and calibration corpora at `corpora/synthetic-v1.json`,
`corpora/synthetic-v2.json`, and `corpora/miniwob-v1.json` are public and ship in the npm package.
Provider outputs and performance reports remain private unless publication is separately authorized.

Compare Jev with a general-model selector wrapper implementing the same file protocol:

```sh
node dist/cli.js evaluate \
  --corpus corpora/synthetic-v2.json \
  --baseline-client dist/codex-baseline-client.js \
  --pricing config/evaluation-pricing-2026-09-18.json \
  --output reports/synthetic-v2.json
```

Every evaluation compares the full Jev request with a `jev-choice-only` profile that removes the
ambiguity question and duplicate candidate state. Omit `--baseline-client` to compare only those
two Jev profiles. Supplying it also enables the paired offline cascade sweep using the full Jev
profile as primary.

Evaluation replays observations without launching a browser, runs sequentially, makes at most one
request per selector per case, and always reports `executed: false`. Reports separate explicit
abstention from deterministic no-candidate cases and include candidate accuracy, proposal precision,
request size, cache-separated latency, usage, and dated list-price estimates when configured.
Per-case results retain Jev's Choice confidence, full probability distribution, and the signal used
as match probability so the two profiles can be calibrated rather than reduced to hard choices.

The report also simulates Jev-first cascades across declared confidence thresholds. Those operating
points are descriptive offline calibration, not production action thresholds or full Playwright-agent
benchmarks.

Library users can apply separately calibrated, action-specific thresholds to a live selector
cascade:

```js
import {
  createBundledJevEvaluator,
  createSelectionCliEvaluator,
  createThresholdCascadeEvaluator,
} from "jekhov";

const selector = createThresholdCascadeEvaluator({
  primary: createBundledJevEvaluator(),
  fallback: createSelectionCliEvaluator({
    clientPath: "/path/to/general-model-selector.mjs",
    failureCode: "fallback-client-failed",
  }),
  thresholds: calibratedThresholdsByAction,
});
```

Primary errors, abstentions, invalid responses, and proposals below the current action's threshold
route to the fallback. The combined response records both legs and sums numeric usage. This changes
which selector supplies the proposal; it does not bypass an execution oracle or turn a selector
threshold into an action-safety threshold. Executable tasks reserve the cascade's two-request bound
before each decision and report both legs when fallback runs.

The repo-owned baseline requires a logged-in Codex CLI. It pins `gpt-5.6-luna` at low reasoning,
runs ephemerally in a read-only sandbox, ignores user and project configuration, removes API-key
environment variables, and fails if Codex invokes a tool. Its non-interactive structured-output
interface is covered in the
[official OpenAI documentation](https://developers.openai.com/docs/non-interactive-mode).

The external benchmark path starts with the implemented pinned MiniWoB++ grounding and execution
slice; a Mind2Web candidate-selection adapter remains later work. See
[the benchmark plan](docs/benchmarks.md) for exact scope and reporting boundaries.

## Development

```sh
npm test
npm run validate
npm run build
npm run package:check
```

The functional core is coverage-gated at 95%. Browser and subprocess adapters have integration
tests but are excluded from that numerical gate.

## Related work

- [vlad-terin/jev-browser](https://github.com/vlad-terin/jev-browser) implements a bounded
  plan/select/act/verify loop with Jev.
- [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) implements goal-driven
  operation and target selection over Chrome CDP.

Those projects currently offer broader task execution. Jekhov's narrower niche is source policy,
data minimization, selector calibration, and fallback analysis on standard Playwright. No code was
copied from either project.

## License

MIT
