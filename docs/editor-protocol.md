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

A successful response includes `ok`, identity fields, the new `sourceRevision`, `buildRevision`, `slideId`, `markdown`, and rendered `html`. Rebuild failure returns HTTP 500 with the saved source revision and an error. The browser retains its pending state and exposes Copy Edits during recovery.

## Hosted adapters

The browser also understands `mode: "hosted"`, `publicationPending`, and publication receipts. A hosted adapter must verify build identity and its own authentication before accepting writes. Publication retry uses `POST /__xarp/retry` and requires matching source and build identities in the response. Xarp's local service does not implement that route or publish output.

These fields preserve the browser's distinction between source saving, rendering, and confirmed publication. An adapter needs its own integration tests before serving editable Xarp HTML.
