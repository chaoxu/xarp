# Architecture

Xarp is a single package with a build function, a loopback preview server, and optional browser scripts.

`build()` reads a Markdown source, maps its slides through Marp, selects the requested order, and invokes Marp CLI with the same engine factory. It copies assets, adds section navigation and plugin metadata, then replaces the previous Xarp output directory. A failed build leaves the previous output intact.

The core uses Marp's public Markdown-it extension hook to record source positions after block parsing. This shares the renderer's handling of code, HTML, and math. Rendered slide counts provide an additional check. Source editing is disabled for `headingDivider`, which inserts boundaries after the mapping hook.

## Plugins

A plugin describes local browser assets and JSON data:

```ts
interface Plugin {
  name: string;
  styles?: URL[];
  scripts?: URL[];
  data?: JsonValue;
}
```

The builder emits styles and deferred scripts in descriptor order. Shared URLs appear once. Scripts initialize themselves after the document is parsed. Duplicate plugin names or conflicting asset filenames fail the build. Data is escaped in the `xarp-meta` JSON element.

`drawing()` loads its script and the shared history bundle. `editing()` also loads Moveable and the guarded Markdown edit mapper. They coordinate input through a native mode-change event. History uses Travels and Mutative.

`editing({ textSelectors, boxSelectors })` adds CSS selectors to the editor's supported targets. Explicit `data-xarp-edit="text"` and `data-xarp-edit="box"` attributes also mark targets. Source mapping can still reject an ambiguous operation, even when the element is selectable.

The descriptor convention is provisional. Custom descriptors supply browser assets only. `dev()` recognizes the built-in editing descriptor and attaches fixed editor routes. There is no general server-plugin interface.

## Saving

The editor validates the deck, slide, source revision, payload, and resulting boundaries. It rechecks source bytes immediately before atomic replacement, writes Markdown, then rebuilds. Saves are serialized. A failed rebuild after writing returns `saved: true, rebuilt: false` so the browser can distinguish saved source from stale output.

The browser keeps history and unsaved changes per slide. A successful save patches that slide's rendering while retaining undo. Preview notifications reload a clean page and preserve active editing, pending changes, and ink. Changes to configuration, themes, or assets require restarting `dev`.

The [editor protocol](editor-protocol.md) can be implemented by another server. Authentication, staged rendering, and publication belong to that server. A static export does not provide disk access.

## Theme and assets

`themes/chao-ui/upstream.json` pins the bundled theme revision and file inventory. The snapshot includes fonts and license notices. `chao-ui` remains the upstream design source.

Project assets are copied into the output directory. Symlinks must stay inside the project and directory cycles are rejected. Plugin assets use `_xarp/plugins/`, the theme uses `_xarp/theme/`, and section navigation uses `_xarp/sections.css`.

The hidden `.xarp-build.json` file identifies output owned by Xarp. Public HTML contains relative source identity and revision hashes. It contains no absolute source path.
