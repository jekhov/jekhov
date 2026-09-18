# Jekhov

Bounded [Jev](https://github.com/typesafe-ai/jev) element selection for standard
[Playwright](https://playwright.dev/), with deterministic policy checks around it.

Status: private `0.0.0` spike. It can inspect a page and ask Jev which element best matches one
preplanned action. It cannot click, type, submit, or otherwise act.

Canonical project terminology lives in [the Jekhov glossary](docs/glossary.md), which inherits the
shared cross-project definitions used by the development workspace.

## Why

General-purpose browser agents repeatedly send large page snapshots to a general LLM. This project
tests a cheaper split:

1. A general model plans the task and fixes the next operation.
2. Playwright 1.63 captures its AI accessibility tree as JSON.
3. A small deterministic core filters that tree to compatible action candidates.
4. Jev chooses one candidate or abstains and separately estimates whether the match is unambiguous.
5. Playwright would eventually perform the already-fixed operation, subject to deterministic gates
   and postconditions.

Only steps 1–4 exist today. Shadow mode records proposals without acting.

## Safety boundary

- Plans declare `public` or `synthetic` data. Private data is unsupported.
- Every HTTP(S) plan carries an exact hostname allowlist and a documented access basis.
- Redirects leave the pipeline before page-derived data reaches Jev.
- Page text is treated as untrusted evidence, not instructions.
- The Jev request omits Playwright element references and sends only bounded candidate metadata.
- Production requests go through a policy-enforcing Jev CLI wrapper; this project does not call the
  TypeSafe API directly.
- The source-policy declaration is a guardrail, not a legal opinion. Do not use this to bypass bot
  controls or automate a service that prohibits automation.

## Install and inspect

Requires Node 22 or newer.

```sh
npm install
npx playwright install chromium
npm run build
node dist/cli.js inspect --plan examples/synthetic-plan.json
```

On machines with a system Chromium:

```sh
node dist/cli.js inspect --plan examples/synthetic-plan.json --chromium /path/to/chromium
```

`inspect` makes no Jev request. It prints the bounded candidates Playwright found.

## Shadow selection

Point `--jev-client` at a compatible policy-enforcing wrapper. The Malone wrapper pins the model,
validates the request and response, enforces a request-size ceiling, records provenance, refuses
redirects, and maintains a private content-addressed cache.

```sh
node dist/cli.js shadow \
  --plan examples/synthetic-plan.json \
  --jev-client /path/to/jev-client.mjs
```

The report includes request bytes, provider usage, cache status, elapsed time, the chosen candidate
or abstention, and `executed: false`. Each shadow step makes at most one Jev request containing one
choice question and one probability question.

## Private evaluation

The repository includes a first synthetic corpus at `corpora/synthetic-v1.json`. Corpus contents and
provider results are private working material: they are excluded from the npm package and must not
be published without review.

Compare Jev with a general-model selector wrapper that implements the same file-based protocol:

```sh
node dist/cli.js evaluate \
  --corpus corpora/synthetic-v1.json \
  --baseline-client dist/codex-baseline-client.js \
  --output reports/synthetic-v1.json
```

Use `--jev-client` to override the default policy-enforcing Jev wrapper. Both wrapper paths receive
one bounded selection request at a time. Evaluation runs sequentially and makes at most one request
per selector per case. It replays observations without launching a browser and always reports
`executed: false`.

The report separates explicit provider abstention from deterministic no-candidate cases. It records
correctness, proposal precision, abstention rates, request bytes, elapsed time, numeric usage fields,
and wrapper-reported USD cost. Missing cost stays missing; Jekhov does not estimate it from token
counts. This selector comparison is not yet a full general-model Playwright-agent baseline.

The repo-owned baseline requires a logged-in Codex CLI. It pins `gpt-5.6-luna` at low reasoning
effort, runs ephemerally in a read-only sandbox, ignores user/project configuration, removes API-key
environment variables, and fails if Codex invokes a tool. It preserves Codex token usage but cannot
report a USD cost for ChatGPT-managed authentication. Codex's non-interactive structured-output
interface is documented in the [official OpenAI documentation](https://developers.openai.com/docs/non-interactive-mode).

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

## Development

```sh
npm test
npm run validate
npm run build
```

The functional core is coverage-gated at 95%. Browser and subprocess adapters have integration
tests but are excluded from that numerical gate.

## Related work

- [vlad-terin/jev-browser](https://github.com/vlad-terin/jev-browser) demonstrated plan-once,
  select, act, and verify with Jev.
- [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) demonstrated combined
  operation and target selection over Chrome CDP.

This implementation uses standard Playwright's JSON accessibility snapshot, an injected Jev
transport, explicit source policy, and shadow-only rollout. No code was copied from either project.

## License

MIT
