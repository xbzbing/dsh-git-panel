/**
 * html-pack: the HTML preview document builder. Locks the reference filter
 * (relative only, scheme/absolute/NUL refused), the document-relative path
 * resolution (query/fragment stripped, one decode, `.`/`..` resolved, root
 * escape refused), the all-or-nothing pack loop with its byte/count caps, the
 * pre-check that skips the parse when nothing could be referenced, the static
 * document's CSP and its doctype-first insertion, the escape-report the mask
 * waits for, and the data: URLs assets are inlined as.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isRelativeAssetReference, resolveAssetPath, packAssets, encodeText, assetDataUrl,
  createStaticHtmlDocument, looksScriptRendered, packHtmlDocument,
  withReadyPing, hasAssetReferences, HTML_READY_MESSAGE,
  inlineScriptBytes, isHeavyScriptDocument, HTML_HEAVY_SCRIPT_BYTES,
  MAX_ASSET_BYTES, MAX_TOTAL_BYTES, MAX_ASSETS,
} from '../../lib/testkit.mjs'

const DOC = 'docs/local/mock.html'

test('relative asset references pass; schemes, absolutes and fragments do not', () => {
  for (const ref of ['style.css', './a.js', '../x/y.css', 'deep/dir/z.css?v=2#frag']) {
    assert.equal(isRelativeAssetReference(ref), true, ref)
  }
  for (const ref of ['', '/abs.css', '\\abs.css', '#only-fragment', '?only-query', 'https://cdn/x.css', 'data:text/css,body{}', 'file:///etc/x.css']) {
    assert.equal(isRelativeAssetReference(ref), false, ref)
  }
  assert.equal(isRelativeAssetReference(`ava${String.fromCharCode(0)}l.css`), false, 'NUL byte')
})

test('references resolve beside the document with one decode round-trip', () => {
  assert.equal(resolveAssetPath(DOC, 'style.css'), 'docs/local/style.css')
  assert.equal(resolveAssetPath(DOC, './sub/a.js'), 'docs/local/sub/a.js')
  assert.equal(resolveAssetPath(DOC, '../assets/x.css'), 'docs/assets/x.css')
  assert.equal(resolveAssetPath(DOC, 'a/../../b.css'), 'docs/b.css')
  assert.equal(resolveAssetPath('mock.html', 'style.css'), 'style.css', 'a root-level document resolves at the root')
})

test('query and fragment suffixes are not filename components', () => {
  assert.equal(resolveAssetPath(DOC, 'style.css?v=2#frag'), 'docs/local/style.css')
})

test('percent escapes decode exactly once', () => {
  assert.equal(resolveAssetPath(DOC, 'my%20style.css'), 'docs/local/my style.css')
})

test('unusable references are refused', () => {
  assert.equal(resolveAssetPath(DOC, '../../../escape.css'), undefined, 'root escape')
  assert.equal(resolveAssetPath(DOC, 'https://cdn/x.css'), undefined, 'scheme')
  assert.equal(resolveAssetPath(DOC, '/abs.css'), undefined, 'absolute')
  assert.equal(resolveAssetPath(DOC, 'a\\b.css'), undefined, 'backslash')
  assert.equal(resolveAssetPath(DOC, '%zz.css'), undefined, 'broken percent escape')
  assert.equal(resolveAssetPath(DOC, ''), undefined, 'empty')
})

const readOf = (files) => async (path) => (Object.hasOwn(files, path) ? files[path] : null)

test('packAssets reads each reference beside the document', async () => {
  const assets = await packAssets(
    [{ kind: 'stylesheet', reference: 'style.css' }, { kind: 'script', reference: './a.js' }],
    DOC,
    readOf({ 'docs/local/style.css': 'body{color:red}', 'docs/local/a.js': 'window.x=1' }),
    0,
  )
  assert.deepEqual(assets, [
    { kind: 'stylesheet', reference: 'style.css', text: 'body{color:red}' },
    { kind: 'script', reference: './a.js', text: 'window.x=1' },
  ])
})

test('packAssets is all-or-nothing: a missing read abandons the whole pack', async () => {
  const assets = await packAssets(
    [{ kind: 'stylesheet', reference: 'style.css' }, { kind: 'stylesheet', reference: 'missing.css' }],
    DOC,
    readOf({ 'docs/local/style.css': 'body{}' }),
    0,
  )
  assert.equal(assets, null)
})

test('packAssets enforces the per-asset, total and count caps', async () => {
  const big = 'x'.repeat(MAX_ASSET_BYTES + 1)
  assert.equal(
    await packAssets([{ kind: 'stylesheet', reference: 'big.css' }], DOC, readOf({ 'docs/local/big.css': big }), 0),
    null, 'per-asset cap',
  )
  assert.equal(
    await packAssets([{ kind: 'stylesheet', reference: 'a.css' }], DOC, readOf({ 'docs/local/a.css': 'x'.repeat(100) }), MAX_TOTAL_BYTES),
    null, 'total cap includes the page bytes already spent',
  )
  const many = Array.from({ length: MAX_ASSETS + 1 }, (_, i) => ({ kind: 'stylesheet', reference: `a${i}.css` }))
  assert.equal(await packAssets(many, DOC, readOf({}), 0), null, 'count cap')
})

test('encodeText is base64 of the UTF-8 bytes', () => {
  assert.equal(Buffer.from(encodeText('hello'), 'base64').toString('utf8'), 'hello')
  assert.equal(Buffer.from(encodeText('颜色 emoji 🎨'), 'base64').toString('utf8'), '颜色 emoji 🎨')
})

test('createStaticHtmlDocument puts the CSP at the first position the parser puts into the head', () => {
  const meta = '<meta http-equiv="Content-Security-Policy"'
  const doc = createStaticHtmlDocument('<!doctype html><html><head><title>t</title></head><body>x</body></html>')
  assert.ok(doc.startsWith(`<!doctype html>${meta}`), 'the meta follows the doctype')
  assert.ok(doc.includes("default-src 'none'"), 'network and scripts are denied')
  assert.ok(doc.includes('<html><head><title>t</title></head><body>x</body></html>'), 'the rest of the document is untouched')
  assert.ok(createStaticHtmlDocument('<html><body>x</body></html>').startsWith(meta), 'no doctype: the policy leads')
  assert.ok(createStaticHtmlDocument('<p>x</p>').startsWith(meta), 'a bare fragment gets the policy first')
  // A doctype must stay the first token: anything ahead of it puts the parser in
  // quirks mode and changes the layout.
  assert.ok(createStaticHtmlDocument('<!doctype html><p>x</p>').startsWith(`<!doctype html>${meta}`), 'doctype stays first')
  // Whitespace and comments may precede the doctype; the meta still goes after it.
  const prologue = createStaticHtmlDocument('\n<!-- banner -->\n<!doctype html><html><head></head><body>x</body></html>')
  assert.ok(prologue.startsWith(`\n<!-- banner -->\n<!doctype html>${meta}`), 'comments before the doctype keep their order')

  // The insertion point is never a matched `<head>`: a `<head>` inside
  // RCDATA/RAWTEXT or after body content would take the meta out of the head,
  // where it has no effect. These documents all keep the policy first.
  assert.ok(createStaticHtmlDocument(`<!doctype html><img src="x.png"><head></head>`).startsWith(`<!doctype html>${meta}`), 'body content before head')
  assert.ok(createStaticHtmlDocument('<!doctype html><title>&lt;<head></title><img src=x>').startsWith(`<!doctype html>${meta}`), 'a head inside a title is not a head')
  assert.ok(createStaticHtmlDocument('<!doctype html><style>/*<head>*/</style><img src=x>').startsWith(`<!doctype html>${meta}`), 'a head inside a style is not a head')
  assert.ok(createStaticHtmlDocument('<!doctype html><script>var s = "<head>"</script><body>x</body>').startsWith(`<!doctype html>${meta}`), 'a head inside a script is not a head')
})

test('looksScriptRendered separates canvas pages from authored copy', () => {
  assert.equal(looksScriptRendered('<body><div id="root"></div><script>render()</script></body>'), true, 'script-only shell')
  assert.equal(looksScriptRendered('<body><p>Hello</p><script>render()</script></body>'), true, 'tiny authored text')
  assert.equal(
    looksScriptRendered('<body><p>' + 'word '.repeat(80) + '</p><script>render()</script></body>'),
    false,
    'a styled document with real copy keeps it without scripts',
  )
  assert.equal(looksScriptRendered('<html><p>' + 'word '.repeat(80) + '</p></html>'), false, 'no body element: whole document is inspected')
  // Inline style sheets are markup, not authored copy: a canvas page carrying
  // a long <style> block is still script-rendered.
  const styled = '<body><div id="root"></div><style>' + '.c{color:#123}'.repeat(80) + '</style><script>draw()</script></body>'
  assert.equal(looksScriptRendered(styled), true, 'style bodies do not count as copy')
})

test('assetDataUrl carries the asset text as base64 under its MIME type', () => {
  const css = assetDataUrl('stylesheet', 'body{color:red}')
  assert.ok(css.startsWith('data:text/css;base64,'))
  assert.equal(Buffer.from(css.split(',')[1], 'base64').toString('utf8'), 'body{color:red}')
  const js = assetDataUrl('script', 'window.x=1')
  assert.ok(js.startsWith('data:text/javascript;base64,'))
  assert.equal(Buffer.from(js.split(',')[1], 'base64').toString('utf8'), 'window.x=1')
})

test('hasAssetReferences answers from one scan, without a DOM parse', () => {
  assert.equal(hasAssetReferences('<div class="x">hi</div>'), false)
  assert.equal(hasAssetReferences('<img alt="x">'), false)
  assert.equal(hasAssetReferences('<link rel="stylesheet" href="a.css">'), true)
  assert.equal(hasAssetReferences('<script src="a.js"></script>'), true)
  assert.equal(hasAssetReferences('<img src="a.png">'), true)
  assert.equal(hasAssetReferences('<a HREF="x.html">x</a>'), true, 'attribute names are case-insensitive')
  assert.equal(hasAssetReferences('<img data-src="x.png">'), false, 'a data- attribute is not a reference')
  assert.equal(hasAssetReferences('<script\n  src="a.js">'), true, 'any whitespace separates the attribute')
})

test('withReadyPing appends one paint report and leaves the page intact', () => {
  const page = '<!doctype html><html><body><h1>Hi</h1><script>1</script></body></html>'
  const out = withReadyPing(page)
  assert.equal(out.startsWith(page), true, 'the page text is untouched')
  assert.equal(out.slice(page.length).match(/<script>/g)?.length, 1, 'exactly one appended script')
  assert.equal(out.includes(HTML_READY_MESSAGE), true, 'posts the agreed message')
  assert.equal(out.includes('parent.postMessage'), true, 'reaches the panel')
  assert.equal(out.includes("addEventListener(\"load\""), true, 'reports after the page load')
  assert.equal(out.split('requestAnimationFrame').length - 1, 2, 'waits for the drawn frame')
  assert.equal(withReadyPing('').endsWith('</script>'), true, 'an empty document still reports')
})

test('packHtmlDocument returns null in a non-DOM runtime (no packable parse)', async () => {
  assert.equal(await packHtmlDocument('<link rel="stylesheet" href="a.css">', DOC, readOf({})), null)
})

test('inlineScriptBytes counts the script bodies a page will run', () => {
  assert.equal(inlineScriptBytes('<p>no scripts</p>'), 0)
  assert.equal(inlineScriptBytes('<script>abc</script>'), 3)
  assert.equal(inlineScriptBytes('<script type="module">abcd</script>'), 4, 'a module body runs too')
  assert.equal(inlineScriptBytes('<script type="application/json">{"a":1}</script>'), 0, 'a data block is not code')
  assert.equal(inlineScriptBytes('<script src="a.js"></script>'), 0, 'an external script has no body')
  assert.equal(
    inlineScriptBytes('<script>one</script><script>two</script>'),
    6,
    'every inline body counts'
  )
  // HTML has no escape for `</script>` inside a string literal: the parser
  // ends the body there, so the scan must too.
  assert.equal(inlineScriptBytes('<script>var s = "</script>";</script><p>after</p>'), 9)
})

test('a heavy inline-script page is detected before its frame is mounted', () => {
  const heavy = 'x'.repeat(HTML_HEAVY_SCRIPT_BYTES)
  assert.equal(isHeavyScriptDocument(`<script>${heavy}</script>`), true)
  assert.equal(inlineScriptBytes(`<script>${heavy}</script>`), HTML_HEAVY_SCRIPT_BYTES)
  assert.equal(isHeavyScriptDocument('<script>small</script>'), false)
  // The threshold is on the body alone: a page with a big external script
  // carries no inline cost, and a page whose bytes are all markup is light.
  assert.equal(isHeavyScriptDocument(`<script src="big.js"></script><p>${'y'.repeat(HTML_HEAVY_SCRIPT_BYTES)}</p>`), false)
})
