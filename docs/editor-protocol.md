# Editor protocol

The editing plugin calls same-origin routes under `/__xarp/`. Xarp's local service binds to loopback and serves a single configured deck. A hosted adapter must supply its own authentication and write policy.

## Status and source

`GET /__xarp/status?view=slides` returns the configured deck identity and whether source editing is available:

```json
{
  "editorApi": true,
  "mode": "local",
  "ok": true,
  "canSave": true,
  "viewId": "slides",
  "sourceFile": "slides.md",
  "sourceRevision": "sha256-of-source",
  "buildRevision": "sha256-of-build-inputs",
  "version": 1
}
```

`viewId` is derived from the configured input filename. `sourceFile` is relative to the project root. `GET /__xarp/slide?view=slides&slide=slide-1` adds `slideId` and the current slide's `markdown` to the identity fields. Explicit marker IDs replace generated IDs when present.

## Save

Send `POST /__xarp/save` with `Content-Type: application/json` and a matching `Origin` header:

```json
{
  "viewId": "slides",
  "sourceFile": "slides.md",
  "sourceRevision": "sha256-of-source",
  "buildRevision": "sha256-of-build-inputs",
  "slideId": "slide-1",
  "markdown": "# Revised heading"
}
```

Supply either `markdown` or the browser's `edits` array. The local service validates the source revision. It accepts `buildRevision` for protocol compatibility but does not use it as a local write precondition. Generated slide IDs are meaningful only for the supplied source revision.

Requests are limited to 128 KiB. Malformed, stale, wrong-deck, wrong-source, invalid-slide, cross-origin, and overlapping saves are rejected before source replacement. A slide update cannot add or remove boundaries or change IDs.

| Receipt | Meaning |
| --- | --- |
| `saved: false` | This request did not change source |
| `saved: true, rebuilt: true` | Source was written and HTML rebuilt |
| `saved: true, rebuilt: false` | Source was written, but output is stale |

A successful response includes `ok`, identity fields, the new `sourceRevision`, `buildRevision`, `slideId`, `markdown`, and rendered `html`. Rebuild failure returns HTTP 500 with the saved source revision and an error. The browser reports the saved source separately from the stale rendering and retains undo history and other unsaved edits.

Successful local rebuilds also include `changedSlides`, an array of other slide IDs whose rendered SVG changed, and `deckStyleChanged`, a boolean indicating changed head styles or a changed slide count. These comparisons use the previous and rebuilt artifacts.

The browser applies changed renderings to slides without unsaved edits and defers changes to slides with unsaved edits. A deferred slide updates after saving or returning to its saved text. Changes to deck CSS or background-layer structure require a reload. Pending edits stay in the tab until the user saves or undoes them, or reloads the page. Copying preserves the pending edits in the tab. A receipt that omits the rendering-change fields also produces a reload notice.

## Hosted adapters

The browser also understands `mode: "hosted"`, `publicationPending`, and publication receipts. A hosted adapter must verify build identity and its own authentication before accepting writes. Publication retry uses `POST /__xarp/retry` and requires matching source and build identities in the response. Xarp's local service does not implement that route or publish output.

A successful publication retry can omit `html` when the browser already has that source and build revision. Otherwise, it must include the rebuilt HTML to resume visual editing without a reload. Pending visual edits remain separate from publication retry and do not block it.

These fields preserve the browser's distinction between source saving, rendering, and confirmed publication. An adapter needs its own integration tests before serving editable Xarp HTML.

## Image uploads and slide organization

Local status responses advertise `capabilities.images`, `capabilities.organize`, and `capabilities.resizeDeck`. The browser shows Insert Image and Slides when their capabilities are enabled. It disables Add, Duplicate, and Delete when `resizeDeck` is false. Hosted adapters can continue implementing the slide-save protocol without these routes.

`POST /__xarp/asset` takes `viewId`, `sourceFile`, `sourceRevision`, and `image`, a base64 string. It uses the same origin, revision, and serialization checks as Save. The JSON request limit is 12 MiB and decoded images are limited to 8 MiB. Supported signatures are PNG, JPEG, GIF, and WebP. The receipt returns `ok`, the deck identity, and `path`. The immutable filename is derived from the image bytes. The client inserts that path through a normal slide save, so a failed save leaves its source draft available to retry. Uploads do not change Markdown by themselves.

`GET /__xarp/deck?view=slides` returns identity, capabilities, slide IDs and titles, and `canUndo` / `canRedo` for arrangement history. `POST /__xarp/deck` takes the save identity and an `action`: `move`, `add`, `duplicate`, `delete`, `undo`, or `redo`. The first four actions take `slideId`. A move also takes a zero-based destination `to`. Add and Duplicate insert after the chosen slide. The last remaining slide cannot be deleted.

Structural writes use the source revision check and atomic replacement used by Save. They return the usual `saved` / `rebuilt` distinction, plus `deckChanged: true` and the selected slide ID when available. Successful rebuilds include HTML for the client to reload. The browser permits structural writes only after pending edits and ink have been resolved.

Arrangement history is held in memory by the local server and is valid only while its current snapshot exactly matches the source bytes. After a structural write fails to rebuild, status advertises `deckRecovery: true` and the committed source revision. Clients can offer the available Undo or Redo arrangement action against that revision while keeping editing of the stale rendering disabled.
