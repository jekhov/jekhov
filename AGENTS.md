# Jekhov project instructions

Follow the parent workspace instructions.

- Keep the runner shadow-only until a labeled calibration supports an action threshold.
- Route production Jev requests through the policy-enforcing wrapper. Never add direct provider
  HTTP calls.
- Support only declared public or synthetic data.
- Keep evaluation corpora and provider performance results private unless publication is authorized.
- Keep browser actions, postconditions, budgets, and source policy deterministic.
- Mark every TypeScript source file `// pattern: Functional Core` or
  `// pattern: Imperative Shell`.
- Run `npm run validate` and `npm run build` before a commit.
- Do not publish or push without explicit authorization.
