/**
 * Structural faces of the host `llm` and `agentDefaultModel` services.
 *
 * Only the fields the commit-message suggest endpoint reads are declared, so
 * the plugin builds standalone (like `SubprocessLike` in git.ts) and the
 * endpoint stays testable with a stub stream instead of a real model. Both
 * services are shipped by `@deepseek-ai/dsh-base`; absence degrades the
 * endpoint to a typed `llm-unavailable` failure instead of breaking it.
 */

/** One streamed chunk, structurally — only the fields the suggest call reads. */
export interface LlmStreamChunk {
  readonly type: string
  readonly text?: string
  readonly kind?: string
  readonly failure?: { readonly code?: string; readonly message?: string }
}

/** Request shape the suggest call assembles for the model. */
export interface LlmStreamOptions {
  readonly provider: string
  readonly model: string
  readonly messages: readonly {
    readonly role: 'user'
    readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  }[]
  readonly system?: string
  readonly maxTokens?: number
  readonly temperature?: number
  readonly reasoningEffort?: string
  readonly signal?: AbortSignal
}

/** Minimal face of the host `llm` service (`ctx.llm`). */
export interface LlmFace {
  stream(options: LlmStreamOptions): AsyncIterable<LlmStreamChunk>
  listProviders?(): readonly { readonly id: string }[]
}

/** Minimal face of the host `agentDefaultModel` service. */
export interface AgentDefaultModelFace {
  currentSelection(): { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | undefined
}