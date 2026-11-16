# Xarp

Xarp turns Marp Markdown into HTML presentations with optional visual editing and drawing. Markdown stays the source. The output directory includes the theme, fonts, browser scripts, and local assets.

## Start a deck

Install Node.js 24 or 26, then install the release package in your project:

```sh
npm install --save-dev https://github.com/chaoxu/xarp/releases/download/v0.1.1/chaoxu-xarp-0.1.1.tgz
```

Write `slides.md`:

```markdown
# A useful idea

Explain it here.

---

# Show the evidence

Add a figure, example, or equation.
```

Build and open the local preview:

```sh
npx xarp build slides.md
npx xarp dev slides.md
```

`build` writes `dist/index.html` and its assets. Serve the entire `dist/` directory to share the presentation. `dev` prints a loopback URL and rebuilds when the Markdown file changes. Plain rendering requires no configuration or slide IDs.

## Edit and draw

Create `xarp.config.mjs`:

```js
import { editing, drawing } from '@chaoxu/xarp/plugins';

export default {
  input: 'slides.md',
  plugins: [editing(), drawing()],
  sections: [
    { label: 'Idea', count: 1 },
    { label: 'Evidence', count: 1 },
  ],
};
```

Run `npx xarp dev`. Press **E** to edit or **D** to draw. The controls stay hidden while presenting.

| Control | Behavior |
| --- | --- |
| Double-click text | Edit its contents |
| Drag a box or its handles | Move or resize it |
| Arrow keys in Edit Mode | Nudge the selected box, with Shift for larger steps |
| Slide Markdown | Read or edit the current slide's source |
| Save Slide | Save supported edits to Markdown and rebuild |
| Undo / Redo | Change the current slide's edit or drawing history |
| Copy Edits | Copy pending edits from a static export or a stale page |
| D, then pointer input | Draw with a mouse, pen, or touch |

Editing and drawing can be enabled separately or together. Undo remains available after saving. Drawing keeps ink per slide for the current page session. Reloading discards ink.

Visual editing maps text changes in Markdown headings, paragraphs and list items, moves of Markdown headings, and changes to raw HTML and SVG elements. When a change cannot be mapped to Markdown, the editor reports it before saving. Undo that change to use Slide Markdown. Markdown table cells, and layout changes to Markdown blocks other than headings, require Slide Markdown.

Saving a directive that affects other slides also updates those slides when they have no unsaved edits. Slides with unsaved edits keep those edits and update after saving or returning to their saved text. Deck CSS changes and adding or removing an image background show a reload notice. Save or copy pending edits before reloading.

Source loading and saving require `dev`. A static export is the output directory served without `dev`. It supports visual changes and Copy Edits. When an edit cannot be mapped safely to source, use Slide Markdown. External source changes never overwrite pending browser edits automatically.

## Configure the build

Paths in a configuration file are relative to that file. A CLI input argument overrides its `input` setting. Use `--config path/to/config.mjs`, `--output directory`, or `--port 4175` to select a configuration, output location, or preview port.

| Option | Default | Purpose |
| --- | --- | --- |
| `input` | `slides.md` in the CLI | Markdown source file |
| `output` | `dist` | Output directory inside the project |
| `theme` | Source theme, otherwise `chao-ui` | Bundled Marp theme name or project-relative CSS file |
| `slides` | All slides | Ordered list of explicit slide IDs |
| `sections` | None | Bottom progress navigation as `{ label, count }` entries |
| `assets` | Adjacent `assets/`, when present | Project-relative paths to copy |
| `plugins` | None | Browser features to include |

Section counts must sum to the number of selected slides. Named selection uses markers such as `<!-- slide: introduction -->` at the start of a slide. Ordinary decks need no markers. Duplicate IDs and unknown selected IDs fail the build.

An explicit `theme` overrides the source theme. Xarp bundles `chao-ui` and supports Marp's `default`, `gaia`, and `uncover` themes. A custom CSS theme needs an `@theme` declaration and can import `chao-ui`. Add `class: pf-slide` in the deck when a custom theme uses chao-ui's slide classes.

Explicit `assets` replace the adjacent-directory default and preserve project-relative paths. Keep asset references relative to the output root. Output must be empty or already owned by Xarp, and cannot contain the source. Symlinks that leave the project are rejected.

## Use from JavaScript

```js
import { build, dev } from '@chaoxu/xarp';
import { editing, drawing } from '@chaoxu/xarp/plugins';

const options = {
  input: 'slides.md',
  output: 'dist',
  plugins: [editing(), drawing()],
};

const result = await build(options);
console.log(result.htmlPath);

const preview = await dev({ ...options, port: 0 });
console.log(preview.url);
// Call await preview.close() when finished.
```

Library paths are relative to `cwd`, which defaults to the process's working directory. TypeScript declarations ship with the package. See [the architecture](docs/architecture.md) and [editor protocol](docs/editor-protocol.md) for integration details.

## Scope

The initial release supports HTML. Marp supplies slide navigation, fragments, fullscreen, and presenter view. Xarp's source editor supports explicit thematic breaks between slides and disables saving when `headingDivider` or a rendering mismatch prevents reliable mapping. With `slides` or `sections` configured, the build fails instead.

Use trusted Markdown, assets, plugins, and configuration files. HTML is enabled, configuration files execute JavaScript, and the local editor can write the configured source. The preview binds to loopback and requires same-origin JSON saves. It is a local authoring tool, with no remote authentication service.

The bundled theme includes about 53 MB of fonts and supporting assets. This keeps Chinese text and mathematics available without a font service. Authored external embeds retain their network requirements.

## Development

```sh
npm ci
npm run build
npm test
npm run test:browser
npm run test:package
npm run example
```

Browser tests launch their own headless Chrome. Set `XARP_TEST_CHROME` to its executable path on Linux. The [basic example](examples/basic/slides.md) exercises sections, editing, drawing, mathematics, and Chinese text. [Development notes](docs/development.md) describe release checks and theme updates.

Xarp's original code is MIT licensed. See [third-party notices](THIRD_PARTY_NOTICES.md) for bundled code and fonts.
