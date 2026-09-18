# Jekhov

Policy-bounded [Jev](https://github.com/typesafe-ai/jev) element selection and calibration for
standard [Playwright](https://playwright.dev/).

Status: experimental shadow-only `0.1.0`. Jekhov can inspect a page and ask Jev which element best
matches one preplanned action. It cannot click, type, submit, or otherwise act.

Canonical project terminology lives in [the Jekhov glossary](docs/glossary.md).

## Why

General-purpose browser agents repeatedly send large page snapshots to a general LLM. Jekhov tests
a cheaper split:

1. A planner fixes the next operation.
2. Playwright 1.63 captures its AI accessibility tree as JSON.
3. A deterministic core filters that tree to action-compatible candidates.
4. Jev chooses one candidate or abstains and separately estimates whether the match is unambiguous.
5. Playwright could eventually perform the fixed operation behind calibrated gates and
   postconditions.

Only steps 1–4 exist today. Shadow mode records proposals without acting.

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
abstention, and `executed: false`. Each shadow step makes at most one Jev request containing one
choice question and one ambiguity-probability question.

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

The repository-owned synthetic smoke and calibration corpora at `corpora/synthetic-v1.json` and
`corpora/synthetic-v2.json` are public and ship in the npm package. Provider outputs and performance
reports remain private unless publication is separately authorized.

Compare Jev with a general-model selector wrapper implementing the same file protocol:

```sh
node dist/cli.js evaluate \
  --corpus corpora/synthetic-v2.json \
  --baseline-client dist/codex-baseline-client.js \
  --pricing config/evaluation-pricing-2026-09-18.json \
  --output reports/synthetic-v2.json
```

Evaluation replays observations without launching a browser, runs sequentially, makes at most one
request per selector per case, and always reports `executed: false`. Reports separate explicit
abstention from deterministic no-candidate cases and include candidate accuracy, proposal precision,
request size, cache-separated latency, usage, and dated list-price estimates when configured.

The report also simulates Jev-first cascades across declared confidence thresholds. Those operating
points are descriptive offline calibration, not production action thresholds or full Playwright-agent
benchmarks.

The repo-owned baseline requires a logged-in Codex CLI. It pins `gpt-5.6-luna` at low reasoning,
runs ephemerally in a read-only sandbox, ignores user and project configuration, removes API-key
environment variables, and fails if Codex invokes a tool. Its non-interactive structured-output
interface is covered in the
[official OpenAI documentation](https://developers.openai.com/docs/non-interactive-mode).

The external benchmark roadmap starts with a pinned, single-step MiniWoB++ grounding slice, then a
Mind2Web candidate-selection adapter. See [the benchmark plan](docs/benchmarks.md) for exact scope
and reporting boundaries.

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
