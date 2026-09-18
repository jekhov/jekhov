---
name: jev-playwright
description: Use standard Playwright plus a policy-enforcing Jev wrapper to inspect a permitted public or synthetic page and make a bounded, shadow-only element selection. Use when evaluating whether Jev can reduce the cost of LLM browser driving, building a labeled browser-selection corpus, or proposing the next element for a preplanned Playwright action. Do not use for private or unknown-class data, autonomous actions, scraping-prohibited sources, bot-control bypass, or open-ended browser planning.
---

# Jev Playwright

Use this skill to evaluate bounded browser element selection without acting on the page.

## Preconditions

1. Classify page data as `public` or `synthetic`. Stop for private, client, minor, legal, or unknown
   data.
2. Confirm the source permits the proposed automation. A normal browser session does not override
   site terms or bot controls.
3. Fix one next operation and goal before invoking the runner. Jev selects an element; it does not
   plan the workflow.

## Workflow

From the repository root:

1. Create a version-1 shadow plan with an exact hostname allowlist and documented policy basis.
2. Run the zero-cost inspection first:

   ```sh
   npm run build
   node dist/cli.js inspect --plan PLAN.json
   ```

3. Review the candidates for missing or over-broad elements.
4. Run one shadow selection through the policy-enforcing wrapper:

   ```sh
   node dist/cli.js shadow --plan PLAN.json --jev-client /path/to/jev-client.mjs
   ```

5. Preserve the report with its usage and provenance in private storage. Treat `proposal` as
   advisory and do not click, fill, select, or check it.

## Interpretation

- `status: proposed` means Jev chose a candidate; it does not mean the candidate is safe to act on.
- `status: abstained` means Jev selected `none`.
- `status: no-candidates` costs no Jev request.
- `matchProbability` estimates whether one candidate clearly fits. It is uncalibrated until compared
  with recorded labels for the intended action class.
- `executed` must remain `false` in this version.

Keep deterministic extraction, source policy, budgets, postconditions, and irreversible-action
rules outside Jev. Keep evaluation corpora and performance results private unless the provider has
authorized publication.
