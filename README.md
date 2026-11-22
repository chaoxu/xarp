# Xarp

Xarp turns Marp Markdown into HTML presentations with optional visual editing, drawing, and narrated Watch Mode. Markdown stays the source. The output directory includes the theme, fonts, browser scripts, and local assets.

The [demo deck](https://talk.chaoxu.prof/xarp/) shows editing, drawing, mathematics, Chinese text, presenter controls, Watch Mode, and an interactive plugin. Run [its source](examples/showcase/) locally to try saving changes to Markdown.

## Start a deck

Install Node.js 24 or 26, then install the release package in your project:

```sh
npm install --save-dev https://github.com/chaoxu/xarp/releases/download/v0.2.2/chaoxu-xarp-0.2.2.tgz
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
| Snap: On / Off | Snap to slide edges, centre, thirds, and other elements. Hold Alt to bypass |
| Insert Image | Upload an image to the local deck and insert it on the current slide |
| Slides | Reorder, add, duplicate, delete, or undo an arrangement in the local editor |
| Slide Markdown | Read or edit the current slide's source |
| Save Slide | Save supported edits to Markdown and rebuild |
| Undo / Redo | Change the current slide's edit or drawing history |
| Copy Edits | Copy pending edits from a static export or a stale page |
| D, then pointer input | Draw with a mouse, pen, or touch |

Editing and drawing can be enabled separately or together. Slide-edit Undo remains available after saving. Drawing keeps ink per slide. Enable Remember in the drawing toolbar to retain ink across reloads in this browser, or set `drawing({ persist: true })` as the default. The browser remembers your toolbar choice. Export SVG downloads the current slide's ink as a transparent SVG. Browser storage does not sync drawings between devices.

Visual editing maps text changes in Markdown headings, paragraphs and list items, moves of Markdown headings, and changes to raw HTML and SVG elements. When a change cannot be mapped to Markdown, the editor reports it before saving. Undo that change to use Slide Markdown. Markdown table cells, and layout changes to Markdown blocks other than headings, require Slide Markdown.

Saving a directive that affects other slides also updates those slides when they have no unsaved edits. Slides with unsaved edits keep those edits and update after saving or returning to their saved text. Deck CSS changes and adding or removing an image background show a reload notice. Save or copy pending edits before reloading.

Source loading and saving require `dev`. A static export is the output directory served without `dev`. It supports visual changes and Copy Edits. When an edit cannot be mapped safely to source, use Slide Markdown. External source changes never overwrite pending browser edits automatically.

## Insert images and organize slides

In the local editor, choose Insert Image or drop an image onto the slide. Save pending edits on that slide first. Xarp accepts PNG, JPEG, GIF, and WebP files up to 8 MiB, stores them under `assets/xarp/` next to the Markdown, and saves the insertion through the ordinary source editor. Undo removes the insertion from the slide. Uploaded files remain available for Redo and are copied into builds, including builds with an explicit `assets` list.

The Slides panel supports dragging or arrow buttons to reorder, plus Add after, Duplicate, and Delete. Operations save immediately and reload the deck. Save pending edits and export and clear drawing ink first. Undo arrangement and Redo arrangement use history held by the running local server. Arrangement history is available while the source bytes match its current snapshot. Restarting the server clears it. If an arrangement saves but fails to rebuild, open Slides and use the available Undo or Redo arrangement action to restore the previous source.

The first structural edit assigns markers to slides that lack them. Existing markers keep their IDs. Configured `slides` selections must be organized in the source deck. With fixed `sections` counts, reordering is available and section boundaries stay at their configured positions. Adding, duplicating, or deleting slides requires updating that configuration separately.

Remembered drawings belong to the browser origin, URL path, and source project. Explicit slide markers let drawings survive source revisions. Without markers, stored drawings apply only to the source revision that created them, preventing ink from appearing on a different slide after reordering. Moving the source project or changing the preview URL can change the storage namespace. Export SVG provides a file you can keep independently of browser storage. Only SVG paths and supported drawing attributes are restored.

## Configure the build

Paths in a configuration file are relative to that file. A CLI input argument overrides its `input` setting. Use `--config path/to/config.mjs`, `--output directory`, or `--port 4175` to select a configuration, output location, or preview port.

| Option | Default | Purpose |
| --- | --- | --- |
| `input` | `slides.md` in the CLI | Markdown source file |
| `output` | `dist` | Output directory inside the project |
| `theme` | Source theme, otherwise `chao-ui` | Bundled Marp theme name or project-relative CSS file |
| `colorScheme` | Source palette, otherwise the theme's own colors | Deck-wide color palette |
| `slides` | All slides | Ordered list of explicit slide IDs |
| `sections` | None | Bottom progress navigation as `{ label, count }` entries |
| `assets` | Adjacent `assets/`, when present | Project-relative paths to copy |
| `plugins` | None | Browser features to include |
| `narration` | None | Build and TTS synthesis options for narrated decks (kept out of browser metadata) |

Section counts must sum to the number of selected slides. Named selection uses markers such as `<!-- slide: introduction -->` at the start of a slide. Ordinary decks need no markers. Duplicate IDs and unknown selected IDs fail the build.

An explicit `theme` overrides the source theme. Xarp bundles `chao-ui` and supports Marp's `default`, `gaia`, and `uncover` themes. A custom CSS theme needs an `@theme` declaration and can import `chao-ui`. Add `class: pf-slide` in the deck when a custom theme uses chao-ui's slide classes.

Explicit `assets` replace the adjacent-directory default and preserve project-relative paths. Keep asset references relative to the output root. Output must be empty or already owned by Xarp, and cannot contain the source. Symlinks that leave the project are rejected.

### Choose colors and visual styles

Set the theme and visual scheme independently in the Markdown front matter. This example pairs Gaia's layout and type with an indigo woodblock background and gold accents.

```yaml
---
theme: gaia
colorScheme: ukiyo-e
---
```

Choose from five curated families of visual schemes (or `default` for the theme's own colors):

- **Core · Ink & Print**: `sumi-e` (Japanese *Gasenshi* paper and *ai-boku* blue-black Zen ink), `shuimo` (white *Sheng Xuan* `白宣` ink-wash), `manga` (stark white board, 45° halftone screentones, G-pen panel border, and peripheral speedlines), `han-rubbing` (Wujin pine-soot stone-relief rubbing `汉画像石拓`), `song-scroll` (Northern Song *Xuanhe* silk handscroll `宣和装`), and `qinglu` (Song woven silk, azurite, and malachite).
- **Japanese Wagara & Craft**: `washi` (*kozo* paper and *Seigaiha* waves `青海波`), `shippo` (Seven-Treasures overlapping circles `七宝つなぎ`), `kikko` (hexagonal samurai tortoiseshell & *Kagome* weave `亀甲・籠目`), `yagasuri` (arrow-feather weave `矢絣`), `edo` (woodblock buff and *Edo-murasaki* purple), `hanami` (sakura and *Asanoha* hemp-leaf `麻の葉`), `kimono`, `wabi-sabi` (celadon matcha and Uji moss), `japandi`, `ukiyo-e` (Prussian night and gold), and `urushi` (black lacquer and 24k *maki-e* gold).
- **Wood Mosaic, Kumiko & Mosque**: `yosegi` (Hakone wood mosaic marquetry `箱根寄木細工`), `kumiko` (unpainted *Hinoki* *Asanoha* lattice joinery `組子細工`), `zellij` (Alhambra/Fez 8-pointed star & cross glazed mosaic), and `isfahan` (Safavid lapis-lazuli dome with 12-pointed turquoise & gold *Shamsa* rosettes).
- **World Art History**: `sahara` (Tassili cave ochre sandstone), `egypt` (papyrus fresco and tomb block-band), `maya` (*amate* bark codex and Maya blue), `mughal` (*wasli* lapis and 24k *jadval* miniature), `wayang` (oil-lamp *kelir* shadow screen), `starry` (impasto cobalt night and giltwood frame), `scream` (expressionist fjord sunset), and `nitrate` (1922 35mm silver-nitrate silent film).
- **Analog & Digital**: `blueprint` (gridded cyanotype), `oscilloscope` (1950s P1 emerald phosphor CRT graticule), `pixel-8bit` (1980s Famicom arcade scanlines), `win2000` (classic beveled desktop UI), `vaporwave` (outrun sunset grid and VHS chroma), and `code-art` (OLED generative SVG studio).

For a one-off build, run `npx xarp build --theme gaia --color-scheme ukiyo-e`. Both flags also work with `xarp dev` and override the corresponding configuration options.

Press **E** and use **Colors** (or press **C** in Edit Mode) to cycle schemes across the deck. Append `?colorScheme=shuimo` to preview a scheme in the current tab. To save a scheme for everyone in the local editor, add a global directive such as `<!-- colorScheme: shuimo -->` in **Slide Markdown** and choose **Save Source**. The last such directive takes precedence over front matter. A `colorScheme` in `xarp.config.mjs` overrides both.

Add `colorSchemes()` from `@chaoxu/xarp/plugins` to the deck's plugins to show **Colors** and enable the **C** shortcut for viewers of the exported HTML. The picker remembers a viewer's choice for that deck in their browser, syncs `data-xarp-color-scheme` onto same-origin `<iframe>` slide embeds, and dispatches `xarp-color-scheme-change` on `window`. Choose **Deck default** to follow the author's setting again, or use `colorSchemes({ persist: false })` for a session-only preview.

Custom themes can use `var(--pf-bg)`, `var(--pf-fg)`, `var(--pf-accent)`, and `var(--pf-surface)` for the canvas, text, headings, and panels. Explicit CSS colors and images keep their authored appearance.

### Narrate and watch as a webpage video

Add `narration()` from `@chaoxu/xarp/plugins` to turn the live HTML deck into a scrubbable video-style player synced to per-beat audio clips, without rendering an MP4.

Write beats as Markdown comments inside each slide:

```markdown
# Reveal a proof

For $a, b \geq 0$:

* $(a - b)^2 \geq 0$
* $(a + b)^2 \geq 4ab$

<!-- narration:
- Start from two nonnegative numbers a and b.
- Any real square is nonnegative.
- Adding four a b bounds the squared sum from below.
  tts: Adding four A B bounds the squared sum from below.
  pause: 0.4
-->
```

Single beats also work inline with `<!-- beat: Explain this step. -->`, silent holds with `<!-- narration: silent 2.0 -->`, and custom recorded snippets with `audio: path/to/clip.m4a` inside a beat block. For slides hosting a `chao-ui` `Stage.mount(...)` animation, set `seg: 2` to select a stage segment independently of Marp fragment `step`, and `fit: true` to stretch `[seg.from, seg.to]` over the beat's spoken duration; consecutive beats sharing the same segment advance continuously without resetting. Beats can also drive crisp vector camera moves and focus frames directly on the live slide (`zoom: 1.45 @ 75, 42` or `zoom: 1.45` + `focus: 75, 42`, and `spotlight: 50, 14, 46, 70`), returning smoothly to `1.0×` on subsequent beats. Ordinary speaker notes without `narration:` or `beat:` stay presenter-only.

Configure viewer defaults on `narration()` and synthesis options on top-level `narration` in `xarp.config.mjs` (browser `#xarp-meta` receives only `{ captions, sidebar, cues }`, never TTS endpoints, commands, or glossaries):

```js
import { editing, drawing, colorSchemes, narration } from '@chaoxu/xarp/plugins';

export default {
  input: 'slides.md',
  plugins: [editing(), drawing(), colorSchemes(), narration()],
  narration: {
    glossary: { KaTeX: 'Kay-tech' },
    tts: {
      speed: 0.95, // pass endpoint at synthesis time via XARP_TTS_URL or --tts-url
    },
  },
};
```

Synthesize audio clips, lint beat alignment, and build the presentation:

```sh
XARP_TTS_URL=https://tts.example/api/tts npx xarp narrate
npx xarp narrate --only welcome,proof
npx xarp narrate --check
npx xarp narrate --prune
```

`narrate` stores content-addressed clips under `narration/clips/` (`narration/cache.json`) using an environment-independent clip hash, so subsequent `npx xarp build` or CI builds resolve cached clips without `XARP_TTS_URL` set. Editing one sentence regenerates only that beat's clip; reordering slides, editing slide layout or CSS (`npx xarp build`), or building a subset `slides` view reuses existing clips without calling TTS. `npx xarp narrate --check` validates fragment step counts, custom audio paths, and cached clip coverage without calling TTS. When `ffmpeg` is installed, clips are trimmed and loudness-normalized (`-16 LUFS` AAC `.m4a`). Optional `tts.verify` (`url` or `command`) runs an ASR transcript edit-rate check and retries bad draws automatically.

Open `?watch=1` (or press **W** in the deck) to enter Watch Mode:

| Control | Behavior |
| --- | --- |
| Space or K | Play or pause |
| ← / → | Seek backward or forward 5 seconds (hold Shift to step beats) |
| J / L or `[` / `]` | Previous or next beat |
| Click a transcript line or chapter | Seek to that timestamp and play |
| Speed (`0.75×`–`2×`) | Pitch-preserved playback speed |
| `+` / `-` / `0` or `Alt+scroll` | Zoom in, zoom out, or reset camera on the live vector slide |
| M / V / T / F | Mute audio, toggle captions, toggle sidebar, or enter fullscreen |
| S / C / D | Switch visual schemes live or pause to draw on the frame |

In `npx xarp dev`, Watch Mode also exposes **Synthesize slide** to update the current slide's audio directly from the browser.

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
