# Jekhov Glossary

Jekhov inherits the shared project glossary at `~/.claude/rules/glossary.md`. Shared terms such as
**abstention**, **bounded**, **candidate**, **gate**, **observation**, **postcondition**, **proposal**,
and **shadow mode** keep their canonical meanings here. This file defines Jekhov-specific terms and
explicit refinements only.

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
compact candidate metadata, one choice question, and one ambiguity-probability question.

Not: the accessibility snapshot or a general browser-control prompt.

Invariant: the request contains no Playwright element references or URL query values.

## Match probability

Jev's answer to whether exactly one candidate clearly advances the stated goal with the intended
action.

Not: the probability that the proposed action is safe, authorized, or correct end to end.

Invariant: it cannot become an action gate until calibrated for the intended action class.

## Source policy

The exact-host allowlist plus recorded source-authorization basis, review date, and note attached to
a plan.

Not: a legal opinion or a bypass for site terms and bot controls.

Invariant: Jekhov validates the requested URL before navigation and the observed URL after redirects,
before page-derived data reaches Jev.

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

Not: current functionality. No action mode exists in version `0.0.0`.

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
