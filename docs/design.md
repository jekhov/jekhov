# Working design

This is a spike, not an architectural decision record. It becomes authoritative only after a
calibrated shadow run and an explicit review.

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
bounded Jev call rather than another full-model page interpretation. The current runner implements
one step so the cost and accuracy claim can be measured before a loop hides either failure mode.

## Deliberate constraints

1. The plan fixes the operation. Jev selects only the element in v0.
2. `inspect` costs nothing beyond browser work. `shadow` makes at most one Jev request.
3. Candidate text is untrusted data. It never changes instructions or policy.
4. Exact-host policy runs before navigation and again after redirects.
5. No private, client, minor, legal, or unknown-class data enters Jev.
6. No action mode exists. Confidence thresholds remain unset until calibration produces a measured
   operating point.
7. The browser adapter uses Playwright's public `ariaSnapshotJSON()` API. Element references remain
   local and never enter the Jev request.

## Measurement before action mode

Build a labeled set of real, permitted pages plus synthetic adversarial pages. For each step,
record the candidate set, expected candidate or abstention, selected candidate, ambiguity
probability, request bytes, usage, cache status, and elapsed time. Compare accuracy and total token
cost with a general-model Playwright baseline on the same tasks.

Keep the corpus and results private. Do not publish provider benchmarks or performance results
without confirming that the applicable provider agreement permits publication.

Do not infer a confidence threshold from a handful of examples. Action mode needs:

- a declared precision target for the specific action class;
- a separately measured abstention rate;
- deterministic postconditions;
- a maximum step and request budget;
- immediate stop on navigation outside the host allowlist; and
- review before this becomes a default browser path.

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
