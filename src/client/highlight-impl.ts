/**
 * highlight.js core with a curated language set. Kept in its own module so the
 * DiffView can pull it in via a single dynamic `import()`, deferring both the
 * bytes' evaluation and language registration until a diff is first viewed.
 */
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import lua from 'highlight.js/lib/languages/lua'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

for (const [name, def] of Object.entries({
  bash, c, cpp, csharp, css, go, ini, java, javascript, json, kotlin, less,
  lua, markdown, php, python, ruby, rust, scss, shell, sql, swift, typescript,
  xml, yaml,
})) {
  hljs.registerLanguage(name, def)
}

export interface Highlighter {
  /** True when the language id is registered. */
  readonly supports: (lang: string) => boolean
  /** Highlight one line, returning escaped HTML with `hljs-*` token spans. */
  readonly line: (code: string, lang: string) => string
}

export const highlighter: Highlighter = {
  supports: (lang) => hljs.getLanguage(lang) !== undefined,
  line: (code, lang) => {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      return escapeHtml(code)
    }
  },
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}
