/**
 * Runs every e2e runner and reports all failures at once.
 *
 * The npm script used to chain the runners with `&&`, so the first red runner
 * silently skipped every runner after it: one pre-existing failure (the two
 * filtered-graph runners, whose fixtures predated the `remote === null` guard)
 * hid nine later runners, including the ones covering the batch discard. Each
 * runner is still a standalone script — run one directly while iterating (the
 * imported scenario modules are the exception, described below); this only
 * aggregates them and makes the whole set always execute.
 *
 * Runners are independent processes over file:// fixtures, so a small pool runs
 * them at once: each launches its own Chromium, and the wall clock was dominated
 * by starting them one after another. `E2E_CONCURRENCY` overrides the pool size
 * (default 3, capped by the available CPUs) — raise it only on a machine with
 * cores to spare. `E2E_TIMEOUT_MS` caps one runner (default 240 s) so a hang
 * cannot swallow the whole job silently.
 *
 * The scenario modules next to the runners (clean-states-scenario,
 * phone-modals-scenario) are imported by run / run3 and are NOT runners: they
 * are deliberately absent from the list and refuse to run on their own.
 */
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'

// Historical `test:e2e` order. The helpers next to these (assert-panel-results,
// mock-rpc, *-helper, setup, harness.html) are imported by them, not run.
// The screenshot / measurement probes (overview-toolbar-review,
// version-bar-review, discard-tip-review) are deliberately NOT runners: they
// carry no assertions, so they could never fail — run them by hand for visual
// review instead of spending gate time on an always-green exit.
const RUNNERS = [
  // run2 / run4 are scenario modules now, merged into run and run3.
  'run', 'run3', 'run5',
  'branch-tree-review', 'filtered-graph', 'graph-filter-transition',
  // Search scopes, capability negotiation, deferred responses and responsive geometry.
  'history-path-search',
  // The date track follows the locale's labels: Chinese must lose the fixed
  // 96px band, German must widen without clipping, and the font zoom must not
  // re-break either.
  'history-time-column',
  'branch-status-review', 'files-tree-review', 'files-refresh',
  // File browser package mode: projected source roots and folded package
  // chains, and the `packages` flag the client sends with each listing.
  'files-package-tree',
  // Files preview toolbar at five widths: review screenshots plus the wrap
  // contract (the trailing cluster moves as one item, never split).
  'files-bar-review',
  // Edit mode against the real CodeMirror chunk: save / conflict / guards /
  // reader keys / chunk retry.
  'files-edit',
  // The HTML preview's async lifecycle: a file-content route the runner can
  // park, so a stale or in-flight pack is a real race rather than a sleep.
  'html-preview-lifecycle',
  'overview-detail-scroll',
  'context-menu',
  // The comparison flows: ref / revision pickers, the revision diff overlay and
  // its Escape layering, the file-history chip against the other filters, and
  // the capability gate that hides all three on an older host.
  'compare-history',
  'changes-discard', 'changes-toolbar', 'changes-diff-modal', 'commit-fold-review', 'publish-branch',
  // The change list's flat / tree views (issue #99): directory rows and counts,
  // folding, directory-level stage and discard, the path filter, remembered view.
  'changes-tree',
  'sidebar-tab',
  // The plugin detail page's config form: section / field hierarchy and the
  // collapse contract.
  'config-sections',
  // The tab bar's repository switcher: a workspace with nested checkouts must
  // route every request through the picked one (issue #83).
  'repo-switcher',
  // The workspace-file offer (issue #125): the hint row in the switcher, the
  // browser notice that carries it when no Git pane exists, and the one-click
  // enable whose write is followed by a fresh repo-list.
  'code-workspace-hint',
  'stacked-detail-sticky',
  // Tight stacked (≤ STACKED_TIGHT_BP): the top-band branch column as a drawer
  // over the history — collapsed by default; toggle / blank band / Escape close.
  'stacked-branch-drawer',
  // Stacked tiers (desktop sidebar seat): the repository list in the top band
  // under its 34% cap, and inside the tight drawer — which must stay open
  // across a switch made from within it.
  'stacked-repos',
  // The travelling fill behind an active row: every list that hosts it must
  // position it against its own scroller — a missing `position: relative`
  // walks the fill up to the panel — so each host is driven and measured here.
  'row-slider',
  // The real mermaid chunk (not the harness stub) under the shell's page
  // geometry with real scrollbars: a draw must never overflow the document.
  'mermaid-layout',
  // Served over http://127.0.0.1 so the loopback (local instance) branch of the
  // heavy-preview dialog is exercised; the file:// runners only see the remote one.
  'local-open',
]

const requested = Number.parseInt(process.env.E2E_CONCURRENCY ?? '', 10) || 3
const CONCURRENCY = Math.max(1, Math.min(requested, RUNNERS.length, availableParallelism()))
const TIMEOUT_MS = Number.parseInt(process.env.E2E_TIMEOUT_MS ?? '', 10) || 240_000

/** Run one runner and resolve with its exit status; logs stay buffered. */
function run(runner) {
  const file = fileURLToPath(new URL(`./${runner}.mjs`, import.meta.url))
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, TIMEOUT_MS)
    const finish = (result) => {
      clearTimeout(timer)
      resolve(result)
    }
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { out += chunk })
    child.on('error', (error) => { finish({ code: null, signal: null, out: out + String(error) }) })
    child.on('close', (code, signal) => { finish({ code, signal, out, timedOut }) })
  })
}

const queue = [...RUNNERS]
const failed = []
const worker = async () => {
  while (queue.length > 0) {
    const runner = queue.shift()
    process.stdout.write(`… ${runner}\n`)
    const { code, signal, out, timedOut } = await run(runner)
    // Emit one runner's log as one block, after it settles: concurrent runners
    // would otherwise interleave characters and hide which one failed.
    process.stdout.write(`\n── ${runner}${timedOut ? ` (killed after ${TIMEOUT_MS} ms)` : ''} ──\n${out}`)
    if (code !== 0) {
      const reason = timedOut ? `timeout after ${TIMEOUT_MS} ms`
        : code === null ? `signal ${signal ?? 'unknown'}` : `exit ${code}`
      failed.push(`${runner} (${reason})`)
    }
  }
}

console.log(`e2e: ${RUNNERS.length} runners, ${CONCURRENCY} at a time` + (requested !== CONCURRENCY ? ` (requested ${requested})` : ''))
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, RUNNERS.length) }, worker))

if (failed.length > 0) {
  console.error(`\ne2e: ${failed.length}/${RUNNERS.length} runners FAILED:\n  - ${failed.join('\n  - ')}`)
  process.exit(1)
}
console.log(`\ne2e: all ${RUNNERS.length} runners PASS`)
