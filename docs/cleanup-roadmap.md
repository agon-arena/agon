# Cleanup Roadmap

This document is intentionally conservative. It is a cleanup plan, not a refactor plan.

## Current Safe Boundary

The current safe boundary is documentation and read-only tooling only. Runtime files are not moved, split, or rewritten.

Current runtime files to protect:

- `server.js`
- `public/script.js`
- `public/style.css`
- `views/index.html`
- `views/debate.html`

## Priority 1: No Runtime Change

These steps are safe because they do not change production behavior:

- keep `docs/code-map.md` up to date when new sensitive areas are discovered
- use `npm run docs:inventory` before cleanup work
- use `npm run docs:cleanup` for a compact cleanup summary
- keep `npm run verify:safe` and `npm run audit:scale` green

## Priority 2: Report-Only Checks

These steps stay low risk if they only report:

- add new counts to `tools/code-inventory.js`
- add new report-only budgets to `tools/scale-budgets.json`
- add docs for known runtime contracts, especially `window.*` globals and inline handlers

## Priority 3: Tiny Runtime Cleanup, Not Zero Risk

These steps are useful, but they are not zero risk:

- move one inline script block into `public/script.js`
- merge two duplicate helpers only after call sites are mapped
- replace one inline handler with `addEventListener`
- split one self-contained block out of `public/script.js`

Each tiny runtime cleanup should have:

- one clearly named target
- one before/after inventory comparison
- `npm run verify:safe`
- `npm run audit:scale`
- manual browser check on index and debate mobile if UI is affected

## Stop Conditions

Stop cleanup and reassess if:

- route counts change unexpectedly
- `window.*` surface changes unexpectedly
- inline handler count changes without a deliberate target
- observers/listeners change outside the target area
- any mobile YouTube source preview behavior is touched accidentally
