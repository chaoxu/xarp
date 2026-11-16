# Development and release checks

Use Node.js 24 or 26 and install from `package-lock.json` with `npm ci`. Run `npm run build` before tests. The build compiles TypeScript and bundles browser dependencies with esbuild.

`npm test` checks source mapping, guarded edits, save receipts, concurrency, path containment, themes, sections, assets, and plugin ordering. `npm run test:browser` launches headless Chrome against temporary decks. `npm run test:package` installs the tarball into a separate project using production dependencies, then builds through the installed CLI and saves through the installed library.

Browser checks cover visual edits, undo after saving, Markdown fallback, stale source, drawing history, navigation, resize, pointer input, plugin combinations, offline assets, and preview updates. Programmatic pen and touch events test the browser event path. Physical tablets, Safari, and Firefox need separate verification.

Before a release, inspect `npm pack --dry-run`, the repository history, license notices, and the complete tarball. Build the synthetic example and inspect its presentation and narrow-viewport screenshots. Publish only library code, theme assets, documentation, and synthetic examples.

## Dependency audit

Xarp pins Marp CLI 4.5.1 and Marp Core 4.4.0. `npm audit --omit=dev` reports upstream advisories in this dependency tree, including KaTeX and Puppeteer's browser-download dependencies. Xarp's HTML build does not download a browser or expose those download functions, but the dependency audit is not clean.

Upgrade the maintained Marp release when its dependency tree resolves these advisories and rerun the parser, browser, and clean-package checks. Do not force npm's suggested downgrade to an obsolete Marp CLI. Treat authored HTML and JavaScript configuration as trusted code regardless of audit results.

## Update chao-ui

Run the snapshot script against a clean checkout of the public upstream repository:

```sh
node scripts/vendor-theme.mjs /path/to/chao-ui
```

The script copies the declared distributable files, records the upstream revision, and preserves the vendor manifest and licenses. Review the resulting diff, rebuild, and repeat the browser checks. Keep reusable theme changes upstream and presentation-specific CSS in the consuming project.

## Release artifacts

`npm pack` creates `chaoxu-xarp-0.1.0.tgz`. The GitHub release distributes this installable artifact. The package name inside it is `@chaoxu/xarp`. Registry publication requires npm access to that scope.
