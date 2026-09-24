/**
 * Lazy syntax-highlighting facade for the diff views. The real highlighter
 * (highlight.js core + languages) is a large bundle, so it loads via a single
 * dynamic `import()` the first time a diff is shown; until then callers render
 * plain text. Ships a filename→language map so the diff can pick a grammar.
 */
import type { Highlighter } from './highlight-impl'
export type { Highlighter } from './highlight-impl'

let cached: Highlighter | null = null
let pending: Promise<Highlighter | null> | null = null

/** The loaded highlighter, or null before {@link ensureHighlighter} resolves. */
export function currentHighlighter(): Highlighter | null {
  return cached
}

/** Load the highlighter once; concurrent callers share the same promise. */
export function ensureHighlighter(): Promise<Highlighter | null> {
  if (cached !== null) return Promise.resolve(cached)
  if (pending === null) {
    pending = import('./highlight-impl')
      .then((m) => { cached = m.highlighter; return cached })
      .catch(() => null)
  }
  return pending
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  py: 'python', pyi: 'python',
  rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', php: 'php', lua: 'lua', sql: 'sql',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
  cs: 'csharp',
  css: 'css', scss: 'scss', less: 'less',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  md: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml',
  toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini',
  sh: 'bash', bash: 'bash', zsh: 'bash',
}

const NAME_LANG: Record<string, string> = {
  dockerfile: 'bash', makefile: 'bash', '.gitignore': 'bash',
  '.bashrc': 'bash', '.zshrc': 'bash',
}

/** Guess a highlight.js language id from a file path, or '' when unknown. */
export function languageForPath(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const named = NAME_LANG[base.toLowerCase()]
  if (named !== undefined) return named
  const dot = base.lastIndexOf('.')
  if (dot < 0) return ''
  return EXT_LANG[base.slice(dot + 1).toLowerCase()] ?? ''
}
