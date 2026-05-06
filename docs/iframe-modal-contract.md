# Iframe Modal Navigation Contract

This document describes the current index/debate iframe modal contract. It is documentation only.

## Scope

This contract covers:

- opening debates from the index in an iframe modal
- syncing the parent index URL while the iframe is open
- preserving refresh behavior
- closing the modal and returning to the index
- notification-to-debate iframe transitions
- parent/child iframe `postMessage` coordination

## Core DOM Contract

The modal is created by `ensureDebateIframeModal()`.

Required DOM anchors:

- `#debate-iframe-modal`
- `#debate-iframe-modal-inner`
- `#debate-iframe-modal-close`
- `#debate-iframe-modal-frame`

The modal is opened by `openDebateIframeModal(url, options)` and closed by `closeDebateIframeModal()`.

## Refresh Contract

Important rule:

- A top-level refresh should be based on the visible URL only.
- A previously stored iframe URL in `sessionStorage` must not reopen an old iframe on refresh.

The critical function is:

- `resolveInitialOpenModalUrl(openModalUrl)`

Current expected behavior:

- accepts a safe current `openModal` query param
- rejects stale `sessionStorage` reopening
- returns `""` when no explicit current URL asks for a modal

This protects the behavior: refresh on index remains index.

## Parent URL Contract

`syncIndexUrlWithOpenIframeModal(modalUrl)` controls the parent URL while a modal is open.

Current behavior:

- `/debate?id=123` is represented as `/debates/123`
- closing the modal returns the parent path to `/`
- `/notifications` is temporary and should not be burned into the parent URL
- the latest modal URL may be stored, but refresh restoration must not use it

## Session Storage Contract

The key `IFRAME_LATEST_MODAL_URL_KEY` currently maps to:

- `agon_iframe_latest_modal_url`

It is allowed to remember the latest modal URL for live coordination, but it must not be treated as a refresh source of truth.

## Parent/Child Message Contract

The child iframe can send:

- `agon:close-debate-modal`
- `agon:open-debate-in-parent-modal`
- `agon:debate-iframe-ready`
- `agon:notification-target-ready`
- `agon:notification-back-transition-start`
- `agon:iframe-page-context`
- `agon:pause-page-media`
- `agon:voices-badge-position`
- `agon:argument-form-visibility`

The child-side bridge is:

- `initIframePageContextBridge()`
- `notifyParentAboutIframePageContext(pathname, href)`
- `syncParentIndexUrlFromIframe(pathname, href)`

## Close Contract

On close, the modal should:

- pause media in the child frame
- remove `.open`
- call `syncIndexUrlWithOpenIframeModal("")`
- clear modal-open globals
- resume suspended index embeds
- restore index scroll
- tear down iframe src to `about:blank`
- restore or resume index infinite scroll

## Do Not Change Casually

Avoid changing these without a targeted browser check:

- `resolveInitialOpenModalUrl`
- `syncIndexUrlWithOpenIframeModal`
- `openDebateIframeModal`
- `closeDebateIframeModal`
- `rememberLatestIframeModalUrl`
- `initIframePageContextBridge`
- message names beginning with `agon:`
- parent URL handling for `/notifications`

## Suggested Verification

Before and after any runtime change near this area:

- `npm run verify:safe`
- `npm run audit:scale`
- `npm run docs:cleanup`
- `npm run docs:compare`
- `npm run docs:iframe`

Manual check required for runtime changes:

- open a debate from index, close it, index remains stable
- refresh index after a debate was previously opened, index remains index
- direct `/debates/:id` opens the corresponding debate modal
- notification click to debate works
- closing a notification-opened modal returns correctly
- back/forward browser navigation does not reopen a stale iframe
