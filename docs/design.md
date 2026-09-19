# Working design

This working design is subordinate to
[ADR 01](decisions/01-release-execution-boundary.md), which governs the release execution boundary.

## Current slice

```text
preplanned goal + operation
          |
          v
source-policy gate -> Playwright ariaSnapshotJSON(mode: "ai")
                              |
                              v
                    deterministic role filter
                              |
                              v
                compact candidates -> pinned Jev wrapper
                              |
                              v
                  proposal + ambiguity probability
                              |
                              v
                       local report only
```

One general-model planning call can cover several future steps. Each step should then cost one
bounded Jev call rather than another full-model page interpretation. The public runner implements
one shadow step. The separate synthetic harness implements a bounded multi-step loop behind withheld
labels so selection and execution failures remain distinguishable.

The separate artifact-validation path parses one plan, evaluation corpus, or pricing file and emits
a content-minimized summary. It opens no browser, makes no provider request, and never executes an
action. This preflight is deliberately distinct from inspect mode and shadow mode.

## Deliberate constraints

1. The plan fixes the operation. Jev selects only the element in v0.
2. `inspect` costs nothing beyond browser work. `shadow` makes at most one Jev request.
3. Candidate text is untrusted data. It never changes instructions or policy.
4. Exact-host policy runs before navigation and again after redirects.
5. No private, client, minor, legal, or unknown-class data enters Jev.
6. No general action mode exists. Confidence thresholds remain unset until calibration produces a
   measured operating point. The synthetic task harness may act only when exactly one candidate
   matches the fixture's withheld label and the selector proposes it.
7. The browser adapter uses Playwright's public `ariaSnapshotJSON()` API. Element references remain
   local and never enter the Jev request.
8. JSON inputs must be regular files and are size-bounded before parsing. Durable JSON outputs use
   atomic replacement and private file permissions; device, FIFO, socket, and directory targets are
   rejected.
9. Accessibility snapshot traversal has a fixed entry budget and terminates safely for cyclic
   library input.

## Synthetic complete-task slice

The executable test slice accepts only `data:` pages with synthetic source policy. It runs a bounded
sequence of preplanned steps. Before each action it requires all of the following:

1. the candidate set is complete under the configured cap;
2. exactly one candidate matches the step's withheld role/name label and the selector proposes it;
3. a new accessibility snapshot reproduces the proposal's reference, role, and name; and
4. the browser is still within source policy.

The action uses Playwright's `aria-ref` locator. Each step then validates the resulting URL and all
declared value, checked, visibility, or text postconditions. Any failed gate stops the task. This
exercises the plan/select/act/verify machinery without turning an uncalibrated probability into an
action threshold.

Repository data fixtures run in a browser context set offline before the page is created, with
service workers blocked and an empty host allowlist. The MiniWoB++ path separately requires the
exact served URL and a clean worktree at the pinned revision. The public package does not export the
lower-level injected-page execution runner.

The MiniWoB++ adapter applies the same loop to five pinned local task templates. Corpus capture uses
the withheld oracle to advance the environment and records each accessibility snapshot for replay.
Execution uses Jev, rechecks the target, acts through Playwright, and accepts task success only from
MiniWoB++'s native reward. Neither path supplies open-ended planning.

## Measurement before action mode

Build a labeled set of real, permitted pages plus synthetic adversarial pages. For each step,
record the candidate set, expected candidate or abstention, selected candidate, ambiguity
probability, request bytes, usage, cache status, and elapsed time. Compare accuracy and total token
cost with a general-model Playwright baseline on the same tasks.

The repository-owned synthetic corpora and the checked-in MiniWoB++ synthetic grounding corpus are
approved for public distribution. Keep real-page corpora, provider outputs, and performance reports
private unless their publication is separately authorized and the applicable agreements permit it.

Do not infer a confidence threshold from a handful of examples. Action mode needs:

- a declared precision target for the specific action class;
- a separately measured abstention rate;
- deterministic postconditions;
- a maximum step and request budget;
- immediate stop on navigation outside the host allowlist; and
- review before this becomes a default browser path.

## Evaluation slice

The first evaluation harness replays stored observations through the existing shadow pipeline. Each
case contains a validated plan, a page observation, tags, and a label holding the expected local
element reference or explicit abstention. The label stays outside selection requests. Candidate IDs
are regenerated by the same deterministic filter used in live shadow mode.

Selectors run sequentially in corpus order. The provider-request budget is fixed before the run:
`case count × sum of selector request bounds`. Cases with no eligible candidates spend no selector
request. Wrapper failures remain case-level errors so one outage does not silently remove the rest
of a comparison.

The default evaluation runs two Jev profiles over every case. `jev` uses the full request with a
Choice plus ambiguity Noul. `jev-choice-only` removes that Noul while retaining the candidate array
in state so the policy wrapper can verify the criteria exactly. Both preserve Choice confidence and
the complete probability distribution. This is an
offline A/B comparison; live shadow and action paths continue to use the conservative full profile.

Version 2 reports include per-case outcomes and aggregate accuracy, proposal precision, provider
abstention, pipeline abstention, request bytes, cache-separated latency, numeric usage fields, and
wrapper-reported USD cost, Choice confidence and probability distributions, and the source of each
match probability. Each report hashes the normalized corpus, including its labels. An
optional dated pricing file can translate usage into an API list-price estimate; this remains
separate from provider-reported cost and records whether every request was priceable.

The report also simulates a Jev-first cascade over a deterministic 0.05 threshold grid. Primary
errors, explicit abstentions, and proposals below the tested match-probability threshold use the
recorded general-model result. Each operating point reports final correctness, proposal precision,
fallback rate, resource totals, estimated list-price cost, and per-action results. This is offline
analysis only: it neither chooses a production threshold nor adds an action path.

An injected live selector cascade can apply an externally chosen threshold for each action. It
routes primary errors, abstentions, invalid responses, and low-probability proposals to a compatible
fallback wrapper while preserving both legs' provenance and combined numeric usage. The cascade
still returns only a proposal; execution remains subject to the task harness's independent gates.
Its declared two-request bound is reserved against the task budget before either selector runs.

The repo-owned general-model baseline sees the same bounded selection request as Jev. It runs
`gpt-5.6-luna` at low reasoning effort through ephemeral, read-only `codex exec`, ignores user and
project rules, strips API-key environment variables, and rejects any tool-use event. Structured
output constrains its answer to the candidate IDs plus abstention. This isolates selector quality,
usage, and latency; it is not the full general-model Playwright baseline over raw observations. That
broader comparison remains required before claiming an end-to-end cost advantage.

## Data acquisition

Use Jev for ambiguity—choosing among controls or candidate records—not for field extraction.
Deterministic adapters should extract listing IDs, URLs, titles, prices, sizes, and pagination once
the page has been reached. A browser rendering a page does not create permission to automate it;
source authorization remains an independent prerequisite.

## Could-be-wrong-if

The architecture loses its cost advantage if the general planner must be recalled after most
steps, if accessibility candidates routinely omit the required control, or if the Jev selection
precision needed for safe action forces frequent general-model fallback. A shadow corpus will test
all three claims before autonomous actions are implemented.
