/**
 * AI commit-message suggestion endpoint.
 *
 * Collects the repository's uncommitted changes (or the user's selected paths)
 * — a file list plus the diff against HEAD — frames them for the configured
 * model, and returns the generated message. The LLM surface is the structural
 * `LlmFace` slice of the host `llm` service, so the endpoint runs standalone
 * and stays unit-testable without a real model. All framing policy mirrors
 * @deepseek-ai/dsh-session-title-llm: JSON-wrapped input, a bounded input
 * cap, an output token cap, a timeout, and finish-reason → error mapping.
 */
import type { GitPanelConfig, SnapshotDeps } from './core.ts';
import type { GitSuggestRequest, GitSuggestResult } from './types.ts';
/** Generate a commit message for the session's uncommitted changes. */
export declare function runSuggest(deps: SnapshotDeps, config: GitPanelConfig, request: GitSuggestRequest): Promise<GitSuggestResult>;
