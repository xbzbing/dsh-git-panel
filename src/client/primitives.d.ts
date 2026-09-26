/**
 * Minimal ambient surface for the platform's untrusted-Markdown renderer,
 * provided by @deepseek-ai/dsh-client-ui-primitives (a web-shell platform
 * seed listed in package.json `dsh.client.inject`). Only the members this
 * plugin uses are declared; ModuleLoader resolves it via `require` at runtime,
 * so it is external to the bundle and needs no dependency install.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { JSX } from 'react'

  export interface MarkdownCodeLabels {
    copyLabel: string
    copiedLabel: string
  }
  export interface MarkdownLabels {
    code: MarkdownCodeLabels
    footnotes: string
  }
  export const MarkdownText: (props: {
    text: string
    labels: MarkdownLabels
    variant?: 'body' | 'compact'
    streaming?: boolean
  }) => JSX.Element
}
