import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { build } from '../lib/index.js';
import { editing, drawing, colorSchemes } from '../lib/plugins/index.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function project(markdown = '# First\n\n---\n\n# Second\n') {
  const cwd = await mkdtemp(join(tmpdir(), 'xarp-build-test-')); directories.push(cwd);
  await writeFile(join(cwd, 'slides.md'), markdown);
  return { cwd, input: 'slides.md' };
}

test('plain Markdown renders without plugins, markers or source mutation', async () => {
  const config = await project('<!-- _class: custom -->\n# First\n\nMath $x^2$.\n');
  const before = await readFile(join(config.cwd, config.input), 'utf8');
  const result = await build(config);
  const html = await readFile(result.htmlPath, 'utf8'), $ = load(html);
  expect($('svg[data-marpit-svg]')).toHaveLength(1);
  expect($('section').attr('class')).toContain('custom');
  expect($('section').hasClass('pf-slide')).toBe(true);
  expect($('.katex')).toHaveLength(1);
  expect($('script[src]')).toHaveLength(0);
  expect(html).not.toContain(config.cwd);
  expect(result.metadata.slides).toEqual(['slide-1']);
  expect(await readFile(join(config.cwd, config.input), 'utf8')).toBe(before);
});

test('plugin combinations emit ordered, deduplicated assets and escaped data', async () => {
  const config = await project();
  for (const plugins of [[drawing()], [editing()], [editing(), drawing()], [drawing(), editing()]]) {
    const result = await build({ ...config, plugins });
    const $ = load(await readFile(result.htmlPath, 'utf8'));
    const scripts = $('script[src]').map((_, element) => $(element).attr('src')).get();
    expect(scripts.filter(path => path.endsWith('/history.js'))).toHaveLength(1);
    expect(scripts[0]).toBe('_xarp/plugins/history.js');
    for (const path of scripts) expect((await readFile(join(result.output, path))).length).toBeGreaterThan(0);
    expect(scripts.some(path => path.endsWith('/moveable.js'))).toBe(plugins.some(plugin => plugin.name === 'editing'));
    expect($('script[src][defer]')).toHaveLength(scripts.length);
  }
  const result = await build({ ...config, plugins: [{ name: 'data', data: '</script><script>alert(1)</script>' }] });
  const $ = load(await readFile(result.htmlPath, 'utf8'));
  expect(JSON.parse($('#xarp-meta').text()).plugins.data).toBe('</script><script>alert(1)</script>');
  expect($('script').filter((_, node) => $(node).text() === 'alert(1)')).toHaveLength(0);
}, 15000);

test('theme options override front matter and custom themes import the bundled theme', async () => {
  const config = await project('---\ntheme: gaia\n---\n# Theme\n');
  expect(load(await readFile((await build(config)).htmlPath, 'utf8'))('section').hasClass('pf-slide')).toBe(false);
  expect(load(await readFile((await build({ ...config, theme: 'chao-ui' })).htmlPath, 'utf8'))('section').hasClass('pf-slide')).toBe(true);
  await writeFile(join(config.cwd, 'custom.css'), "/* @theme custom */\n@import 'chao-ui';\nsection { --test-theme: custom; }\n");
  const html = await readFile((await build({ ...config, theme: 'custom.css' })).htmlPath, 'utf8');
  expect(/--test-theme:\s*custom/.test(html)).toBe(true);
  await expect(build({ ...config, theme: 'missing' })).rejects.toThrow('Unknown theme: missing');
}, 15000);

test('color schemes compose with themes and work offline without the picker', async () => {
  const config = await project('---\ntheme: gaia\ncolorScheme: hanami\n---\n# Palette\n');
  const authored = await build(config);
  const html = load(await readFile(authored.htmlPath, 'utf8'));
  expect(html('html').attr('data-xarp-color-scheme')).toBe('hanami');
  expect(html('section').hasClass('pf-slide')).toBe(false);
  expect(html('script[src]')).toHaveLength(0);
  expect(await readFile(join(authored.output, '_xarp/palettes.css'), 'utf8')).toContain('--xarp-paper');

  const override = await build({ ...config, colorScheme: 'ukiyo-e' });
  expect(override.metadata.buildRevision).not.toBe(authored.metadata.buildRevision);
  expect(load(await readFile(override.htmlPath, 'utf8'))('html').attr('data-xarp-color-scheme')).toBe('ukiyo-e');
  const withPicker = await build({ ...config, theme: 'chao-ui', colorScheme: 'default', plugins: [colorSchemes(), editing()] });
  const interactive = load(await readFile(withPicker.htmlPath, 'utf8'));
  expect(interactive('html').attr('data-xarp-color-scheme')).toBeUndefined();
  expect(interactive('section').hasClass('pf-slide')).toBe(true);
  expect(interactive('script[src$="/color-schemes.js"]')).toHaveLength(1);
  await expect(build({ ...config, colorScheme: 'unknown' as never })).rejects.toThrow('Unknown color scheme');
  expect(await readFile(withPicker.htmlPath, 'utf8')).toContain('Palette');
}, 15000);

test('named selection and section progress use the selected order', async () => {
  const config = await project('<!-- slide: first -->\n# First\n\n---\n\n<!-- slide: second -->\n# Second\n');
  const result = await build({ ...config, slides: ['second', 'first'], sections: [{ label: 'Intro', count: 1 }, { label: 'Details', count: 1 }] });
  const $ = load(await readFile(result.htmlPath, 'utf8'));
  expect($('section h1').map((_, node) => $(node).text()).get()).toEqual(['Second', 'First']);
  expect($('[data-xarp-navigation]')).toHaveLength(2);
  expect($('[aria-current=step]').map((_, node) => $(node).attr('href')).get()).toEqual(['#1', '#2']);
  await expect(build({ ...config, sections: [{ label: 'Wrong', count: 1 }] })).rejects.toThrow('sum');
});

test('background layers do not duplicate section navigation or shift slide indexes', async () => {
  const config = await project('![bg](assets/bg.svg)\n\n# First\n\n---\n\n# Second\n');
  await mkdir(join(config.cwd, 'assets'));
  await writeFile(join(config.cwd, 'assets/bg.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="white"/></svg>');
  const result = await build({ ...config, sections: [{ label: 'First', count: 1 }, { label: 'Second', count: 1 }] });
  const $ = load(await readFile(result.htmlPath, 'utf8'));
  expect($('svg[data-marpit-svg]')).toHaveLength(2);
  expect($('section')).toHaveLength(4);
  expect($('[data-xarp-navigation]')).toHaveLength(2);
  expect($('[aria-current=step]').map((_, node) => $(node).attr('href')).get()).toEqual(['#1', '#2']);
  expect($('section[data-marpit-advanced-background=background] nav')).toHaveLength(0);
});

test('headers and footers keep editing and section navigation available', async () => {
  const config = await project('---\nheader: Header\nfooter: Footer\n---\n\n# First\n\n---\n\n# Second\n');
  const result = await build({ ...config, plugins: [editing()], sections: [{ label: 'All', count: 2 }] });
  const $ = load(await readFile(result.htmlPath, 'utf8'));
  expect(result.metadata.editable).toBe(true);
  expect($('[data-xarp-navigation]')).toHaveLength(2);
  expect($('section header')).toHaveLength(2);
  expect($('section footer')).toHaveLength(2);
});

test('assets keep public paths and reject escaping symlinks', async () => {
  const config = await project();
  await mkdir(join(config.cwd, 'assets'));
  await writeFile(join(config.cwd, 'assets/picture.svg'), '<svg/>');
  const result = await build(config);
  expect(await readFile(join(result.output, 'assets/picture.svg'), 'utf8')).toBe('<svg/>');
  await mkdir(join(config.cwd, 'images'));
  await writeFile(join(config.cwd, 'images/other.svg'), '<svg/>');
  const explicit = await build({ ...config, assets: ['images'] });
  expect(await readFile(join(explicit.output, 'images/other.svg'), 'utf8')).toBe('<svg/>');
  await expect(readFile(join(explicit.output, 'assets/picture.svg'))).rejects.toThrow();
  const outside = await project();
  await symlink(join(outside.cwd, 'slides.md'), join(config.cwd, 'assets/escape'));
  await expect(build(config)).rejects.toThrow('outside the project');
  expect(await readFile(explicit.htmlPath, 'utf8')).toContain('First');
  await expect(build({ ...config, assets: ['dist'] })).rejects.toThrow('output directory');
  await writeFile(join(config.cwd, 'input.md'), 'Asset must not become temporary renderer input');
  await expect(build({ ...config, assets: ['input.md'] })).rejects.toThrow('Reserved asset path');
});

test('unowned output and source-containing output are preserved', async () => {
  const config = await project();
  await mkdir(join(config.cwd, 'dist'));
  await writeFile(join(config.cwd, 'dist/important'), 'keep');
  await expect(build(config)).rejects.toThrow('not an empty directory');
  expect(await readFile(join(config.cwd, 'dist/important'), 'utf8')).toBe('keep');
  await expect(build({ ...config, output: '.' })).rejects.toThrow('must not contain');
  await expect(build({ ...config, output: '../elsewhere' })).rejects.toThrow('inside the project');
});

test('an internal symlink cannot hide an output directory containing the source', async () => {
  const config = await project();
  await mkdir(join(config.cwd, 'owned'));
  await writeFile(join(config.cwd, 'owned/slides.md'), '# Keep this source');
  await writeFile(join(config.cwd, 'owned/.xarp-build.json'), JSON.stringify({ generator: '@chaoxu/xarp' }));
  await symlink(config.cwd, join(config.cwd, 'alias'));
  await expect(build({ ...config, input: 'owned/slides.md', output: 'alias/owned' })).rejects.toThrow('must not contain');
  expect(await readFile(join(config.cwd, 'owned/slides.md'), 'utf8')).toBe('# Keep this source');
});

test('conflicting plugin names and asset destinations fail', async () => {
  const config = await project();
  await expect(build({ ...config, plugins: [drawing(), drawing()] })).rejects.toThrow('Duplicate plugin');
  for (const path of ['a', 'b']) {
    await mkdir(join(config.cwd, path)); await writeFile(join(config.cwd, path, 'same.js'), '');
  }
  await expect(build({ ...config, plugins: ['a', 'b'].map(name => ({ name, scripts: [pathToFileURL(join(config.cwd, name, 'same.js'))] })) })).rejects.toThrow('collision');
});
