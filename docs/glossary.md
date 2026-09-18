# Jekhov Glossary

This public glossary defines Jekhov's project vocabulary. Terms such as **abstention**, **bounded**,
**candidate**, **gate**, **observation**, **postcondition**, **proposal**, and **shadow mode** keep
their ordinary technical meanings unless refined below.

## Accessibility snapshot

The structured value returned by Playwright's `ariaSnapshotJSON({ mode: "ai" })` for the observed
page.

Not: a screenshot, raw DOM dump, or instruction stream.

Invariant: Jekhov treats every page-derived field as untrusted data.

## Browser action

A Jekhov refinement of the shared **action**: exactly one of `click`, `fill`, `select`, or `check`,
fixed before candidate selection begins.

Not: an open-ended instruction for Jev to plan the next operation.

## Action candidate

A Jekhov refinement of the shared **candidate**: an enabled accessibility node with a local element
reference and a role compatible with the preplanned browser action. Pointer-cursor nodes may also be
click candidates.

Not: every visible node or every element in the DOM.

Invariants:

- The set is finite and deterministically filtered before Jev runs.
- Candidate IDs are request-local opaque labels.
- Playwright element references remain local and never enter the Jev request.

## Preplanned step

One step whose goal and browser action were fixed before observing candidates. Jev may select its
target or abstain; it may not change the goal or action.

Not: autonomous browser planning.

## Inspect mode

The zero-Jev-request path that observes the page, validates the resulting URL, and reports the
bounded action candidates.

Not: shadow mode; inspect mode does not run the live Jev decision path.

Invariant: `executed` is `false` and provider usage is zero.

## Selection request

The bounded Jev input containing the step goal, intended browser action, minimized page metadata,
compact candidate metadata, and one choice question. The full production profile also includes one
ambiguity-probability question; the evaluation-only choice profile omits that question and duplicate
candidate state.

Not: the accessibility snapshot or a general browser-control prompt.

Invariant: the request contains no Playwright element references or URL query values.

## Match probability

The calibrated selection signal. The full profile uses Jev's answer to whether exactly one candidate
clearly advances the stated goal with the intended action. The choice-only evaluation profile uses
Choice confidence while retaining the complete candidate probability distribution.

Not: the probability that the proposed action is safe, authorized, or correct end to end.

Invariant: it cannot become an action gate until calibrated for the intended action class.

## Choice telemetry

Jev's confidence and complete candidate probability distribution for a bounded Choice answer.

Not: an action authorization or a substitute for deterministic safety and oracle gates.

Invariant: every declared candidate and the explicit `none` option has exactly one finite
probability, and the report records whether Choice confidence or the ambiguity Noul supplied the
match probability.

## Source policy

The exact-host allowlist plus recorded source-authorization basis, review date, and note attached to
a plan.

Not: a legal opinion or a bypass for site terms and bot controls.

Invariant: Jekhov validates the requested URL before navigation and the observed URL after redirects,
before page-derived data reaches Jev.

For public plans, `providerDisclosure: "allowed"` is a separate required declaration that the
bounded public page fields may be disclosed to the configured selector provider. Source access and
provider disclosure are independent decisions.

## Policy-enforcing Jev wrapper

The injected process boundary that validates and limits a Jev request and response, pins provider
configuration, and records provenance and usage.

Not: a direct provider HTTP call embedded in Jekhov.

## Shadow report

The durable record of one shadow-mode step: observation metadata, candidate counts, request bytes,
status, proposal or abstention, match probability, provenance, usage, and execution state.

Invariant: `executed` is always `false`.

## Action mode

A future mode that would perform a proposed browser action only after calibrated and deterministic
gates pass.

Not: current functionality. No action mode exists in version `0.1.0`.

## Synthetic task harness

A multi-step execution path restricted to repository-owned `data:` pages. Each step fixes its
action, input, labeled target identity, deterministic postconditions, and resource budget before
selection.

Not: general action mode or autonomous browsing.

Invariants:

- Exactly one candidate must match the labeled role and accessible name before a Jev request.
- The Jev proposal must exactly match that labeled identity before action.
- A fresh accessibility snapshot must reproduce the selected local reference and identity.
- Candidate truncation, abstention, label mismatch, stale state, disallowed navigation, or a failed
  postcondition stops the task.
- Labels remain outside the Jev request.
- Repository data fixtures have an empty host allowlist and execute in an offline browser context.
- An attempted action is reported as executed even if Playwright later returns an error;
  confirmation is recorded separately and uncertain actions are never retried.

## MiniWoB++ slice

A pinned local benchmark adapter covering five MiniWoB++ templates with preplanned operations,
Playwright accessibility observations, withheld labels, deterministic actions, and native rewards.

Not: the complete MiniWoB++ or BrowserGym benchmark, or evidence of autonomous planning.

Invariants:

- Corpus capture uses no Jev request and labels duplicate target identities as expected abstentions.
- Execution uses the synthetic task oracle gate and accepts success only when MiniWoB++ reports a
  positive terminal reward.
- The source revision, templates, seeds, action budgets, and report scope are explicit.

## Evaluation case

A stored plan, page observation, and human-supplied label naming the expected local element reference
or explicit abstention.

Not: a live browser run or a prompt containing the answer.

Invariants:

- The label remains outside every selector request.
- A non-null expected reference must survive deterministic candidate filtering for the planned
  action.
- The plan's source policy applies to the stored observation URL.

## Selector evaluation

A shadow-only replay of an evaluation corpus through one or more injected selection wrappers.

Not: browser-agent benchmarking, an action threshold, or evidence that a proposed action is safe.

Invariant: execution is sequential and bounded to at most one wrapper request per selector per
case; no browser action exists on this path.

## General-model selector baseline

A conventional general model answering the same bounded selection request as Jev, with candidate
eligibility and scoring held constant.

Not: a full browser agent operating on a raw page observation.

Invariant: the baseline may choose a candidate or abstain but cannot browse, call tools, modify the
candidate set, or execute a browser action.

## Selector cascade

A composition that accepts a primary selector proposal only when its match probability meets the
declared threshold for that action, otherwise substituting a compatible fallback selector.

Not: an action gate or permission to execute the resulting proposal.

Invariants:

- Primary errors, invalid responses, and explicit abstentions always route to the fallback.
- Offline calibration retains both recorded outcomes, usage, latency, and final labeled outcome.
- Live routing retains both legs' provenance and combined numeric usage.

## Calibration operating point

The measured accuracy, proposal precision, fallback rate, usage, latency, and cost estimate produced
by replaying one declared threshold over a labeled selector comparison.

Not: a production threshold selected from a smoke test.

Invariant: operating points remain descriptive until the intended action class has enough labeled
cases and a declared precision target.

## API list-price estimate

A deterministic translation of recorded numeric usage through an explicit dated USD rate snapshot.

Not: an invoice, provider-reported cost, or a claim that a locally cached request incurred API
charges.

Invariant: the report identifies the rate date, model, source URL, token components, and whether
every recorded request had enough usage data to price.
