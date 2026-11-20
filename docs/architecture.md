# Architecture

Xarp is a single package with a build function, a loopback preview server, and optional browser scripts.

`build()` reads a Markdown source, maps its slides through Marp, selects the requested order, and invokes Marp CLI with the same engine factory. It copies assets, adds section navigation and plugin metadata, then replaces the previous Xarp output directory. A failed build leaves the previous output intact.

The core uses Marp's public Markdown-it extension hook to record source positions after block parsing. This shares the renderer's handling of code, HTML, and math. Rendered slide counts provide an additional check. Source editing is disabled for `headingDivider`, which inserts boundaries after the mapping hook. Builds with `slides` or `sections` fail when mapping is unavailable.

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

`drawing()` bundles Drauu for stroke input and rendering. Travels and Mutative retain SVG snapshots per slide because Drauu resets its own history on load and clear. `editing()` uses the same history bundle, Moveable, and the guarded Markdown edit mapper. The plugins coordinate input through a native mode-change event.

The builder, editor, and drawing tool use a shared selector for each slide's content section. Marp's background layers are excluded from editing and section navigation. The editor observes the active slide class as well as URL hash changes, so selection and the Markdown drawer follow keyboard navigation.

`editing({ textSelectors, boxSelectors })` adds CSS selectors to the editor's supported targets. Explicit `data-xarp-edit="text"` and `data-xarp-edit="box"` attributes also mark targets. Source mapping can still reject an ambiguous operation, even when the element is selectable.

The descriptor convention is provisional. Custom descriptors supply browser assets only. `dev()` recognizes the built-in editing descriptor and attaches fixed editor routes. There is no general server-plugin interface.

## Saving

The editor validates the deck, slide, source revision, payload, and resulting boundaries. It rechecks source bytes immediately before atomic replacement, writes Markdown, then rebuilds. The service accepts one save at a time and rejects an overlapping request. A failed rebuild after writing returns `saved: true, rebuilt: false` so the browser can distinguish saved source from stale output.

The organizer uses a separate Travels history of complete source snapshots. Structural edits assign explicit slide IDs, use the ordinary guarded write path, and reload after a successful rebuild. Image uploads use content-derived filenames and are inserted through slide source history. Browser drawing storage uses an opaque hash of the canonical input path to separate projects served at the same URL.

The browser keeps history and unsaved changes per slide. A successful save patches that slide's rendering while retaining undo. The server compares the previous and rebuilt HTML to identify changes to other slides and deck CSS. Slides without unsaved edits update immediately. Slides with unsaved edits receive the latest rendering when saved or returned to their saved text. Changes to deck CSS or background-layer structure show a reload notice. An undo state with unsaved edits keeps the appearance it was captured with until the slide is saved or returns to its saved state.

Preview notifications reload a clean page and preserve active editing, pending changes, and ink. The file watcher retains notifications that arrive during a save or build, then rebuilds when the disk revision differs from the built revision. Closing the preview waits for active requests and builds. Changes to configuration, themes, or assets require restarting `dev`.

The [editor protocol](editor-protocol.md) can be implemented by another server. Authentication, staged rendering, and publication belong to that server. A static export does not provide disk access.

## Theme and assets

`themes/chao-ui/upstream.json` pins the bundled theme revision and file inventory. The snapshot includes fonts and license notices. `chao-ui` remains the upstream design source.

Marp resolves the theme at build time. Xarp's `colorScheme` global directive selects a palette independently. The build writes its name on the HTML root, and `_xarp/palettes.css` maps its colors onto chao-ui and Marp slide tokens. Edit Mode and the optional viewer picker share one browser control. A source save updates the author's default while preserving a viewer's explicit choice.

Project assets are copied into the output directory. Symlinks must stay inside the project and directory cycles are rejected. Plugin assets use `_xarp/plugins/`, the theme uses `_xarp/theme/`, and section navigation uses `_xarp/sections.css`.

The hidden `.xarp-build.json` file identifies output owned by Xarp. Public HTML contains relative source identity and revision hashes. It contains no absolute source path.
