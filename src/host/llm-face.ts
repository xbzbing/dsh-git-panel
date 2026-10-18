/**
 * Structural faces of the host `llm` and `agentDefaultModel` services.
 *
 * The `llm` face is typed against the real `@deepseek-ai/dsh-llm` contract
 * via type-only imports — the build externalizes the whole `@deepseek-ai/*`
 * scope, so this adds no runtime dependency, and any wire-shape drift (e.g.
 * the finish chunk's `reason` envelope) breaks typecheck instead of silently
 * passing. Both services are shipped by `@deepseek-ai/dsh-base`; they are
 * resolved per request (never frozen at construction) and absence degrades
 * the suggest endpoint to a typed `llm-unavailable` failure instead of
 * breaking plugin activation (kept out of `static inject` on purpose).
 */
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

/** Minimal face of the host `llm` service (`ctx.llm`). */
export interface LlmFace {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  listProviders?(): readonly { readonly id: string; readonly name?: string }[]
  /** Adapter-advertised models for one provider; optional on the wire. */
  listModels?(provider: string): Promise<readonly { readonly id: string; readonly name?: string }[]>
  /** Exact-route metadata (reasoning efforts etc.); optional on the wire. */
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<{
    readonly reasoning?: {
      readonly efforts: readonly { readonly id: string; readonly name: string }[]
    }
  }>
}

/** Minimal face of the host `agentDefaultModel` service. */
export interface AgentDefaultModelFace {
  currentSelection(): { readonly provider: string; readonly model: string } | undefined
}

/** One session's durable model selection (projection `next`: pending, else lastUsed). */
export interface SessionModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}
