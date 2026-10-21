/**
 * Runs every e2e runner and reports all failures at once.
 *
 * The npm script used to chain the runners with `&&`, so the first red runner
 * silently skipped every runner after it: one pre-existing failure (the two
 * filtered-graph runners, whose fixtures predated the `remote === null` guard)
 * hid nine later runners, including the ones covering the batch discard. Each
 * runner is still a standalone script — run one directly while iterating; this
 * only aggregates them and makes the whole set always execute.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Historical `test:e2e` order. The helpers next to these (assert-panel-results,
// mock-rpc, *-helper, setup, harness.html) are imported by them, not run.
const RUNNERS = [
  'run', 'run2', 'run3', 'run4', 'run5',
  'branch-tree-review', 'filtered-graph', 'graph-filter-transition',
  'branch-status-review', 'files-bar-review', 'files-tree-review', 'files-refresh',
  'overview-toolbar-review', 'version-bar-review', 'discard-tip-review',
  'changes-discard', 'changes-toolbar', 'changes-diff-modal', 'commit-fold-review', 'publish-branch',
  'sidebar-tab',
  'stacked-detail-sticky',
  // Served over http://127.0.0.1 so the loopback (local instance) branch of the
  // heavy-preview dialog is exercised; the file:// runners only see the remote one.
  'local-open',
]

const failed = []
for (const runner of RUNNERS) {
  const file = fileURLToPath(new URL(`./${runner}.mjs`, import.meta.url))
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit' })
  if (result.status !== 0) {
    failed.push(`${runner} (${result.status === null ? `signal ${result.signal}` : `exit ${result.status}`})`)
  }
}

if (failed.length > 0) {
  console.error(`\ne2e: ${failed.length}/${RUNNERS.length} runners FAILED:\n  - ${failed.join('\n  - ')}`)
  process.exit(1)
}
console.log(`\ne2e: all ${RUNNERS.length} runners PASS`)
