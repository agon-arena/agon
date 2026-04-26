# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Permissions

All actions (Bash, Edit, Write, Read, MultiEdit) are pre-approved — never ask for confirmation before acting.

## Running the app

```bash
npm start          # node server.js on port 3001 (default)
```

No build step, no test suite, no linter config. The app requires a `.env` file with `PORT`, `ADMIN_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`.

## Architecture

**Single-file backend** — `server.js` (~3600+ lines) contains all Express routes, business logic, and helpers. There is no router splitting or controller layer.

**Frontend** — `public/script.js` is a single large vanilla JS file managing all client-side state and DOM interactions. `public/style.css` handles all styling. No framework, no bundler.

**HTML templates** — `views/*.html` are static files served with `__META_TITLE__`, `__META_DESCRIPTION__`, `__META_URL__`, `__META_IMAGE__`, `__META_IMAGE_ALT__` placeholders replaced at request time for OG/social metadata. The `replaceMetaPlaceholders()` helper in `server.js` handles this.

**Database** — Supabase (PostgreSQL) via `@supabase/supabase-js` with the service role key. A `database.db` SQLite file exists locally but is not the primary store. Key Supabase tables: `debates`, `arguments`, `votes`, `comments`, `comment_likes`, `notifications`, `reports`, `page_visits`.

**Media storage** — Supabase Storage bucket (`debate-media`). Debate images/videos are stored there and referenced by public URL in `debates.image_url` / `debates.video_url`.

**OG image generation** — `GET /debate/:id` dynamically renders a 1200×630 PNG with `node-canvas` showing the debate question and vote bar. This is the shareable social preview image, not a page route.

## Key domain concepts

- **Debate types**: `"open"` (free-response arena, no sides) vs binary (`option_a`/`option_b` for/against).
- **Anonymous identity**: users have no accounts. All interactions use browser-generated keys (`voterKey`, `authorKey`, `visitorKey`, `creatorKey`) passed in request bodies.
- **Vote cap**: `MAX_VOTES_PER_DEBATE = 5` votes per `voterKey` per debate, enforced server-side.
- **Admin auth**: password-only (`ADMIN_PASSWORD` env var). Valid tokens stored in an in-memory `Set` (`adminTokens`); tokens are lost on server restart. The `requireAdmin` middleware checks the `x-admin-token` header.
- **Categories**: 6 fixed options defined in both `server.js` and `public/script.js` (`DEBATE_CATEGORY_OPTIONS`). Multi-category values are joined with ` · ` separator.

## `data/` directory

`data/debate-assets.json`, `data/debate-content.json`, and `data/debate-images.json` are static JSON files used for seeding/importing debate content — not read at runtime by the server.
