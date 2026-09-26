/**
 * Minimal ambient surface for the platform's Markdown and code highlighter.
 * @deepseek-ai/dsh-client-ui-primitives is a web-shell platform seed listed
 * in package.json `dsh.client.inject`, external to the plugin bundle. These
 * declarations mirror its public MarkdownText and code-highlighting types.
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
  export interface HighlightSpan {
    text: string
    style: import('react').CSSProperties
  }
  export type CodeHighlighter = (code: string) => HighlightSpan[][] | undefined
  export function languageForPath(path: string): string | undefined
  export function useCodeHighlighter(language: string | undefined): CodeHighlighter
  export const MarkdownText: (props: {
    text: string
    labels: MarkdownLabels
    variant?: 'body' | 'compact'
    streaming?: boolean
  }) => JSX.Element
}
