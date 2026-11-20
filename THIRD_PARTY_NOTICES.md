# Third-party notices

Xarp's original code is licensed under the [MIT license](LICENSE).

The bundled chao-ui snapshot is MIT licensed. Its [upstream record](themes/chao-ui/upstream.json) identifies the revision and copied files. Its [third-party notices](themes/chao-ui/THIRD_PARTY_NOTICES.md) and [vendor manifest](themes/chao-ui/vendor/manifest.json) identify fonts, KaTeX assets, source URLs, hashes, and their licenses. Preserve those notices when redistributing presentation output.

Browser code uses Drauu, Moveable, Travels, Mutative, Markdown-it, and KaTeX, along with their dependencies. Drauu bundles nanoevents and perfect-freehand. The package build writes their license texts to `lib/browser/LICENSES.txt`. Rendered output includes dependency notices under `_xarp/`. Marp CLI, Marp Core, and their dependencies retain the licenses distributed in their npm packages.

Content and assets authored in a consuming presentation retain their own licensing terms.
