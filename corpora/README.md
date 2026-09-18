# Public evaluation corpora

These files contain declared synthetic data and labels. They contain no provider responses or
performance results.

- `synthetic-v1.json` is the small smoke corpus.
- `synthetic-v2.json` is the repository-owned development corpus.
- `miniwob-v1.json` is the 91-case grounding slice captured from MiniWoB++ seeds 0-9 at revision
  `7fd85d71a4b60325c6585396ec4f48377d049838` (MIT license). It covers `choose-list`,
  `click-button`, `click-checkboxes`, `click-test`, and `enter-text`. One duplicated accessible
  target is labeled as expected abstention.

Rebuild the MiniWoB++ corpus with:

```sh
node dist/cli.js miniwob capture \
  --root .benchmarks/miniwob-plusplus \
  --seeds 0-9 \
  --output corpora/miniwob-v1.json
npx biome format --write corpora/miniwob-v1.json
```

The expected SHA-256 is
`2e1a2c9d3af4162b89d93ea40d0f0f5a6f932000eb49dad15141864052932e81`.
