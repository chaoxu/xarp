# Xarp demo

A self-guided slide deck with visual editing, drawing, and an example browser plugin. All prose, figures, and exercises are synthetic. The demo uses the published Xarp package, independently of the library checkout.

Open the [full demo](https://talk.chaoxu.prof/xarp/) or the [short tour](https://talk.chaoxu.prof/xarp/quick.html).

## Run locally

Install Node.js 24 or 26, then run these commands in this directory:

```sh
npm ci
npm run dev
```

Open the loopback URL printed by Xarp. Press **E** to edit or **D** to draw. **Save Slide** writes supported edits to `slides.md` and rebuilds. Editing `slides.md` in a text editor also triggers a preview rebuild. Unsaved browser edits are preserved until you choose how to handle the changed source.

`npm run dev:quick` opens the short tour on port 4176. Both previews use the same source, so run one at a time while saving edits.

## Build and share

```sh
npm run build
```

The full deck is `dist/index.html`, and the short tour is `dist/quick.html`. Serve the whole `dist/` directory to retain fonts, figures, and browser scripts. The short tour selects explicit slide IDs through `xarp.quick.config.mjs`. Its HTML uses the same assets as the full deck.

A static copy supports visual edits and **Copy Edits**. Source loading and saving require the local preview. Ink stays with each slide for the current page session and is discarded on reload. The curve control changes only the example's browser state.

## Exercises

| Section | Examples to try |
| --- | --- |
| Create | Markdown, KaTeX mathematics, tagged Chinese typography, highlighted code, SVG backgrounds |
| Edit | Text changes, undo after saving, box movement and resizing, keyboard nudges, Reset Box, SVG labels, Slide Markdown |
| Draw | Pen colors, Undo, Redo, Clear slide, ink retained across slide navigation, a blank drawing surface |
| Present | Section navigation, progressive fragments, presenter notes, fullscreen, portable assets |
| Extend | A keyboard-accessible curve slider, plugin scripts and data, a custom theme importing `chao-ui`, a short tour selected by slide ID |

The curve is an example plugin in `plugins/`, rather than a built-in plotting feature. It uses native input events and calculates its SVG path on load and when the input changes. The initial curve is also present in the source as a static fallback.

The editable layout examples use raw HTML and SVG. Markdown table cells use **Slide Markdown**. Some structural and deck-wide CSS changes require a reload, which Xarp reports before you discard pending edits.

## Reuse

Edit `slides.md` for content, `showcase.css` for this deck's layout, and `xarp.config.mjs` for plugins and section counts. The section counts must match the selected slides. Keep the `slide:` markers if you use the short tour.

For a smaller starting point, use the [basic example](../basic/). Xarp's source and examples are MIT licensed. The generated bundle carries the notices for its dependencies and fonts.
