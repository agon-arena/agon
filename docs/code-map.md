# Code Map

This document is intentionally descriptive only. It does not define runtime behavior.

## Runtime Entry Points

- `server.js`: Express server, Supabase access, API routes, metadata rendering, media upload/storage helpers, notification logic, and in-memory caches.
- `public/script.js`: main browser runtime for index, debate, create, notifications, sharing, voting, source previews, mobile overlays, and iframe coordination.
- `public/style.css`: shared styles for the main app surfaces.
- `views/index.html`: index page markup plus targeted inline patches for index-specific UI behavior.
- `views/debate.html`: debate page markup plus targeted inline patches for debate-specific UI behavior.

## High-Risk Areas

These areas should not be moved or refactored without a focused test/check first:

- iframe modal navigation and refresh behavior
- index/debate YouTube source preview controls
- mobile source preview swipe behavior
- vote/comment local state updates
- Supabase cache invalidation around debates, arguments, comments, votes, notifications
- inline scripts in `views/index.html` and `views/debate.html`
- globals exposed through `window.*`

## Safe Cleanup Policy

Preferred safe cleanup order:

1. Add read-only inventory or documentation.
2. Add checks that report behavior-sensitive surfaces.
3. Make one tiny code movement only when the before/after inventory is unchanged.
4. Run `npm run verify:safe` and `npm run audit:scale` after each step.

Avoid in the same change:

- moving code and changing behavior
- deleting globals before proving they are unused
- replacing inline handlers before inventorying them
- changing Supabase selectors without response-shape checks

## Current Guardrails

- `npm run verify:safe`: syntax and critical route checks.
- `npm run audit:scale`: read-only scale report.
- `tools/scale-budgets.json`: report-only visibility budgets.
- `npm run docs:inventory`: read-only inventory of active code surfaces.
