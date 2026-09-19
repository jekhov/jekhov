# Changelog

All notable changes to Jekhov are documented here.

## Unreleased

### Added

- Added offline `validate` commands for plans, evaluation corpora, and pricing files, plus
  `--version` output and a public validation API.

### Changed

- Bounded plan, pricing, wrapper-response, cache, and baseline JSON reads before parsing.
- Added a deterministic accessibility-snapshot traversal ceiling and safe handling for cyclic
  library input.
- Made durable JSON writes atomic, symlink-safe, private by default, and unwilling to replace
  devices, FIFOs, sockets, or directories.
- Reject duplicate CLI flags across all three shipped binaries instead of silently accepting the
  last value.
- Added version and policy fingerprints to inspect reports.
- Reused `happy-dom` environments through Vitest's VM-thread pool to reduce test startup overhead.

### Fixed

- Kept the Codex baseline's bounded file envelope large enough for pretty-printed requests that are
  valid under its compact 60,000-byte semantic limit.
- Reject non-regular JSON inputs without blocking, and refuse validation output paths that resolve
  to the input artifact.

## 0.1.1 - 2026-09-18

Documentation-only patch release.

### Fixed

- Replaced broken links to Jev, the official Codex non-interactive documentation, and related work.
- Clarified that Jekhov is an npm library and CLI for Playwright workflows.

## 0.1.0 - 2026-09-18

Initial public release.

### Added

- Policy-bounded Jev target selection for preplanned Playwright actions.
- Shadow-only public-site observation with explicit source policy and data minimization.
- A bundled TypeSafe SDK wrapper with request validation, pinned provider settings, provenance,
  usage reporting, and a private content-addressed cache.
- Existing-page integration for caller-owned Playwright `Page` objects.
- Labeled synthetic multi-step execution with deterministic postconditions and resource budgets.
- A reproducible five-template MiniWoB++ grounding and execution slice.
- Public synthetic corpora, selector evaluation, calibration, and fallback analysis.
- Per-action selector cascade routing for errors, abstention, invalid output, and low confidence.

### Boundaries

- Public-site runs produce proposals and never execute browser actions.
- Complete execution is restricted to labeled synthetic fixtures and the pinned MiniWoB++ slice.
- Private or client data is unsupported.
- The release does not provide autonomous browser planning.
