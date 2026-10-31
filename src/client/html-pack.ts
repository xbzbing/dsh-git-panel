/**
 * HTML preview document preparation (ADR-0020).
 *
 * A `srcdoc` iframe has no URL of its own, so authored relative `css`/`js`
 * references would resolve against the GUI origin and 404. The preview has two
 * shapes:
 *
 * - **static** (opt-out): the authored bytes with a restrictive CSP inserted,
 *   rendered in a script-less sandbox. One string insertion, so a multi-megabyte
 *   document costs a few milliseconds — page scripts never run.
 * - **interactive** (default): relative scripts and stylesheets are read through
 *   the host's validated `file-content` route and inlined as `data:` URLs. One
 *   parse → attribute rewrite → serialize, then the iframe runs the page. Above
 *   {@link HTML_PACK_MAX_BYTES} the pack is skipped (the parse and the extra DOM
 *   are the expensive part); the caller then renders the plain bytes.
 *
 * Packing stays all-or-nothing: any limit trip, missing asset, or unsafe
 * reference gives the whole pack up (`null`) and the caller renders the plain
 * page bytes. A `<base href>` hands URL resolution to the browser, so packing
 * is skipped.
 */

/** One static dependency of a previewed HTML document. */
export interface AssetRef {
  readonly kind: 'script' | 'stylesheet'
  /** Authored `src`/`href` value, verbatim — the rewrite matches on it. */
  readonly reference: string
}

/** A packed asset: the authored reference plus its decoded text. */
export interface HtmlAsset extends AssetRef {
  readonly text: string
}

/** Per-asset, whole-package and asset-count caps, mirroring the official pack. */
export const MAX_ASSET_BYTES = 4 * 1024 * 1024
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024
export const MAX_ASSETS = 64

/**
 * Documents at or above this size skip asset packing even when the user turns
 * scripts on: one more parse plus a second DOM buys little next to the page
 * scripts the user already accepted, and doubles peak memory on a big file.
 */
export const HTML_PACK_MAX_BYTES = 2 * 1024 * 1024

/** Posted by a rendered page once it has painted its load, per {@link withReadyPing}. */
export const HTML_READY_MESSAGE = 'dsh-html-ready'

/**
 * Inline script bytes above which a page is treated as heavy.
 *
 * A document that carries its own megabytes of script pays for it in the
 * frame's own renderer: the page's scripts run before it paints, and a
 * script-heavy report can hold that renderer for many seconds. The preview
 * must then set the expectation up front instead of covering the panel with a
 * mask that looks like a hang.
 */
export const HTML_HEAVY_SCRIPT_BYTES = 512 * 1024

/**
 * Total bytes of inline script bodies in a document.
 *
 * A page's own scripts are the cost the preview cannot avoid, and their size
 * predicts how long the frame stays blank. The scan is a text pass, not a
 * parse: it must stay cheap enough to run on every preview.
 *
 * @param html Complete page text.
 * @returns The summed byte length of the inline `<script>` bodies.
 */
export function inlineScriptBytes(html: string): number {
  let total = 0
  const open = /<script\b[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = open.exec(html)) !== null) {
    // A `src` script has no body, and a `type` the browser will not run has
    // none worth counting.
    const tag = match[0]
    if (/\bsrc\s*=/i.test(tag)) continue
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase()
    if (type !== undefined && type !== '' && type !== 'module' && type !== 'text/javascript' && type !== 'application/javascript') continue
    const close = html.indexOf('</script', match.index + tag.length)
    if (close === -1) break
    total += close - (match.index + tag.length)
    open.lastIndex = close
  }
  return total
}

/**
 * Whether a document's own scripts make its first paint slow enough to warn
 * about before the frame is mounted.
 *
 * @param html Complete page text.
 * @returns true when the inline script weight passes {@link HTML_HEAVY_SCRIPT_BYTES}.
 */
export function isHeavyScriptDocument(html: string): boolean {
  return inlineScriptBytes(html) >= HTML_HEAVY_SCRIPT_BYTES
}

/**
 * Append the paint report the preview mask waits for. A document's own `load`
 * handler can keep its renderer busy for seconds after the frame's load event,
 * so the parent cannot trust that event alone: the page posts once two
 * animation frames after `load` have been drawn, i.e. once the handler returned
 * and the result is on screen. The parent falls back to the load event plus a
 * timeout when a page CSP blocks this script.
 *
 * @param html Complete page text.
 * @returns The page with the reporting script appended.
 */
export function withReadyPing(html: string): string {
  return `${html}<script>addEventListener("load",function(){requestAnimationFrame(function(){requestAnimationFrame(function(){try{parent.postMessage("${HTML_READY_MESSAGE}","*")}catch(e){}})})})</script>`
}

/** The restrictive policy of a static preview: no scripts, no network, no frames. */
export const STATIC_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"

/**
 * Insert the static preview's CSP directly after the document's prolog.
 *
 * Not after a `<head>` found by regex: that match can sit inside RCDATA or
 * RAWTEXT (`<title>`, `<style>`, a textarea) or after body-level content that
 * already closed the head implicitly, and a `<meta>` outside the head has no
 * effect — the authored page would then load its external images, CSS and fonts
 * as usual (sandbox="" still stops scripts, so the exposure is tracking pixels,
 * the visitor's address and requests to internal hosts).
 *
 * The parser has no such ambiguity at the very start: in the "before html"
 * insertion mode a `<meta>` creates the html/head elements and lands in the
 * head, and any authored `<head>` later is ignored while its children still go
 * there. A leading doctype must stay first (otherwise the page is parsed in
 * quirks mode), so the meta goes right after it, allowing the comments and
 * whitespace that may precede it.
 *
 * @param html Complete page text.
 * @returns The same page with the CSP meta at the first position the parser
 *          puts into the head.
 */
export function createStaticHtmlDocument(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${STATIC_CSP}">`
  const prolog = /^(?:\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i.exec(html)
  const at = prolog === null ? 0 : prolog[0].length
  return html.slice(0, at) + meta + html.slice(at)
}

/**
 * Whether this reference can be read relative to the original document,
 * never the parent application URL: non-empty, no scheme, not absolute, not
 * a fragment/query-only reference, no NUL.
 */
export function isRelativeAssetReference(reference: string): boolean {
  return reference.length > 0 && !/^(?:[a-z][a-z\d+.-]*:|[/\\#?])/i.test(reference) && !reference.includes('\0')
}

/**
 * Resolve one authored reference to a browse-root-relative path beside the
 * document. Strips query/fragment (not filename components), decodes percent
 * escapes exactly once, and resolves `.`/`..` segments; a reference that
 * escapes the root or uses a scheme/absolute/backslash spelling is refused —
 * the host's `isSafePath` re-validates whatever crosses the wire.
 *
 * @param documentPath Browse-root-relative path of the previewed HTML file.
 * @param reference Authored `src`/`href` value.
 * @returns Root-relative path, or undefined when the reference is unusable.
 */
export function resolveAssetPath(documentPath: string, reference: string): string | undefined {
  const suffix = reference.search(/[?#]/)
  let path: string
  try {
    path = decodeURIComponent(suffix === -1 ? reference : reference.slice(0, suffix))
  } catch {
    return undefined
  }
  if (path.length === 0 || path.includes('\0') || path.includes('\\')) return undefined
  if (/^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(path)) return undefined
  const slash = documentPath.lastIndexOf('/')
  const dir = slash < 0 ? '' : documentPath.slice(0, slash + 1)
  const out: string[] = []
  for (const segment of (dir + path).split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (out.length === 0) return undefined
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join('/')
}

/**
 * Read every collected reference through `readText` and enforce the pack
 * limits. Sequential and all-or-nothing, mirroring the official loop: the
 * first unusable reference, failed read, or limit trip gives up the pack.
 *
 * @param refs References collected from the document (already filtered and deduped).
 * @param documentPath Browse-root-relative path of the previewed HTML file.
 * @param readText Reads one root-relative file as text; null on any failure.
 * @param htmlBytes Size budget already spent by the page itself.
 * @returns The asset set, or null when the pack must be abandoned.
 */
export async function packAssets(
  refs: readonly AssetRef[],
  documentPath: string,
  readText: (path: string) => Promise<string | null>,
  htmlBytes: number,
): Promise<HtmlAsset[] | null> {
  if (refs.length > MAX_ASSETS) return null
  let total = htmlBytes
  const assets: HtmlAsset[] = []
  for (const ref of refs) {
    const path = resolveAssetPath(documentPath, ref.reference)
    if (path === undefined) return null
    const text = await readText(path)
    if (text === null) return null
    const size = new TextEncoder().encode(text).byteLength
    if (size > MAX_ASSET_BYTES) return null
    total += size
    if (total > MAX_TOTAL_BYTES) return null
    assets.push({ kind: ref.kind, reference: ref.reference, text })
  }
  return assets
}

/**
 * Encode text for a `data:` payload: UTF-8 bytes as a binary string in bounded
 * chunks (a spread over a multi-megabyte array would overflow the argument
 * limit). Inlining keeps the reference resolvable inside the opaque iframe,
 * which cannot load blob URLs minted by the parent.
 *
 * @param text Asset source text.
 * @returns base64 of its UTF-8 bytes.
 */
export function encodeText(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)))
  }
  return btoa(chunks.join(''))
}

/**
 * Whether a document's visible content mostly comes from its scripts. Used to
 * explain a blank static preview: a canvas / chart page has almost no authored
 * text once script bodies and tags are stripped, while a styled document keeps
 * its copy and needs no such warning.
 *
 * @param html Complete page text.
 * @returns true when stripping scripts and tags leaves under 200 characters.
 */
export function looksScriptRendered(html: string): boolean {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
  // Style and template bodies are markup the browser never shows, so they must
  // not count as authored copy either.
  const withoutMarkupBodies = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
  const text = withoutMarkupBodies.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length < 200
}

/** The `data:` URL an inlined asset is written as. */
export function assetDataUrl(kind: AssetRef['kind'], text: string): string {
  return `data:${kind === 'script' ? 'text/javascript' : 'text/css'};base64,${encodeText(text)}`
}

/** One collected dependency plus every element that references it. */
interface AssetTarget {
  readonly ref: AssetRef
  readonly elements: Element[]
}

/**
 * Collect the document's packable references from an inert parsed document:
 * direct classic `.js` scripts and `.css` stylesheets only. A `<base href>`
 * leaves URL resolution to the browser, so packing is skipped; over the
 * asset-count limit the pack is abandoned.
 */
function collectDocumentAssets(doc: Document): AssetTarget[] | 'skip' {
  if (doc.querySelector('base[href]') !== null) return 'skip'
  const targets: AssetTarget[] = []
  const byKey = new Map<string, number>()
  for (const element of doc.querySelectorAll('script[src], link[href]')) {
    const script = element.localName === 'script'
    const type = element.getAttribute('type')?.trim().toLowerCase() ?? ''
    if (script && !['', 'text/javascript', 'application/javascript'].includes(type)) continue
    if (!script && !(element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet')) continue
    const reference = element.getAttribute(script ? 'src' : 'href') ?? ''
    const suffix = reference.search(/[?#]/)
    const path = suffix === -1 ? reference : reference.slice(0, suffix)
    if (!isRelativeAssetReference(reference) || !(script ? /\.js$/i : /\.css$/i).test(path)) continue
    const key = `${script ? 'script' : 'stylesheet'}:${reference}`
    const known = byKey.get(key)
    if (known !== undefined) {
      targets[known].elements.push(element)
      continue
    }
    if (targets.length >= MAX_ASSETS) return 'skip'
    byKey.set(key, targets.length)
    targets.push({ ref: { kind: script ? 'script' : 'stylesheet', reference }, elements: [element] })
  }
  return targets
}

/**
 * Whether a document could reference an asset at all. A document without a
 * single `src`/`href` attribute has nothing to rewrite, so the pack can answer
 * "no" from one scan instead of parsing a megabyte-long report.
 *
 * @param html Complete page text.
 * @returns True when the text carries at least one `src=` or `href=` attribute.
 */
export function hasAssetReferences(html: string): boolean {
  return /\s(?:src|href)\s*=/i.test(html)
}

/**
 * Build the interactive preview body: read each relative asset, inline it as a
 * `data:` URL, and serialize the document once.
 *
 * @param html Complete page text (already decoded by the host).
 * @param documentPath Browse-root-relative path of the previewed HTML file.
 * @param readText Reads one root-relative file as text; null on any failure.
 * @returns The rewritten page, or null for "render the plain bytes": no
 * packable references, an oversized document, a `<base href>`, or any failure.
 */
export async function packHtmlDocument(
  html: string,
  documentPath: string,
  readText: (path: string) => Promise<string | null>,
): Promise<string | null> {
  if (typeof DOMParser === 'undefined') return null
  const htmlBytes = new TextEncoder().encode(html).byteLength
  if (htmlBytes >= HTML_PACK_MAX_BYTES) return null
  if (!hasAssetReferences(html)) return null
  // Inert parse: scripts do not run and resources are not fetched in a
  // document that is never rendered.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const targets = collectDocumentAssets(doc)
  if (targets === 'skip' || targets.length === 0) return null
  const assets = await packAssets(targets.map((target) => target.ref), documentPath, readText, htmlBytes)
  if (assets === null) return null
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index]
    const attribute = asset.kind === 'script' ? 'src' : 'href'
    const url = assetDataUrl(asset.kind, asset.text)
    for (const element of targets[index].elements) element.setAttribute(attribute, url)
  }
  return `<!doctype html>${doc.documentElement.outerHTML}`
}
