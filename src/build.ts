import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import { engineOptions } from './engine.js';
import { hash, parseSource, requireValue, selectedMarkdown, selectSlides } from './source.js';
import { containedFile, copyTree, isWithin, outputIsOwned, pathExists } from './files.js';
import { contentSectionSelector } from './slide-dom.js';
import type { BuildOptions, BuildResult, EditorMetadata, Plugin, Section } from './types.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const themeRoot = join(packageRoot, 'themes/chao-ui');
const browserRoot = fileURLToPath(new URL('./browser/', import.meta.url));
const packageInfo = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { version: string };

export async function resolveProject(options: BuildOptions) {
  requireValue(typeof options.input === 'string' && options.input.length > 0, 'Choose a Markdown input file');
  const cwd = await realpath(resolve(options.cwd ?? process.cwd()));
  const input = await containedFile(cwd, options.input);
  requireValue((await lstat(input)).isFile() && /\.md$/i.test(input), 'The input must be a Markdown file');
  let output = resolve(cwd, options.output ?? 'dist');
  requireValue(output !== cwd && !isWithin(output, input), 'Output must not contain the input or replace the project directory');
  requireValue(isWithin(cwd, output), 'The output directory must be inside the project');
  // Check existing ancestors before making directories through them.
  let ancestor = dirname(output);
  while (!await pathExists(ancestor)) ancestor = dirname(ancestor);
  const canonicalAncestor = await realpath(ancestor);
  requireValue(isWithin(cwd, canonicalAncestor), 'Output symlink is outside the project');
  output = resolve(canonicalAncestor, relative(ancestor, output));
  requireValue(output !== cwd && !isWithin(output, input), 'Output must not contain the input or replace the project directory');
  requireValue(await outputIsOwned(output), 'Output is not an empty directory or an existing Xarp build');
  const sourceFile = relative(cwd, input).split('\\').join('/');
  const viewId = basename(input, '.md').replace(/[^a-zA-Z0-9_-]/g, '-') || 'deck';
  return { cwd, input, output, sourceFile, viewId };
}

function validateSections(sections: Section[] | undefined, count: number) {
  if (!sections) return;
  requireValue(Array.isArray(sections) && sections.length > 0, 'Sections must be a nonempty array');
  for (const section of sections) {
    requireValue(typeof section.label === 'string' && section.label.trim().length > 0, 'Every section needs a label');
    requireValue(Number.isSafeInteger(section.count) && section.count > 0, 'Section counts must be positive integers');
  }
  requireValue(sections.reduce((sum, section) => sum + section.count, 0) === count, 'Section counts must sum to the selected slide count');
}

function validatePlugins(plugins: Plugin[]) {
  const names = new Set<string>();
  for (const plugin of plugins) {
    requireValue(/^[a-z][a-z0-9-]*$/.test(plugin.name), 'Plugin names must use lowercase letters, digits and hyphens');
    requireValue(!names.has(plugin.name), `Duplicate plugin: ${plugin.name}`);
    names.add(plugin.name);
    JSON.stringify(plugin.data); // Fail early for cyclic data and unsupported values.
    for (const url of [...plugin.styles ?? [], ...plugin.scripts ?? []]) {
      requireValue(url instanceof URL && url.protocol === 'file:', `Plugin ${plugin.name} needs local file URLs`);
    }
  }
}

async function stagePluginAssets(plugins: Plugin[], stage: string) {
  const byUrl = new Map<string, string>();
  const destinations = new Map<string, string>();
  const scripts: string[] = [], styles: string[] = [], fingerprint: [string, string][] = [];
  const data: Record<string, unknown> = Object.create(null);
  for (const plugin of plugins) {
    data[plugin.name] = plugin.data ?? null;
    for (const [urls, list] of [[plugin.styles ?? [], styles], [plugin.scripts ?? [], scripts]] as const) {
      for (const url of urls) {
        let target = byUrl.get(url.href);
        if (!target) {
          const source = fileURLToPath(url);
          target = `_xarp/plugins/${basename(source)}`;
          requireValue(!destinations.has(target), `Plugin asset collision: ${target}`);
          destinations.set(target, url.href);
          byUrl.set(url.href, target);
          await mkdir(dirname(join(stage, target)), { recursive: true });
          await copyFile(source, join(stage, target));
          fingerprint.push([target, hash(await readFile(source))]);
        }
        if (!list.includes(target)) list.push(target);
      }
    }
  }
  if (scripts.length || styles.length) await copyFile(join(browserRoot, 'LICENSES.txt'), join(stage, '_xarp/plugins/LICENSES.txt'));
  return { scripts, styles, data, fingerprint };
}

async function stageProjectAssets(options: BuildOptions, project: Awaited<ReturnType<typeof resolveProject>>, stage: string) {
  const adjacent = join(dirname(project.input), 'assets');
  const entries = options.assets ?? (await pathExists(adjacent) ? [relative(project.cwd, adjacent)] : []);
  requireValue(Array.isArray(entries), 'Assets must be an array of project-relative paths');
  const targets = new Set<string>();
  for (const entry of entries) {
    requireValue(typeof entry === 'string' && entry.length > 0, 'Invalid asset path');
    const source = await containedFile(project.cwd, entry);
    const target = options.assets === undefined ? 'assets' : relative(project.cwd, resolve(project.cwd, entry)).split('\\').join('/');
    requireValue(target !== '' && !target.startsWith('_xarp/') && target !== '_xarp' && !target.startsWith('.') && target !== 'index.html' && target !== 'input.md', `Reserved asset path: ${entry}`);
    requireValue(!isWithin(source, project.output) && !isWithin(project.output, source), 'Assets must not include the output directory');
    requireValue(!targets.has(target), `Duplicate asset path: ${entry}`);
    targets.add(target);
    await copyTree(source, join(stage, target), project.cwd);
  }
}

/** Build a portable HTML presentation. The returned paths are local to the caller. */
export async function build(options: BuildOptions): Promise<BuildResult> {
  const project = await resolveProject(options);
  const original = await readFile(project.input, 'utf8');
  const document = parseSource(original);
  const selected = selectSlides(document, options.slides);
  validateSections(options.sections, selected.length);
  const plugins = options.plugins ?? [];
  validatePlugins(plugins);
  const requestedTheme = options.theme ?? document.theme ?? 'chao-ui';
  requireValue(typeof requestedTheme === 'string' && requestedTheme.length > 0, 'Choose a theme name or CSS file');
  let theme = requestedTheme;
  let customTheme: string | undefined;
  if (/\.css$/i.test(requestedTheme)) {
    customTheme = await containedFile(project.cwd, requestedTheme);
    theme = (await readFile(customTheme, 'utf8')).match(/@theme\s+([^\s*]+)/)?.[1] ?? '';
    requireValue(theme, 'A custom theme needs an @theme name');
  } else {
    requireValue(['chao-ui', 'default', 'gaia', 'uncover'].includes(theme), `Unknown theme: ${theme}. Supply its CSS file as the theme option.`);
  }
  await mkdir(dirname(project.output), { recursive: true });
  const stage = await mkdtemp(join(dirname(project.output), '.xarp-build-'));
  try {
    await mkdir(join(stage, '_xarp'), { recursive: true });
    await copyFile(join(browserRoot, 'RENDERER-LICENSES.txt'), join(stage, '_xarp/RENDERER-LICENSES.txt'));
    await cp(themeRoot, join(stage, '_xarp/theme'), { recursive: true });
    await stageProjectAssets(options, project, stage);
    const assets = await stagePluginAssets(plugins, stage);
    const markdown = selectedMarkdown(document, options.slides);
    // Marp's file discovery excludes dotfiles, even when explicitly supplied.
    const input = join(stage, 'input.md');
    const htmlPath = join(stage, 'index.html');
    const configPath = join(stage, '.marp.json');
    await writeFile(input, markdown);
    await writeFile(configPath, JSON.stringify({ options: engineOptions }));
    const cliRoot = dirname(require.resolve('@marp-team/marp-cli/package.json'));
    const args = [join(cliRoot, 'marp-cli.js'), input, '--output', htmlPath, '--html', '--config-file', configPath,
      '--engine', fileURLToPath(new URL('./engine.js', import.meta.url)),
      '--theme-set', join(themeRoot, 'slides.css'), ...(customTheme ? [customTheme] : []), '--theme', theme,
      ...(options.sections ? ['--bespoke.osc=false'] : [])];
    const rendering = run(process.execPath, args, { cwd: project.cwd, maxBuffer: 4 * 1024 * 1024 });
    rendering.child.stdin?.end();
    await rendering;
    const $ = load(await readFile(htmlPath, 'utf8'));
    const svgSlides = $('svg[data-marpit-svg]');
    // SVG foreignObject retains mixed case in parse5, unlike HTML selectors.
    const sections = svgSlides.children().children(contentSectionSelector);
    const editingError = document.editingError ?? (svgSlides.length !== selected.length || sections.length !== selected.length ? 'Rendered slides do not match source boundaries. Source editing is disabled.' : undefined);
    if (options.slides || options.sections) requireValue(!editingError, editingError ?? 'Slide mapping failed');
    if (theme === 'chao-ui') sections.addClass('pf-slide');
    $('head').append('<link rel="stylesheet" href="_xarp/theme/theme.css">');
    if (options.sections) {
      sections.addClass('xarp-sectioned');
      await copyFile(join(browserRoot, 'sections.css'), join(stage, '_xarp/sections.css'));
      $('head').append('<link rel="stylesheet" href="_xarp/sections.css">');
      sections.each((index, element) => {
        const nav = $('<nav class="xarp-section-nav" data-xarp-navigation aria-label="Presentation sections"></nav>');
        let start = 0;
        for (const section of options.sections!) {
          const end = start + section.count;
          const state = index < start ? 'upcoming' : index >= end ? 'completed' : 'current';
          const link = $('<a></a>').attr('href', `#${start + 1}`).attr('title', section.label).addClass(`section-${state}`);
          if (state === 'current') link.attr('aria-current', 'step');
          link.append($('<span></span>').text(section.label));
          const track = $('<span class="section-track" aria-hidden="true"><span></span></span>');
          track.children().attr('style', `width:${Math.max(0, Math.min(1, (index - start + 1) / section.count)) * 100}%`);
          link.append(track); nav.append(link); start = end;
        }
        $(element).append(nav);
      });
    }
    const buildRevision = hash(JSON.stringify({
      source: document.revision, version: packageInfo.version, theme,
      themeBytes: hash(await readFile(customTheme ?? join(themeRoot, 'slides.css'))),
      themeSnapshot: hash(await readFile(join(themeRoot, 'upstream.json'))),
      slides: options.slides, sections: options.sections, plugins: assets.data, files: assets.fingerprint,
    }));
    const metadata: EditorMetadata = {
      viewId: project.viewId, sourceFile: project.sourceFile, sourceRevision: document.revision,
      buildRevision, slides: selected.map(slide => slide.id), editable: !editingError, ...(editingError ? { editingError } : {}),
    };
    for (const path of assets.styles) $('head').append($('<link rel="stylesheet">').attr('href', path));
    const json = JSON.stringify({ ...metadata, plugins: assets.data }).replace(/</g, '\\u003c');
    $('body').append(`<script id="xarp-meta" type="application/json">${json}</script>`);
    for (const path of assets.scripts) $('body').append($('<script defer></script>').attr('src', path));
    await writeFile(htmlPath, $.html());
    await writeFile(join(stage, '.xarp-build.json'), JSON.stringify({ generator: '@chaoxu/xarp', version: packageInfo.version, buildRevision }) + '\n');
    await rm(input); await rm(configPath);
    requireValue(await readFile(project.input, 'utf8') === original, 'Source changed during the build. Build again.');
    requireValue(await outputIsOwned(project.output), 'Output changed during the build');
    const backup = join(dirname(project.output), `.xarp-old-${randomUUID()}`);
    const exists = await pathExists(project.output);
    if (exists) await rename(project.output, backup);
    try { await rename(stage, project.output); }
    catch (error) { if (exists) await rename(backup, project.output); throw error; }
    if (exists) await rm(backup, { recursive: true, force: true });
    return { output: project.output, htmlPath: join(project.output, 'index.html'), metadata };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
