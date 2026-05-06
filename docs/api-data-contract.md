# API Data Contract

This document describes the current API/Supabase data contract. It is documentation only.

## Scope

This contract covers:

- Express API routes in `server.js`
- Supabase table access through `supabase.from(...)`
- Supabase RPC access through `supabase.rpc(...)`
- in-process API response caches
- cache invalidation hooks around debates, arguments, comments, votes, and notifications

## Supabase Client Contract

The server creates one Supabase client with:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Because the service role key is used server-side, browser code must not import or expose it.

## Main Tables Currently Touched

Known table names in the app:

- `users`
- `debates`
- `arguments`
- `comments`
- `votes`
- `comment_likes`
- `notifications`
- `reports`
- `page_visits`

Known storage bucket setting:

- `SUPABASE_DEBATE_MEDIA_BUCKET`

Known RPC:

- `cast_argument_vote`

## User Resolve Route

- `POST /api/users/resolve` creates or updates a server-side `users` row from the existing browser legacy key.
- This route is additive and does not change existing vote, comment, notification, or debate payloads.

## Critical Read Routes

The highest-sensitivity read routes are:

- `GET /api/debates`
- `GET /api/debates/:id`
- `GET /api/notifications`
- `GET /api/admin/reports`

Any change to their returned shape should be treated as runtime-risky.

## Cache Contract

Current in-process caches:

- `debatesApiResponseCache`
- `debateDetailResponseCache`
- `notificationsApiResponseCache`
- `externalPreviewCache`
- `ogImageCache`

Critical cache functions:

- `getCachedDebatesApiResponse`
- `setCachedDebatesApiResponse`
- `clearDebatesApiResponseCache`
- `getCachedDebateDetailResponse`
- `setCachedDebateDetailResponse`
- `clearDebateDetailResponseCache`
- `getCachedNotificationsApiResponse`
- `setCachedNotificationsApiResponse`
- `clearNotificationsApiResponseCache`
- `invalidateDebateCaches`

## Known Scale Pressure

These are not bugs by themselves, but they are important scale signals:

- `.select("*")` exists in several routes/helpers
- `GET /api/debates` reads debates plus related arguments/comments/votes before shaping the response
- cache is process-local, so it does not survive restarts and is not shared across multiple instances
- destructive admin/report routes perform manual cascade-style deletes

## Do Not Change Casually

Avoid changing these without response-shape checks:

- replacing `.select("*")` with explicit columns
- changing cache keys
- changing cache invalidation on votes/comments/arguments
- changing `GET /api/debates` sorting or pagination behavior
- changing `GET /api/debates/:id` payload structure
- changing notification read/delete behavior
- changing `cast_argument_vote` payload expectations

## Suggested Verification

Before and after any runtime change near this area:

- `npm run verify:safe`
- `npm run audit:scale`
- `npm run docs:cleanup`
- `npm run docs:compare`
- `npm run docs:data`

Manual/API check required for runtime changes:

- `GET /api/debates`
- `GET /api/debates/:id`
- vote and unvote
- comment creation and comment vote
- notification read/delete
- admin reports if touched
