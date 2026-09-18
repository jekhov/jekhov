# ADR 01: Release execution boundary

- Status: Accepted
- Date: 2026-09-18

## Context

Jekhov needs to demonstrate a real plan/select/act/verify loop without treating an uncalibrated
match probability as permission to act on arbitrary sites. The project also needs a reproducible
external benchmark that separates selector quality from execution success.

## Decision

Version 0.1 keeps public-site operation in shadow mode. It permits browser actions only in declared
synthetic tasks where every step has:

- a fixed operation and input;
- one uniquely matching withheld role/name label;
- a fresh matching Playwright accessibility reference;
- deterministic postconditions and URL validation; and
- explicit step, request, and timeout budgets.

Repository data fixtures additionally use an empty host allowlist and an offline browser context.
MiniWoB++ uses only the exact URL served from a clean worktree at the pinned revision.

The pinned MiniWoB++ slice uses the same boundary and additionally requires a positive native task
reward. A live selector cascade may replace a low-confidence primary proposal with a compatible
fallback proposal, but it does not relax any execution gate.

Public action mode remains unavailable until a separately declared threshold is selected on
development labels and meets a predeclared precision target on an untouched holdout representative
of the intended action and page class. The current synthetic and MiniWoB++ corpora do not represent
arbitrary public pages.

## Consequences

- The release can execute complete synthetic tasks and report genuine environment-validated
  success.
- Users can integrate shadow selection with an existing Playwright page and measure a live or
  offline selector cascade.
- Jekhov cannot claim general browser-agent parity, autonomous planning, or a production action
  threshold in version 0.1.
- Broader execution requires new evidence and an explicit review; it cannot be enabled by changing
  a default confidence value.

## Revisit condition

Revisit this boundary when an action-specific, source-authorized corpus has a frozen development /
holdout split, a declared precision target, and a holdout result that meets that target with enough
coverage for the intended workflow.
