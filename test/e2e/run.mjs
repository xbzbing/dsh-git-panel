/**
 * E2E: render the built client bundle in a headless Chromium against a mock
 * connection RPC (a dirty repo snapshot), then assert the panel structure.
 *
 * Fully isolated — a local file:// harness, no dsh server, no touch of any
 * running instance. Requires the e2e fixtures (run test/e2e/setup.mjs first,
 * or `npm run test:e2e` which chains it).
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

// A synthetic repository root for the mock snapshot; only its basename is
// ever displayed. Not a real filesystem path.
const FIXTURE_ROOT = 'fixture-repo'

const SNAP = {
  root: FIXTURE_ROOT, branch: 'main', head: 'de54fc0', unborn: false, dirty: true,
  staged: 0, modified: 3, untracked: 1, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', url: 'git@github.com:owner/repo.git', webUrl: 'https://github.com/owner/repo', host: 'github.com', hostKind: 'github' },
  lastCommit: null,
  changes: [
    { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'b.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'd.txt', status: 'untracked', staged: false, isDirectory: false },
    { path: 'img.png', status: 'modified', staged: false, isDirectory: false },
    { path: 'icon.svg', status: 'modified', staged: false, isDirectory: false },
  ],
  stats: { fileCount: 5, staged: 0, modified: 4, untracked: 1, insertions: 3, deletions: 0, lastChangeAt: Date.now(), headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

const out = await page.evaluate(async (snap) => {
  const result = { steps: [] }
  // Mutable snapshot the mock serves: the status-bar test flips it to an ahead
  // and a no-upstream state and re-drives the panel through the check button.
  let liveSnap = snap
  // Valid 64×64 PNG, served as both image-diff sides and the file preview.
  // Real dimensions matter: a 1×1 image's integer clientWidth rounds every
  // zoom level back to 100%, which would hide fit-label regressions.
  const MOCK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsItjJtMZ1Qi+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELgtQSiEPtYVDTgAAAABJRU5ErkJggg=='
  // 800×800 PNG for the drag-to-pan test: at 100% it is wider than the preview
  // pane, so the viewport is actually scrollable and a drag has somewhere to go.
  const MOCK_PNG_BIG = 'iVBORw0KGgoAAAANSUhEUgAAAyAAAAMgCAIAAABUEpE/AAAMK0lEQVR42u3WMQ0AIAwAwQpDCepQRxgQUQ/QrZecgp8+xlwAABQKCQAADBYAgMECAGg7WPtcAAAeGCwAAIMFAGCwAAAMlsECADBYAAAGCwDAYAEAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAGCwDBYAgMECADBYAAAGSx0AAIMFAGCwAAAMFgAABgsAwGABABgsAAAMFgCAwQIAMFgAAAbLYAEAGCwAAIMFAGCwAAAwWAAABgsAwGABAGCwAAAMFgCAwQIAwGABABgsAACDBQBgsAwWAIDBAgAwWAAABgsAAIMFAGCwAAAMFgAABgsAwGABABgsAAAMFgCAwQIAMFgAAAbLYAEAGCwAAIMFAGCwAAAwWAAABgsAwGABAGCwAAAMFgCAwQIAMFgGCwDAYAEAGCwAAIMlDQCAwQIAMFgAAAYLAACDBQBgsAAADBYAAAYLAMBgAQAYLAAAg2WwAAAMFgCAwQIAMFgAABgsAACDBQBgsAAAMFgAAAYLAMBgAQBgsAAADBYAgMECADBYBgsAwGABABgsAACDBQCAwQIAMFgAAAYLAACDBQBgsAAADBYAAAYLAMBgAQAYLAAAg2WwAAAMFgCAwQIAMFgAABgsAACDBQBgsAAAMFgAAAYLAMBgAQAYLIMFAGCwAAAMFgCAwTJYAAAGCwDAYAEAGCwAAAwWAIDBAgAwWAAAGCwAAIMFAGCwAAAMlsECADBYAAAGCwDAYAEAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAIDBAgAwWAAABgsAwGAZLAAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAAwWAIDBAgAwWAAAGCwAAIMFAGCwAAAMlsECADBYAAAGCwDAYAEAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAGCwDBYAgMECADBYAAAGy2ABABgsAACDBQBgsAAAMFgAAAYLAMBgAQBgsAAADBYAgMECADBYBgsAwGABABgsAACDBQCAwQIAMFgAAAYLAACDBQBgsAAADBYAAAYLAMBgAQAYLAAAg2WwAAAMFgCAwQIAMFgAABgsAACDBQBgsAAAMFgAAAYLAMBgAQBgsAAADBYAgMECADBYBgsAwGABABgsAACDBQCAwQIAMFgAAAYLAACDBQBgsAAADBYAgMEyWAAABgsAwGABABgsgwUAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAIDBAgAwWAAABgsAwGAZLAAAgwUAYLAAAAyWOgAABgsAwGABABgsAAAMFgCAwQIAMFgAABgsAACDBQBgsAAADJbBAgAwWAAABgsAwGABAGCwAAAMFgCAwQIAwGABABgsAACDBQCAwQIAMFgAAAYLAMBgGSwAAIMFAGCwAAAMFgAABgsAwGABABgsAAAMFgCAwQIAMFgAABgsAACDBQBgsAAADJbBAgAwWAAABgsAwGABAGCwAAAMFgCAwQIAwGABABgsAACDBQBgsAwWAIDBAgAwWAAABksdAACDBQBgsAAADBYAAAYLAMBgAQAYLAAADBYAgMECADBYAAAGy2ABABgsAACDBQBgsAAAMFgAAAYLAMBgAQBgsAAADBYAgMECAMBgAQAYLAAAgwUAYLAMFgCAwQIAMFgAAAYLAACDBQBgsAAADBYAAAYLAMBgAQAYLAAADBYAgMECADBYAAAGy2ABABgsAACDBQBgsAAAMFgAAAYLAMBgAQBgsAAADBYAgMECADBYBgsAwGABABgsAACDJQ0AgMECADBYAAAGCwAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAINlsAAADBYAgMECADBYAAAYLAAAgwUAYLAAADBYAAAGCwDAYAEAYLAAAAwWAIDBAgAwWAYLAMBgAQAYLAAAgwUAgMECADBYAAAGCwAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAINlsAAADBYAgMECADBYAAAYLAAAgwUAYLAAADBYAAAGCwDAYAEAGCyDBQBgsAAADBYAgMEyWAAABgsAwGABABgsAAAMFgCAwQIAMFgAABgsAACDBQBgsAAADJbBAgAwWAAABgsAwGABAGCwAAAMFgCAwQIAwGABABgsAACDBQCAwQIAMFgAAAYLAMBgGSwAAIMFAGCwAAAMFgAABgsAwGABABgsAAAMFgCAwQIAMFgAABgsAACDBQBgsAAADJbBAgAwWAAABgsAwGABAGCwAAAMFgCAwQIAwGABABgsAACDBQBgsAwWAIDBAgAwWAAABstgAQAYLAAAgwUAYLAAADBYAAAGCwDAYAEAYLAAAAwWAIDBAgAwWAYLAMBgAQAYLAAAgwUAgMECADBYAAAGCwAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAINlsAAADBYAgMECADBYAAAYLAAAgwUAYLAAADBYAAAGCwDAYAEAYLAAAAwWAIDBAgAwWAYLAMBgAQAYLAAAgwUAgMECADBYAAAGCwAAgwUAYLAAAAwWAIDBMlgAAAYLAMBgAQAYLIMFAGCwAAAMFgCAwQIAwGABABgsAACDBQCAwQIAMFgAAAYLAMBgGSwAAIMFAGCwAAAMljoAAAYLAMBgAQAYLAAADBYAgMECADBYAAAYLAAAgwUAYLAAAAyWwQIAMFgAAAYLAMBgAQBgsAAADBYAgMECAMBgAQAYLAAAgwUAgMECADBYAAAGCwDAYBksAACDBQBgsAAADBYAAAYLAMBgAQAYLAAADBYAgMECADBYAAAYLAAAgwUAYLAAAAyWwQIAMFgAAAYLAMBgAQBgsAAADBYAgMECAMBgAQAYLAAAgwUAYLAMFgCAwQIAMFgAAAZLHQAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAAwWAIDBAgAwWAAABstgAQAYLAAAgwUAYLAAADBYAAAGCwDAYAEAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAGCwDBYAgMECADBYAAAGCwAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAAwWAIDBAgAwWAAABstgAQAYLAAAgwUAYLAAADBYAAAGCwDAYAEAYLAAAAwWAIDBAgAwWAYLAMBgAQAYLAAAgyUNAIDBAgAwWAAABgsAAIMFAGCwAAAMFgAABgsAwGABABgsAACDZbAAAAwWAIDBAgAwWAAAGCwAAIMFAGCwAAAwWAAABgsAwGABAGCwAAAMFgCAwQIAMFgGCwDAYAEAGCwAAIMFAIDBAgAwWAAABgsAAIMFAGCwAAAMFgAABgsAwGABABgsAACDZbAAAAwWAIDBAgAwWAAAGCwAAIMFAGCwAAAwWAAABgsAwGABABgsgwUAYLAAAAwWAIDBMlgAAAYLAMBgAQAYLAAADBYAgMECADBYAAAYLAAAgwUAYLAAAAyWwQIAMFgAAAYLAMBgAQBgsAAADBYAgMECAMBgAQAYLAAAgwUAgMECADBYAAAGCwDAYBksAACDBQBgsAAADBYAAAYLAMBgAQAYLAAADBYAgMECADBYAAAYLAAAgwUAYLAAAAyWwQIAMFgAAAYLAMBgAQBgsAAADBYAgMECAMBgAQAYLAAAgwUAYLAMFgCAwQIAMFgAAAbLYAEAGCwAAIMFAGCwAAAwWAAABgsAwGABAGCwAAAMFgCAwQIAMFgGCwDAYAEAGCwAAIMFAIDBAgAwWAAABgsAAIMFAGCwAAAMFgAABgsAwGABABgsAACDZbAAAAwWAIDBAgAwWAAAGCwAAIMFAGCwAAAwWAAABgsAwGABAGCwAAAMFgCAwQIAMFgGCwDAYAEAGCwAAIMFAIDBAgAwWAAABgsAAIMFAGCwAAAMFgCAwTJYAAAGCwDAYAEAGCyDBQBgsAAADBYAgMECAMBgAQAYLAAAgwUAgMECADBYAAAGCwDAYBksAACDBQBgsAAADJY6AAAGCwDAYAEAGCwAAAwWAIDBAgAwWAAAGCwAAIMFAGCwAAAMlsECADBYAAAGCwDAYAEAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAIDBAgAwWAAABgsAwGAZLAAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAAwWAIDBAgAwWAAAGCwAAIMFAGCwAAAMlsECADBYAAAGCwDAYAEAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAGCwDBYAgMECADBYAAAGSx0AgNrBAgDgn8ECADBYAAAGCwCglQQBoowL1tK/2wAAAABJRU5ErkJggg=='
  // 1200×300 PNG: a *width-constrained* image, so a pane-width change moves its
  // fit ratio (the square fixture is height-constrained instead).
  const MOCK_PNG_WIDE = 'iVBORw0KGgoAAAANSUhEUgAABLAAAAEsCAIAAABc390HAAAGB0lEQVR42u3XQQ0AIBDEwJODJpSgEwc4QAI6uJ1kFPTXGmsCAAAQqCQAAAAwhAAAABhCAAAAooZwnwsAAEBjhhAAAMAQGkIAAABDaAgBAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAAAYQkMIAABgCA0hAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAAQ2gIAQAADKEhBAAAMISGEAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAgCE0hAAAAIbQEAIAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAADCEhhAAAMAQGkIAAABDaAgBAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAAAYQkMIAABgCA0hAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAAQ2gIAQAADKEhBAAAMITSAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAMISGEAAAwBAaQgAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAAIbQEAIAABhCQwgAAGAI1QEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAGAIDSEAAIAhNIQAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAMoSEEAAAwhIYQAADAEKoDAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAAAAQwgAAIAhBAAAwBACAABgCAEAADCEAAAAGEIAAAAMIQAAAIYQAADAEBpCAAAAQ2gIAQAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAYAgBAAAwhAAAABhCAAAADCEAAACGEAAAAEMIAACAIQQAAMAQAgAAGEJDCAAAYAgNIQAAgCEEAADAEAIAAGAIAQAAMIQAAAAYQgAAAAwhAAAAhhAAAID/hhAAAIAchhAAAMAQAgAAYAgBAABo7wH350/iheM7iwAAAABJRU5ErkJggg=='
  const fileQueries = []
  // Branch-switch probes: every `run` action lands here, and `branchQueries`
  // counts the branch-list reloads a landed checkout must trigger.
  const runActions = []
  let runFailure = null
  let branchQueries = 0
  // The suggest endpoint parks until the test releases it, so the in-flight
  // lock on the commit box is observable.
  let suggestRelease = null
  const entry = window.__getLoaded()
  if (!entry || typeof entry.apply !== 'function') return { error: 'plugin did not load' }

  const connection = {
    rpc: {
      call: async (_channel, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'gitPanel/snapshot') return { ok: true, value: { ok: true, value: liveSnap } }
        if (endpoint === 'gitPanel/query') {
          const q = request.query
          if (q.kind === 'worktree-stats') return { ok: true, value: { ok: true, value: { kind: 'worktree-stats', stats: { fileCount: 3, staged: 0, modified: 2, untracked: 1, insertions: 3, deletions: 0, lastChangeAt: Date.now(), headCommittedAt: new Date().toISOString() } } } }
          if (q.kind === 'branches') { branchQueries += 1; return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'feature', shortHash: 'd196623' }, { name: 'main', shortHash: 'de54fc0' }], remote: [{ name: 'origin/main', shortHash: 'de54fc0' }, { name: 'origin/release', shortHash: 'e5f6a7b' }] } } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: ['Tester'] } } }
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 2, commits: [
            { hash: 'd196623aaa', shortHash: 'd196623', subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString(), parents: ['de54fc0bbb'], refs: [{ kind: 'branch', name: 'feature', head: false }] },
            { hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'init: first commit', author: 'Tester', dateIso: new Date().toISOString(), parents: [], refs: [{ kind: 'branch', name: 'main', head: true }] },
          ] } } }
          if (q.kind === 'show') return { ok: true, value: { ok: true, value: { kind: 'show', ref: q.ref, commit: { hash: q.ref, shortHash: q.ref.slice(0, 7), subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString() }, body: 'detailed body text', stats: [{ path: 'index.ts', status: 'modified' }, { path: 'src/app.ts', status: 'added' }], insertions: 12, deletions: 4 } } }
          if (q.kind === 'diff') {
            // An image path diffs as the binary marker, like real git.
            if (q.path.endsWith('.png')) return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n', newLines: 0 } } }
            // An SVG is text: git produces a real source diff for it.
            if (q.path.endsWith('.svg')) return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/icon.svg b/icon.svg\n--- a/icon.svg\n+++ b/icon.svg\n@@ -1 +1 @@\n-<svg width="1"/>\n+<svg width="2"/>\n', newLines: 1 } } }
            if (q.path.endsWith('.ts')) return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-const count = 1\n+const count = 2\n', newLines: 1 } } }
            return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n line1\n+line2\n', newLines: 2 } } }
          }
          if (q.kind === 'image-diff') return { ok: true, value: { ok: true, value: { kind: 'image-diff', path: q.path, mime: q.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png', old: `data:image/png;base64,${MOCK_PNG}`, new: `data:image/png;base64,${MOCK_PNG}` } } }
          if (q.kind === 'dir-list') {
            fileQueries.push(q.path)
            if (q.path === '') return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: '', truncated: false, entries: [
              { name: 'src', dir: true }, { name: 'cache', dir: true, ignored: true }, { name: 'a.txt', dir: false, size: 12 }, { name: 'logo.png', dir: false, size: 64 }, { name: 'icon.png', dir: false, size: 64 }, { name: 'big.png', dir: false, size: 3172 }, { name: 'wide.png', dir: false, size: 1600 }, { name: 'README.md', dir: false, size: 18 }, { name: 'page.html', dir: false, size: 60 }, { name: 'big.js', dir: false, size: 60000 }, { name: 'ignored.log', dir: false, ignored: true },
            ] } } }
            if (q.path === 'src') return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: 'src', truncated: false, entries: [
              { name: 'index.ts', dir: false, size: 40 },
            ] } } }
            return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries: [] } } }
          }
          if (q.kind === 'file-content') {
            if (q.path.endsWith('.md')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: '# Hello Markdown\n', lines: 1 } } }
            if (q.path.endsWith('.html')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: '<!doctype html><title>Doc</title><p id="hi">Hello HTML</p>', lines: 1 } } }
            // A big text file exercises both source-view guards: >5000 lines
            // (highlight off) with one >5000-char line (truncation).
            if (q.path.endsWith('big.js')) {
              const huge = 'x'.repeat(6000)
              const body = `const long = "${huge}"\n` + Array.from({ length: 5100 }, (_, i) => `line ${i}`).join('\n') + '\n'
              return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: body, lines: 5101 } } }
            }
            if (q.path.endsWith('wide.png')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'image', dataUrl: `data:image/png;base64,${MOCK_PNG_WIDE}` } } }
            if (q.path.endsWith('big.png')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'image', dataUrl: `data:image/png;base64,${MOCK_PNG_BIG}` } } }
            if (q.path.endsWith('.png')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'image', dataUrl: `data:image/png;base64,${MOCK_PNG}` } } }
            return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: 'const x = 1\nconst y = 2\n', lines: 2 } } }
          }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: 'init: first commit' } } }
          if (q.kind === 'pull-preview') return { ok: true, value: { ok: true, value: { kind: 'pull-preview', hasUpstream: true, commits: 2, files: 3, insertions: 10, deletions: 4 } } }
          if (q.kind === 'push-preview') return { ok: true, value: { ok: true, value: { kind: 'push-preview', hasUpstream: liveSnap.hasUpstream === true, commits: 3, files: 2, insertions: 7, deletions: 1 } } }
          if (q.kind === 'stash-list') return { ok: true, value: { ok: true, value: { kind: 'stash-list', entries: [{ index: 0, sha: 'abcdef1234', message: 'wip on main', branch: 'main', relTime: '1 hour ago' }] } } }
        }
        if (endpoint === 'gitPanel/run') {
          const act = request.action
          runActions.push(act)
          // A forced failure drives the refusal path (dirty work tree) without
          // needing the mock to model git's real work-tree checks.
          if (runFailure !== null && act.kind === 'branch-checkout') {
            const failure = runFailure
            runFailure = null
            return { ok: true, value: { ok: false, error: failure } }
          }
          // A landed checkout moves HEAD: the panel must show the branch it read
          // back from the returned snapshot.
          if (act.kind === 'branch-checkout') liveSnap = { ...liveSnap, branch: act.name }
          return { ok: true, value: { ok: true, snapshot: liveSnap } }
        }
        if (endpoint === 'gitPanel/suggest') {
          await new Promise((r) => { suggestRelease = r })
          return { ok: true, value: { ok: true, value: { message: 'feat: suggested', truncated: false } } }
        }
        if (endpoint === 'gitPanel/version') return { ok: true, value: { current: '0.1.0', repositoryUrl: 'https://github.com/xbzbing/dsh-git-panel', updateAvailable: false, checkedRemote: request.check === true } }
        return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
      },
    },
  }

  const registered = {}
  const services = { connection }
  const ctx = {
    get: (k) => services[k],
    effect: (cb) => { try { cb() } catch (e) { /* ignore */ } },
    on: () => () => {},
    inject: (_deps, cb) => cb(ctx),
    slots: {
      inject: (name, provider) => provider(),
      register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} },
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
  }
  entry.apply(ctx)
  result.slots = Object.keys(registered)

  const ReactDOM = window.ReactDOM
  const pillEntry = registered['conversation.input.left']
  ReactDOM.createRoot(document.getElementById('pill')).render(pillEntry.component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 300))
  result.pillHasDirty = document.querySelector('.gp-pill--dirty') !== null

  const viewEntry = registered['conversation.view']
  result.viewLabel = viewEntry.reg.label ? viewEntry.reg.label() : null
  result.viewOrder = viewEntry.reg.order
  const viewRoot = ReactDOM.createRoot(document.getElementById('panel'))
  viewRoot.render(viewEntry.component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 500))
  result.tabCount = document.querySelectorAll('.gp-tab').length
  result.dirtyDefault = document.querySelector('.gp-tab--active')?.textContent?.includes('tab.changes') ?? false
  result.noInitialFileListing = fileQueries.length === 0
  const panelRoot = document.querySelector('.gp-panel')
  result.fontDefault = getComputedStyle(panelRoot).fontSize
  document.querySelector('.gp-font__increase')?.click()
  await new Promise((r) => setTimeout(r, 60))
  result.fontIncreased = getComputedStyle(panelRoot).fontSize
  result.fontStored = localStorage.getItem('gp.panel.fontDelta')
  document.querySelector('.gp-font__reset')?.click()
  await new Promise((r) => setTimeout(r, 60))
  result.fontReset = getComputedStyle(panelRoot).fontSize
  // Responsive tab bar: a wide panel is the three-column 'wide' layout with the
  // trailing controls inline; narrowing to a phone width switches to the
  // 'compact' layout, which keeps the font stepper + version bar (wrapped onto a
  // second row, not hidden) and keeps the tab labels; only a very narrow panel
  // drops the labels to icon-only.
  const panelHost = document.getElementById('panel')
  const fontCluster = panelRoot.querySelector('.gp-font')
  const firstLabel = panelRoot.querySelector('.gp-tab__label')
  result.wideLayout = panelRoot.getAttribute('data-layout')
  result.wideShowsControls = getComputedStyle(fontCluster).display !== 'none'
  result.wideShowsLabel = getComputedStyle(firstLabel).display !== 'none'
  panelHost.style.width = '400px'
  await new Promise((r) => setTimeout(r, 120))
  result.narrowLayout = panelRoot.getAttribute('data-layout')
  result.narrowShowsControls = getComputedStyle(panelRoot.querySelector('.gp-font')).display !== 'none'
  result.narrowKeepsLabel = getComputedStyle(panelRoot.querySelector('.gp-tab__label')).display !== 'none'
  panelHost.style.width = '260px'
  await new Promise((r) => setTimeout(r, 80))
  result.tinyHidesLabel = getComputedStyle(panelRoot.querySelector('.gp-tab__label')).display === 'none'
  result.tinyKeepsIcon = getComputedStyle(panelRoot.querySelector('.gp-tab__icon')).display !== 'none'
  result.tinyShowsControls = getComputedStyle(panelRoot.querySelector('.gp-font')).display !== 'none'
  panelHost.style.width = '1000px'
  await new Promise((r) => setTimeout(r, 120))
  result.restoresLayout = panelRoot.getAttribute('data-layout')
  result.restoresLabel = getComputedStyle(panelRoot.querySelector('.gp-tab__label')).display !== 'none'
  const changesTab = [...document.querySelectorAll('.gp-tab')].find((t) => (t.textContent || '').includes('tab.changes'))
  if (changesTab) { changesTab.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.hasStats = document.querySelector('.gp-stats') !== null
  result.hasCommitBox = document.querySelector('.gp-commitbox') !== null
  result.changeRows = document.querySelectorAll('.gp-file-row').length
  result.hasAmend = document.querySelector('.gp-commitbox__amend') !== null
  // Stash: the toolbar carries a stash button; the stash list (mock → one entry)
  // expands to a row, and the drop confirm shows the shared AI hint.
  result.hasStashBtn = [...document.querySelectorAll('.gp-toolbar .gp-btn')].some((b) => (b.textContent || '').includes('changes.stash'))
  const stashHead = document.querySelector('.gp-stash .gp-group-head')
  if (stashHead) { stashHead.click(); await new Promise((r) => setTimeout(r, 150)) }
  result.stashRows = document.querySelectorAll('.gp-stash-row').length
  const dropBtn = document.querySelector('.gp-stash-row__actions .gp-icon-btn')
  if (dropBtn) { dropBtn.click(); await new Promise((r) => setTimeout(r, 150)) }
  result.stashDropHint = (document.querySelector('.gp-modal--sm .gp-modal__hint')?.textContent || '') === 'ops.aiHint'
  // Escape dismisses the confirm dialog (matches the panel's dialog contract).
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  result.stashDropEscClosed = document.querySelector('.gp-modal--sm') === null
  // Stash push dialog (shares renderModalShell): the toolbar button opens it with
  // the AI hint, and Escape dismisses it.
  const stashPushBtn = [...document.querySelectorAll('.gp-toolbar .gp-btn')].find((b) => (b.textContent || '').includes('changes.stash'))
  if (stashPushBtn) { stashPushBtn.click(); await new Promise((r) => setTimeout(r, 150)) }
  result.stashPushOpened = document.querySelector('.gp-modal--sm') !== null
  result.stashPushHint = (document.querySelector('.gp-modal--sm .gp-modal__hint')?.textContent || '') === 'ops.aiHint'
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  result.stashPushEscClosed = document.querySelector('.gp-modal--sm') === null
  const commitBtn = [...document.querySelectorAll('.gp-commitbox__actions .gp-btn--primary')][0]
  result.commitDisabledEmpty = commitBtn?.disabled === true
  const primaryStyle = getComputedStyle(commitBtn)
  result.commitPrimaryBg = primaryStyle.backgroundColor
  const msgBox = document.querySelector('.gp-commitbox__msg')
  if (msgBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(msgBox, 'feat: add feature')
    msgBox.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  }
  const commitBtnAfter = [...document.querySelectorAll('.gp-commitbox__actions .gp-btn--primary')][0]
  result.commitEnabledWithMessage = commitBtnAfter?.disabled === false
  result.commitPrimaryHoverKeepsColor = [...document.styleSheets].some((sheet) => {
    try { return [...sheet.cssRules].some((rule) => rule.selectorText === '.gp-btn--primary:hover' || rule.selectorText === '.gp-btn--primary:hover:not(:disabled)') } catch { return false }
  })
  if (msgBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(msgBox, '')
    msgBox.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  }

  // AI suggest in flight: the message box and amend toggle lock so typing
  // can't race the incoming message; both unlock once it lands.
  const suggestBtn = [...document.querySelectorAll('.gp-commitbox__actions .gp-btn')].find((b) => !b.classList.contains('gp-btn--primary'))
  if (suggestBtn && msgBox) {
    suggestBtn.click()
    await new Promise((r) => setTimeout(r, 60))
    const amendCb = document.querySelector('.gp-commitbox__amend input')
    result.suggestLocksMessage = msgBox.readOnly === true && msgBox.getAttribute('aria-busy') === 'true'
    result.suggestLocksAmend = amendCb?.disabled === true
    if (suggestRelease) suggestRelease()
    await new Promise((r) => setTimeout(r, 80))
    result.suggestUnlocksMessage = msgBox.readOnly === false && amendCb?.disabled === false
    result.suggestFilled = msgBox.value === 'feat: suggested'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(msgBox, '')
    msgBox.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  }

  // Image compare: opening a binary image renders old/new panes (not the
  // binary notice), and before/after modes collapse to a single labelled pane.
  const imgRow = [...document.querySelectorAll('.gp-file-row')].find((r) => (r.textContent || '').includes('img.png'))
  if (imgRow) { imgRow.click(); await new Promise((r) => setTimeout(r, 600)) }
  result.imagePanes = document.querySelectorAll('.gp-imgcmp__pane').length
  result.imageImgs = document.querySelectorAll('.gp-imgcmp img').length
  result.imageSrcOk = [...document.querySelectorAll('.gp-imgcmp img')].every((i) => (i.src || '').startsWith('data:image/png;base64,'))
  // Each comparison pane renders its own zoom toolbar (zoom shares one component).
  result.zoomDiffBars = document.querySelectorAll('.gp-imgcmp .gp-zoom__bar').length
  // Each pane zooms on its own: zooming the left one must leave the right alone.
  const paneRoots = [...document.querySelectorAll('.gp-imgcmp .gp-zoom')]
  const panePct = (i) => paneRoots[i]?.querySelector('.gp-zoom__pct')?.textContent ?? ''
  const paneRendered = (i) => Math.round(paneRoots[i]?.querySelector('img')?.getBoundingClientRect().width ?? 0)
  const panePctBefore = [panePct(0), panePct(1)]
  const paneWBefore = paneRendered(1)
  paneRoots[0]?.querySelector('button[aria-label="files.zoomIn"]')?.click()
  await new Promise((r) => setTimeout(r, 150))
  result.zoomDiffPanesIndependent = panePct(0) !== panePctBefore[0] && panePct(1) === panePctBefore[1]
    && paneRendered(0) > paneRendered(1) && paneRendered(1) === paneWBefore
  result.imageHeads = [...document.querySelectorAll('.gp-imgcmp__head')].map((e) => e.textContent)
  const afterBtn = [...document.querySelectorAll('.gp-seg__btn')].find((b) => (b.textContent || '') === 'diff.after')
  if (afterBtn) { afterBtn.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.imageSingle = document.querySelector('.gp-imgcmp--single') !== null
  result.imageSingleHead = document.querySelector('.gp-imgcmp__head')?.textContent ?? null

  // SVG diff: an SVG is image + text, so it shows a render/source toggle. It
  // defaults to the rendered comparison (image panes), and switching to source
  // reveals the text diff; switching back returns to the rendered panes.
  const svgRow = [...document.querySelectorAll('.gp-file-row')].find((r) => (r.textContent || '').includes('icon.svg'))
  if (svgRow) { svgRow.click(); await new Promise((r) => setTimeout(r, 600)) }
  // The left pane was left zoomed above; feeding the comparison panes a new file
  // must drop that zoom instead of carrying it over.
  const panePctsAfterSwitch = [...document.querySelectorAll('.gp-imgcmp .gp-zoom__pct')].map((e) => e.textContent)
  result.zoomDiffResetsOnFileSwitch = panePctsAfterSwitch.length === 0 || panePctsAfterSwitch.every((p) => p === '100%')
  result.svgHasToggle = document.querySelector('.gp-svgdiff__bar') !== null
  result.svgRenderDefault = document.querySelector('.gp-svgdiff .gp-imgcmp') !== null
  const svgSourceBtn = [...document.querySelectorAll('.gp-svgdiff__bar .gp-seg__btn')].find((b) => (b.textContent || '') === 'diff.svgSource')
  if (svgSourceBtn) { svgSourceBtn.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.svgSourceShowsDiff = document.querySelector('.gp-svgdiff .gp-diff__unified, .gp-svgdiff .gp-diff__side, .gp-svgdiff .gp-diff__single') !== null
  const svgRenderBtn = [...document.querySelectorAll('.gp-svgdiff__bar .gp-seg__btn')].find((b) => (b.textContent || '') === 'diff.svgRender')
  if (svgRenderBtn) { svgRenderBtn.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.svgRenderRestored = document.querySelector('.gp-svgdiff .gp-imgcmp') !== null

  const tabs = [...document.querySelectorAll('.gp-tab')]
  const overviewTab = tabs.find((t) => (t.textContent || '').includes('tab.overview'))
  if (overviewTab) { overviewTab.click(); await new Promise((r) => setTimeout(r, 500)) }
  result.hasBranchList = document.querySelector('.gp-branch-group') !== null
  result.commitRows = document.querySelectorAll('.gp-commit-row').length
  result.hasGraph = document.querySelector('.gp-graph-svg') !== null
  // Left-column status bar (wide): the GitHub repo link resolves to the parsed
  // web URL; the branch is synced (behind 0), so no pull button is offered.
  const sbar = document.querySelector('.gp-col--left .gp-statusbar')
  result.statusBarShown = sbar !== null
  result.statusRepoHref = sbar?.querySelector('a.gp-statusbar__repo')?.getAttribute('href') ?? null
  result.statusSyncedShown = (sbar?.querySelector('.gp-statusbar__state')?.textContent || '').includes('status.synced')
  result.statusNoPullWhenSynced = sbar?.querySelector('.gp-statusbar__pull') == null
  result.statusNoPushWhenSynced = ![...(sbar?.querySelectorAll('.gp-statusbar__pull') || [])].some((b) => (b.textContent || '').includes('status.push'))
  // Flip the served snapshot to strictly-ahead and re-drive through the check
  // button (fetch → onAction → controller.accept): the push button appears, and
  // confirming shows the outgoing scope preview.
  const clickCheck = async () => {
    const btn = document.querySelector('.gp-col--left .gp-statusbar .gp-statusbar__btn')
    if (btn) { btn.click(); await new Promise((r) => setTimeout(r, 300)) }
  }
  const findBarBtn = (key) => [...document.querySelectorAll('.gp-col--left .gp-statusbar__sync button')].find((b) => (b.textContent || '').includes(key)) || null
  liveSnap = { ...snap, ahead: 3, behind: 0 }
  await clickCheck()
  const pushBtn = findBarBtn('status.push')
  result.statusAheadPushShown = pushBtn != null
  if (pushBtn) { pushBtn.click(); await new Promise((r) => setTimeout(r, 250)) }
  result.statusPushConfirmOpened = [...document.querySelectorAll('.gp-modal__path')].some((n) => (n.textContent || '').includes('status.pushConfirmTitle'))
  result.statusPushScopeShown = (document.querySelector('.gp-modal .gp-pullscope')?.textContent || '').includes('status.pushScope')
  document.querySelector('.gp-modal__close')?.click(); await new Promise((r) => setTimeout(r, 150))
  // Flip to a no-upstream branch: the publish button replaces push, and its
  // confirm opens (the second reminder before `git push -u`).
  liveSnap = { ...snap, ahead: 0, behind: 0, hasUpstream: false }
  await clickCheck()
  result.statusNoUpstreamNoPush = findBarBtn('status.push') == null
  const publishBtn = findBarBtn('status.publish')
  result.statusPublishShown = publishBtn != null
  if (publishBtn) { publishBtn.click(); await new Promise((r) => setTimeout(r, 250)) }
  result.statusPublishConfirmOpened = [...document.querySelectorAll('.gp-modal__path')].some((n) => (n.textContent || '').includes('status.publishConfirmTitle'))
  document.querySelector('.gp-modal__close')?.click(); await new Promise((r) => setTimeout(r, 150))
  liveSnap = snap
  // Search box: a wide panel uses the full "(message / hash)" placeholder key;
  // narrowing it below the threshold swaps to the short key (a placeholder is a
  // DOM attribute, so this is a JS swap, not CSS). The harness binds t() to the
  // raw key, so assert on the key that lands in the placeholder.
  const searchBox = document.querySelector('.gp-search')
  result.searchFullHint = searchBox?.getAttribute('placeholder') === 'overview.search'
  const panelHostForSearch = document.getElementById('panel')
  panelHostForSearch.style.width = '360px'
  await new Promise((r) => setTimeout(r, 120))
  result.searchShortHint = document.querySelector('.gp-search')?.getAttribute('placeholder') === 'overview.searchShort'
  panelHostForSearch.style.width = '1000px'
  await new Promise((r) => setTimeout(r, 120))
  result.searchHintRestored = document.querySelector('.gp-search')?.getAttribute('placeholder') === 'overview.search'

  // ── branch switch (wide): row switch button → confirm → run payload ──
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const leftRow = (name) => [...document.querySelectorAll('.gp-col--left .gp-branch-row')].find((r) => (r.querySelector('.gp-tree-name')?.textContent || '') === name) || null
  const switchBtnOf = (name) => leftRow(name)?.querySelector('.gp-branch-row__switch') ?? null
  result.switchNoFixedEntry = document.querySelector('.gp-switch-row') === null
  // The remote section starts collapsed; expand it so its rows are listed.
  ;[...document.querySelectorAll('.gp-col--left .gp-branch-group__head')].find((el) => (el.textContent || '').includes('overview.remote'))?.click()
  await wait(60)
  // Only rows with a real target carry the button: not the checked-out branch,
  // not the remote ref resolving to it, never tags.
  result.switchBtnRows = [...document.querySelectorAll('.gp-col--left .gp-branch-row')]
    .filter((r) => r.querySelector('.gp-branch-row__switch') !== null)
    .map((r) => r.querySelector('.gp-tree-name')?.textContent)
  // Hidden until hover (no pointer in the headless run), revealed by a hover rule.
  result.switchBtnHidden = switchBtnOf('feature') !== null && getComputedStyle(switchBtnOf('feature')).display === 'none'
  result.switchBtnHoverRule = [...document.styleSheets].some((sheet) => {
    try { return [...sheet.cssRules].some((rule) => rule.selectorText === '.gp-branch-row:hover .gp-branch-row__switch') } catch { return false }
  })
  result.switchBtnTitleTrack = switchBtnOf('origin/release')?.getAttribute('title') === 'switch.rowTitleTrack'
  result.switchBtnTitleLocal = switchBtnOf('feature')?.getAttribute('title') === 'switch.rowTitle'
  const branchQueriesBefore = branchQueries
  // Remote row → confirm dialog states the tracking branch it will create. The
  // button click must not also toggle the row's history filter.
  switchBtnOf('origin/release')?.click()
  await wait(80)
  result.switchBtnNoFilter = leftRow('origin/release')?.classList.contains('gp-branch-row--active') === false
  const confirmText = () => (document.querySelector('.gp-modal')?.textContent || '')
  result.switchConfirmOpened = confirmText().includes('switch.confirmTitle')
  result.switchConfirmBody = confirmText().includes('switch.body')
  result.switchTrackingNote = confirmText().includes('switch.trackingNote')
  result.switchDirtyWarn = confirmText().includes('switch.dirtyWarn')
  result.switchStashChoice = confirmText().includes('switch.modeStash')
  result.switchDefaultNoStash = confirmText().includes('switch.confirm') && !confirmText().includes('switch.confirmStash')
  // Choosing "stash first" is an explicit opt-in and relabels the confirm button.
  const stashRadio = [...document.querySelectorAll('.gp-bpick__mode')].find((l) => (l.textContent || '').includes('switch.modeStash'))
  stashRadio?.querySelector('input')?.click()
  await wait(60)
  result.switchStashRelabel = confirmText().includes('switch.confirmStash')
  const confirmBtn = [...document.querySelectorAll('.gp-modal__footer .gp-btn')].find((b) => (b.textContent || '').includes('switch.confirmStash'))
  confirmBtn?.click()
  await wait(150)
  const switchAction = runActions[runActions.length - 1]
  result.switchAction = switchAction
  result.switchModalClosed = document.querySelector('.gp-modal__path') === null
  result.switchReloadedBranches = branchQueries > branchQueriesBefore
  liveSnap = snap
  await clickCheck()
  // Closing the confirm without confirming runs nothing.
  const runsBeforeCancel = runActions.length
  switchBtnOf('feature')?.click()
  await wait(80)
  document.querySelector('.gp-modal__close')?.click()
  await wait(60)
  result.switchCancelRunsNothing = runActions.length === runsBeforeCancel && document.querySelector('.gp-modal__path') === null
  // Refusal path: git rejects the switch, the error lands inside the still-open
  // dialog (with the stash option already on screen as the way out).
  switchBtnOf('feature')?.click()
  await wait(80)
  runFailure = { code: 'local-changes-block', message: 'local changes' }
  ;[...document.querySelectorAll('.gp-modal__footer .gp-btn')].find((b) => (b.textContent || '').includes('switch.confirm'))?.click()
  await wait(150)
  result.switchRefusalShown = (document.querySelector('.gp-modal .gp-feedback')?.textContent || '').includes('error.localChangesBlock')
  result.switchRefusalStaysOpen = document.querySelector('.gp-modal__path')?.textContent === 'switch.confirmTitle'
  document.querySelector('.gp-modal__close')?.click()
  await wait(60)


  // Select the first commit → its changed-file tree appears on the right.
  const firstCommit = document.querySelector('.gp-commit-row')
  if (firstCommit) { firstCommit.click(); await new Promise((r) => setTimeout(r, 400)) }
  // The changed-file list has a `src/` dir (with app.ts) + a root index.ts file.
  const fileRow = document.querySelector('.gp-detail__files .gp-tree-row .gp-status-badge')?.closest('.gp-tree-row') ?? null
  result.hasDetailFileRow = fileRow !== null
  // Change summary above the file tree: file count + colored +/- line counts.
  const summary = document.querySelector('.gp-detail__summary')
  result.hasChangeSummary = summary !== null
  result.summaryHasFileCount = summary !== null && (summary.textContent || '').includes('overview.changeSummary')
  result.summaryAdd = summary ? (summary.querySelector('.gp-stats__add')?.textContent || '') : ''
  result.summaryDel = summary ? (summary.querySelector('.gp-stats__del')?.textContent || '') : ''
  // Collapsible changed-file tree: the folder row toggles its children (bug fix
  // — the chevron used to be inert). Default fully expanded; click to collapse.
  const childVisible = () => [...document.querySelectorAll('.gp-detail__files .gp-tree-row')].some((r) => (r.textContent || '').includes('app.ts'))
  const detailDirRow = document.querySelector('.gp-detail__files .gp-tree-row--dir')
  result.treeDirRowShown = detailDirRow !== null
  result.treeChildVisibleDefault = childVisible()
  result.treeDirExpandedDefault = detailDirRow?.getAttribute('aria-expanded') === 'true'
  if (detailDirRow) { detailDirRow.click(); await new Promise((r) => setTimeout(r, 120)) }
  const detailDirRowAfter = document.querySelector('.gp-detail__files .gp-tree-row--dir')
  result.treeChildHiddenAfterCollapse = !childVisible()
  result.treeDirCollapsedAttr = detailDirRowAfter?.getAttribute('aria-expanded') === 'false'
  if (detailDirRowAfter) { detailDirRowAfter.click(); await new Promise((r) => setTimeout(r, 120)) }
  result.treeChildVisibleAfterReexpand = childVisible()
  // Keyboard a11y: the folder row is focusable (tabIndex 0) and Enter toggles it.
  const kbDirRow = document.querySelector('.gp-detail__files .gp-tree-row--dir')
  result.treeDirFocusable = kbDirRow?.getAttribute('tabindex') === '0'
  if (kbDirRow) { kbDirRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await new Promise((r) => setTimeout(r, 120)) }
  result.treeChildHiddenAfterKeyToggle = !childVisible()
  const kbDirRowAfter = document.querySelector('.gp-detail__files .gp-tree-row--dir')
  if (kbDirRowAfter) { kbDirRowAfter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await new Promise((r) => setTimeout(r, 120)) }
  result.treeChildVisibleAfterKeyReexpand = childVisible()
  // Commit detail action area: a create-tag button opens the tag dialog, which
  // carries the shared "trust the AI" hint. Close it before the file-diff test.
  const createTagBtn = [...document.querySelectorAll('.gp-detail__ops .gp-btn')].find((b) => (b.textContent || '').includes('overview.createTag'))
  result.hasCreateTagBtn = createTagBtn != null
  if (createTagBtn) { createTagBtn.click(); await new Promise((r) => setTimeout(r, 200)) }
  result.tagModalOpened = document.querySelector('.gp-modal--sm') !== null
  result.tagModalHint = (document.querySelector('.gp-modal--sm .gp-modal__hint')?.textContent || '') === 'ops.aiHint'
  const tagClose = document.querySelector('.gp-modal--sm .gp-modal__close')
  if (tagClose) { tagClose.click(); await new Promise((r) => setTimeout(r, 150)) }
  result.tagModalClosed = document.querySelector('.gp-modal--sm') === null
  // Commit-undo actions: revert opens a confirm (with the AI hint); reset opens
  // the mode dialog carrying soft/mixed/hard radios + the hard-reset gate.
  const revertBtn = [...document.querySelectorAll('.gp-detail__ops .gp-btn')].find((b) => (b.textContent || '').includes('overview.revert'))
  result.hasRevertBtn = revertBtn != null
  if (revertBtn) { revertBtn.click(); await new Promise((r) => setTimeout(r, 150)) }
  result.revertModalHint = (document.querySelector('.gp-modal--sm .gp-modal__hint')?.textContent || '') === 'ops.aiHint'
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  const resetBtn = [...document.querySelectorAll('.gp-detail__ops .gp-btn')].find((b) => (b.textContent || '').includes('overview.reset'))
  result.hasResetBtn = resetBtn != null
  if (resetBtn) { resetBtn.click(); await new Promise((r) => setTimeout(r, 150)) }
  result.resetModeCount = document.querySelectorAll('.gp-reset__mode').length
  // Pick hard → the acknowledgement appears and the confirm stays disabled until acked.
  const hardRadio = [...document.querySelectorAll('.gp-reset__mode')].find((m) => (m.textContent || '').includes('reset.modeHard'))?.querySelector('input')
  if (hardRadio) { hardRadio.click(); await new Promise((r) => setTimeout(r, 80)) }
  result.resetHardAck = document.querySelector('.gp-reset__ack') != null
  const resetConfirm = [...document.querySelectorAll('.gp-modal--sm .gp-modal__footer .gp-btn')].find((b) => (b.textContent || '').includes('reset.confirm'))
  result.resetConfirmDisabledBeforeAck = resetConfirm ? resetConfirm.disabled === true : false
  const ackCb = document.querySelector('.gp-reset__ack .gp-check')
  if (ackCb) { ackCb.click(); await new Promise((r) => setTimeout(r, 80)) }
  result.resetConfirmEnabledAfterAck = resetConfirm ? resetConfirm.disabled === false : false
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  result.resetModalClosed = document.querySelector('.gp-reset__modes') === null
  // Click a changed file → the diff modal opens (portaled to document.body).
  // Re-query: the collapse/expand round above re-rendered the tree, detaching
  // the row captured earlier.
  const freshFileRow = document.querySelector('.gp-detail__files .gp-tree-row .gp-status-badge')?.closest('.gp-tree-row') ?? null
  if (freshFileRow) { freshFileRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.hasModal = document.querySelector('.gp-modal') !== null
  result.modalHasDiff = document.querySelector('.gp-modal .gp-diff__unified') !== null
  result.modalWordSyntax = [...document.querySelectorAll('.gp-modal .gp-diff-word span')].some((el) => el.style.color.includes('--shiki-keyword'))
  // In-diff Find (Ctrl+F) inside the modal: open, search a token present in the
  // fixture diff, assert marks + count, then Esc dismisses Find (not the modal).
  const diffWrap = document.querySelector('.gp-modal .gp-diff__wrap')
  if (diffWrap) { Object.defineProperty(diffWrap, 'offsetParent', { configurable: true, get: () => document.body }) }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 60))
  result.diffFindOpened = document.querySelector('.gp-modal .gp-find__input') !== null
  const diffFindInput = document.querySelector('.gp-modal .gp-find__input')
  if (diffFindInput) {
    // Fixture .ts diff replaces "const count = 1" → "const count = 2"; "count"
    // appears on both sides in split-derived unified rows.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(diffFindInput, 'count')
    diffFindInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
  }
  result.diffFindHits = document.querySelectorAll('.gp-modal .gp-find-hit').length
  result.diffFindActive = document.querySelectorAll('.gp-modal .gp-find-hit--active').length
  result.diffFindCount = document.querySelector('.gp-modal .gp-find__count')?.textContent
  // Case toggle in the diff find: uppercase query matches by default, and
  // enabling Match case drops it to zero.
  if (diffFindInput) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(diffFindInput, 'COUNT')
    diffFindInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
  }
  result.diffFindCaseInsensitiveHits = document.querySelectorAll('.gp-modal .gp-find-hit').length
  document.querySelector('.gp-modal .gp-find__case')?.click()
  await new Promise((r) => setTimeout(r, 80))
  result.diffFindCaseSensitiveHits = document.querySelectorAll('.gp-modal .gp-find-hit').length
  document.querySelector('.gp-modal .gp-find__case')?.click()
  await new Promise((r) => setTimeout(r, 60))
  diffFindInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 60))
  result.diffFindClosedModalKept = document.querySelector('.gp-modal .gp-find__input') === null && document.querySelector('.gp-modal') !== null
  // Esc closes it.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await new Promise((r) => setTimeout(r, 200))
  result.modalClosedByEsc = document.querySelector('.gp-modal') === null
  // Reopen, then close via the close button.
  const reopenRow = document.querySelector('.gp-detail__files .gp-tree-row .gp-status-badge')?.closest('.gp-tree-row') ?? null
  if (reopenRow) { reopenRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  const closeBtn = document.querySelector('.gp-modal__bar .gp-icon-btn')
  if (closeBtn) { closeBtn.click(); await new Promise((r) => setTimeout(r, 200)) }
  result.modalClosedByBtn = document.querySelector('.gp-modal') === null
  document.querySelector('#pill .gp-pill')?.click()
  await new Promise((r) => setTimeout(r, 100))
  result.livePillJump = document.querySelector('.gp-tab--active')?.textContent?.includes('tab.changes') ?? false

  // Files tab: open it, the root tree lists entries; expand a dir; select a
  // text file → code preview; select an image → inline image pane.
  const filesTab = [...document.querySelectorAll('.gp-tab')].find((t) => (t.textContent || '').includes('tab.files'))
  if (filesTab) { filesTab.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.filesTreeRows = document.querySelectorAll('.gp-files__tree .gp-tree-row').length
  const cacheRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('cache'))
  const ignoredRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('ignored.log'))
  result.ignoredRowsDimmed = cacheRow?.classList.contains('gp-tree-row--ignored') && ignoredRow?.classList.contains('gp-tree-row--ignored') && getComputedStyle(cacheRow).opacity < 1
  result.folderIcon = cacheRow?.querySelector('[data-file-type]')?.getAttribute('data-file-type')
  const dirRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('src'))
  if (dirRow) { dirRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.filesTreeRowsAfterExpand = document.querySelectorAll('.gp-files__tree .gp-tree-row').length
  const txtRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('a.txt'))
  if (txtRow) { txtRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.filesCodeShown = document.querySelector('.gp-files__code') !== null
  result.txtRowSelected = txtRow?.classList.contains('gp-tree-row--active') === true
  // Selection styling is shared across the three list panes via --gp-select-*:
  // the active row rule references the vars, and the panel defines them from
  // business-primary. Assert both halves so the shared token can't silently
  // drift from the primary accent.
  result.selectionStyled = (() => {
    const rules = [...document.styleSheets].flatMap((sheet) => {
      try { return [...sheet.cssRules] } catch { return [] }
    })
    const rowUsesVar = rules.some((rule) => (rule.selectorText || '').includes('gp-tree-row--active')
      && /var\(--gp-select-bar\)/.test(rule.style.cssText) && /var\(--gp-select-bg\)/.test(rule.style.cssText))
    const panelDefinesToken = rules.some((rule) => (rule.selectorText || '').includes('.gp-panel')
      && /--gp-select-bar:[^;]*business-primary/.test(rule.style.cssText))
    return rowUsesVar && panelDefinesToken
  })()
  const tsRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('index.ts'))
  if (tsRow) { tsRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.officialCodeHighlight = [...document.querySelectorAll('.gp-files__code .gp-diff-cell span')].some((node) => node.style.color.includes('--shiki-keyword'))
  result.codeIconPath = tsRow?.querySelector('[data-file-type]')?.getAttribute('data-file-type')
  let copiedPath = null
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { copiedPath = text } } })
  document.querySelector('.gp-files__copy-path')?.click()
  await new Promise((r) => setTimeout(r, 100))
  result.copiedPath = copiedPath
  result.copyFeedback = document.querySelector('.gp-files__copy-path')?.textContent
  const pngRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('logo.png'))
  if (pngRow) { pngRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.filesImageShown = document.querySelector('.gp-files__image img') !== null
  // Image zoom: toolbar presence, pinch (ctrl+wheel) zooms, plain wheel is a
  // native-pan passthrough, double click returns to fit, fullscreen lightbox
  // opens from the bar and closes on Escape. Queries are scoped to the Files
  // zoom root — the diff view renders its own zoom bars.
  const zoomRoot = document.querySelector('.gp-files__image')?.parentElement ?? null
  const zoomImg = zoomRoot?.querySelector('img') ?? null
  const zoomRect = () => Math.round(zoomImg?.getBoundingClientRect().width ?? -1)
  result.zoomBarShown = zoomRoot?.querySelector('.gp-zoom__bar') !== null
  result.zoomPctBefore = zoomRoot?.querySelector('.gp-zoom__pct')?.textContent ?? ''
  const zoomW0 = zoomRect()
  zoomImg?.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 120))
  // Rendered width, not the inline style: a flex-shrink regression once kept the
  // inline width while the picture itself never grew.
  result.zoomWheelZoomed = zoomRect() > zoomW0
  result.zoomPctAfter = zoomRoot?.querySelector('.gp-zoom__pct')?.textContent ?? ''
  const zoomW1 = zoomRect()
  zoomImg?.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 80))
  result.zoomPlainWheelNoop = zoomRect() === zoomW1
  zoomImg?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 80))
  result.zoomDblClickFit = zoomRect() === (zoomImg?.naturalWidth ?? -2)
  result.zoomFitPressed = zoomRoot?.querySelector('.gp-zoom__btn[aria-pressed]')?.getAttribute('aria-pressed') === 'true'
  // Fullscreen is a zoom-bar control now: an inline click must not open it, or
  // the first click of every double click would.
  zoomImg?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 320))
  result.zoomImgClickNoFullscreen = document.querySelector('.gp-zl-backdrop') === null
  zoomRoot?.querySelector('button[aria-label="files.zoomFullscreen"]')?.click()
  await new Promise((r) => setTimeout(r, 120))
  result.zoomLightboxShown = document.querySelector('.gp-zl-backdrop') !== null
    && document.querySelector('.gp-zl-backdrop')?.getAttribute('aria-modal') === 'true'
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await new Promise((r) => setTimeout(r, 120))
  result.zoomLightboxClosed = document.querySelector('.gp-zl-backdrop') === null
  // A press on the lightbox's own empty area closes it (the frame covers the
  // mask, so the mask alone would leave most of the visible background inert);
  // a press on the image keeps it open.
  zoomRoot?.querySelector('button[aria-label="files.zoomFullscreen"]')?.click()
  await new Promise((r) => setTimeout(r, 120))
  document.querySelector('.gp-zl-viewport img')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  result.zoomLightboxImagePressKeeps = document.querySelector('.gp-zl-backdrop') !== null
  document.querySelector('.gp-zl-viewport')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  result.zoomLightboxBackdropCloses = document.querySelector('.gp-zl-backdrop') === null
  // Fit-label honesty: zoom in, resize the panel while zoomed (the ResizeObserver
  // must not record the numeric scale as a fit value), then switch back to Fit —
  // the percentage shown has to match the size actually rendered.
  zoomRoot?.querySelector('button[aria-label="files.zoomIn"]')?.click()
  await new Promise((r) => setTimeout(r, 80))
  result.zoomInZoomed = zoomRect() > (zoomImg?.naturalWidth ?? Number.MAX_SAFE_INTEGER)
  const zoomPrevWidth = panelHost.style.width
  panelHost.style.width = '700px'
  await new Promise((r) => setTimeout(r, 200))
  zoomRoot?.querySelector('.gp-zoom__btn[aria-pressed]')?.click() // Fit
  await new Promise((r) => setTimeout(r, 150))
  const zoomFitLabel = zoomRoot?.querySelector('.gp-zoom__pct')?.textContent ?? ''
  const zoomFitReal = zoomImg === null ? '' : `${Math.round((zoomRect() / zoomImg.naturalWidth) * 100)}%`
  result.zoomFitLabelHonest = zoomFitLabel !== '' && zoomFitLabel === zoomFitReal
  // Switching images shows the new picture at fit, never the previous file's
  // zoom level. Today the loading placeholder unmounts the component between
  // files; this pins the user-visible contract for any future in-place src swap
  // (e.g. an ImageCompare pane fed a new URL without a loading gap).
  zoomRoot?.querySelector('button[aria-label="files.zoomIn"]')?.click()
  await new Promise((r) => setTimeout(r, 80))
  const iconRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('icon.png'))
  if (iconRow) { iconRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  const zoomImgAfterSwitch = document.querySelector('.gp-files__image img')
  result.zoomResetsOnNewImage = zoomImgAfterSwitch !== null
    && zoomImgAfterSwitch.style.width === ''
    && Math.round(zoomImgAfterSwitch.getBoundingClientRect().width) === zoomImgAfterSwitch.naturalWidth
    && document.querySelector('.gp-files__image')?.parentElement?.querySelector('.gp-zoom__btn[aria-pressed]')?.getAttribute('aria-pressed') === 'true'
  panelHost.style.width = zoomPrevWidth
  await new Promise((r) => setTimeout(r, 120))
  // Mouse drag-to-pan: a plain mouse has no horizontal wheel, so a zoomed image
  // must be draggable. big.png at 100% is wider than the pane, which makes the
  // viewport actually scrollable (a drag needs somewhere to go).
  panelHost.style.width = '800px'
  await new Promise((r) => setTimeout(r, 150))
  // Fit-label tracking (the ResizeObserver path) needs a *width-constrained*
  // image: a pane-width change moves wide.png's fit ratio, while the square
  // fixture is limited by the pane height and would keep the same percentage.
  const wideRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('wide.png'))
  if (wideRow) { wideRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  const wideRoot = document.querySelector('.gp-files__image')?.parentElement ?? null
  const wideImg = wideRoot?.querySelector('img') ?? null
  const wideLabel = () => wideRoot?.querySelector('.gp-zoom__pct')?.textContent ?? ''
  const wideReal = () => (wideImg === null ? '' : `${Math.round((wideImg.getBoundingClientRect().width / wideImg.naturalWidth) * 100)}%`)
  const fitNarrow = { label: wideLabel(), real: wideReal() }
  panelHost.style.width = '1000px'
  await new Promise((r) => setTimeout(r, 250))
  const fitWide = { label: wideLabel(), real: wideReal() }
  result.zoomFitTracksViewport = fitNarrow.label !== '' && fitNarrow.label === fitNarrow.real
    && fitWide.label === fitWide.real && fitNarrow.label !== fitWide.label
  panelHost.style.width = '800px'
  await new Promise((r) => setTimeout(r, 200))
  const bigImgRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('big.png'))
  if (bigImgRow) { bigImgRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  const panRoot = document.querySelector('.gp-files__image')?.parentElement ?? null
  const panVp = panRoot?.querySelector('.gp-zoom__scroll') ?? null
  const panImg = panRoot?.querySelector('img') ?? null
  result.zoomPanImgNotDraggable = panImg?.getAttribute('draggable') === 'false'
  result.zoomFitCursor = panImg === null ? '' : getComputedStyle(panImg).cursor
  panRoot?.querySelector('.gp-zoom__pct')?.click() // actual size: 800px wide
  await new Promise((r) => setTimeout(r, 150))
  result.zoomGrabCursor = panImg === null ? '' : getComputedStyle(panImg).cursor
  // Zooming past 100% must really grow the rendered picture: as a flex item the
  // image used to stay pinned at its natural width while the label kept climbing
  // (and the anchor correction then just scrolled it).
  const naturalW = panImg?.naturalWidth ?? Number.MAX_SAFE_INTEGER
  panRoot?.querySelector('button[aria-label="files.zoomIn"]')?.click()
  await new Promise((r) => setTimeout(r, 150))
  result.zoomAboveNaturalRendered = Math.round(panImg?.getBoundingClientRect().width ?? 0) > naturalW
  result.zoomAboveNaturalScrolls = panVp !== null && panVp.scrollWidth > Math.max(panVp.clientWidth, naturalW)
  panRoot?.querySelector('.gp-zoom__pct')?.click() // back to 100% for the pan test
  await new Promise((r) => setTimeout(r, 150))
  if (panVp !== null) {
    result.zoomPanScrollable = panVp.scrollWidth > panVp.clientWidth && panVp.scrollHeight > panVp.clientHeight
    // Start mid-range so the drag has room in both directions.
    panVp.scrollLeft = Math.round((panVp.scrollWidth - panVp.clientWidth) / 2)
    panVp.scrollTop = Math.round((panVp.scrollHeight - panVp.clientHeight) / 2)
  }
  const panRect = panVp?.getBoundingClientRect() ?? null
  const panBefore = { left: panVp?.scrollLeft ?? 0, top: panVp?.scrollTop ?? 0 }
  const panPctBefore = panRoot?.querySelector('.gp-zoom__pct')?.textContent ?? ''
  if (panVp !== null && panRect !== null) {
    // Synthetic pointer input mirrors a left-button mouse drag: a press, moves
    // past the 3px threshold, then release. Real trusted input is exercised
    // after this evaluate block, so both the handler logic and the browser's
    // own input path are covered.
    const press = (type, x, y, buttons, pointerType = 'mouse') => panVp.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType, button: 0, buttons, clientX: x, clientY: y,
    }))
    const cx = panRect.left + panRect.width / 2
    const cy = panRect.top + panRect.height / 2
    press('pointerdown', cx, cy, 1)
    for (const step of [10, 30, 50]) press('pointermove', cx - step, cy - Math.round(step / 2), 1)
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 0, clientX: cx - 50, clientY: cy - 25,
    }))
  }
  await new Promise((r) => setTimeout(r, 200))
  const panAfter = { left: panVp?.scrollLeft ?? 0, top: panVp?.scrollTop ?? 0 }
  // Dragging left/up scrolls right/down: the content follows the pointer.
  result.zoomDragPanned = panAfter.left > panBefore.left && panAfter.top > panBefore.top
  // A drag is not a double click: the zoom level must survive it untouched.
  result.zoomDragKeepsMode = (panRoot?.querySelector('.gp-zoom__pct')?.textContent ?? 'x') === panPctBefore
  // Touch and pen keep their native behaviour: their presses never start a pan.
  if (panVp !== null && panRect !== null) {
    const touchBefore = { left: panVp.scrollLeft, top: panVp.scrollTop }
    const cx = panRect.left + panRect.width / 2
    const cy = panRect.top + panRect.height / 2
    const touch = (type, x, y, buttons) => panVp.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, pointerType: 'touch', button: 0, buttons, clientX: x, clientY: y,
    }))
    touch('pointerdown', cx, cy, 1)
    for (const step of [10, 40, 70]) touch('pointermove', cx - step, cy - step, 1)
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'touch', button: 0, buttons: 0, clientX: cx - 70, clientY: cy - 70,
    }))
    await new Promise((r) => setTimeout(r, 80))
    result.zoomTouchNotTakenOver = panVp.scrollLeft === touchBefore.left && panVp.scrollTop === touchBefore.top
  }
  // Safari's older pinch path: gesture events carry a cumulative scale.
  if (panVp !== null && panRect !== null) {
    const gestureWidth = () => Math.round(panImg?.getBoundingClientRect().width ?? 0)
    const beforeGesture = gestureWidth()
    const gesture = (type, scale) => {
      const ev = new Event(type, { bubbles: true, cancelable: true })
      ev.scale = scale
      ev.clientX = panRect.left + panRect.width / 2
      ev.clientY = panRect.top + panRect.height / 2
      panVp.dispatchEvent(ev)
    }
    gesture('gesturestart', 1)
    gesture('gesturechange', 1.5)
    gesture('gestureend', 1.5)
    await new Promise((r) => setTimeout(r, 150))
    result.zoomGestureScales = gestureWidth() > beforeGesture
    panRoot?.querySelector('.gp-zoom__btn[aria-pressed]')?.click() // back to fit
    await new Promise((r) => setTimeout(r, 120))
  }
  panelHost.style.width = zoomPrevWidth
  await new Promise((r) => setTimeout(r, 120))
  let finishCopy
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise((resolve) => { finishCopy = resolve }) } })
  document.querySelector('.gp-files__copy-path')?.click()
  const mdRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('README.md'))
  if (mdRow) { mdRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  finishCopy?.()
  await new Promise((r) => setTimeout(r, 50))
  result.copyFeedbackReset = document.querySelector('.gp-files__copy-path')?.textContent === 'files.copyPath'
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('clipboard denied') } } })
  document.querySelector('.gp-files__copy-path')?.click()
  await new Promise((r) => setTimeout(r, 50))
  result.copyDeniedFeedback = document.querySelector('.gp-files__copy-path')?.textContent === 'files.pathCopyFailed'
  // Markdown defaults to the rendered view; switch to source, then back.
  result.markdownRenderedDefault = document.querySelector('[data-markdown-rendered]')?.textContent === 'Hello Markdown' && document.querySelector('.gp-files__code') === null
  const sourceBtn = [...document.querySelectorAll('.gp-files__mode-btn')].find((b) => b.textContent === 'files.source')
  if (sourceBtn) { sourceBtn.click(); await new Promise((r) => setTimeout(r, 100)) }
  result.markdownSourceShown = document.querySelector('.gp-files__code') !== null && document.querySelector('[data-markdown-rendered]') === null
  const renderBtn = [...document.querySelectorAll('.gp-files__mode-btn')].find((b) => b.textContent === 'files.render')
  if (renderBtn) { renderBtn.click(); await new Promise((r) => setTimeout(r, 100)) }
  result.markdownRenderRestored = document.querySelector('[data-markdown-rendered]')?.textContent === 'Hello Markdown'
  // HTML defaults to source (no auto-run); switching to render mounts a
  // sandboxed iframe that carries the page bytes but drops same-origin.
  const htmlRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('page.html'))
  if (htmlRow) { htmlRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.htmlSourceDefault = document.querySelector('.gp-files__code') !== null && document.querySelector('.gp-files__html') === null
  const htmlRenderBtn = [...document.querySelectorAll('.gp-files__mode-btn')].find((b) => b.textContent === 'files.render')
  if (htmlRenderBtn) { htmlRenderBtn.click(); await new Promise((r) => setTimeout(r, 100)) }
  const htmlFrame = document.querySelector('.gp-files__html')
  result.htmlRenderShown = htmlFrame !== null && document.querySelector('.gp-files__code') === null
  result.htmlFrameSandbox = htmlFrame?.getAttribute('sandbox') ?? null
  result.htmlFrameHasSrcdoc = (htmlFrame?.getAttribute('srcdoc') || '').includes('Hello HTML')
  // Large-file source guards: highlighting is skipped (a notice shows, no
  // syntax spans) and the over-long line is truncated with a marker.
  const bigRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('big.js'))
  if (bigRow) { bigRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.bigHighlightOff = document.querySelector('.gp-files__note')?.textContent === 'files.highlightOff'
  result.bigNoSyntaxSpans = document.querySelector('.gp-files__code .gp-diff-cell span[style]') === null
  result.bigLineTruncated = [...document.querySelectorAll('.gp-files__trunc')].some((n) => n.textContent === 'files.lineTruncated')
  // Virtualization: the 5101-line big.js mounts only a windowed subset of rows,
  // not all of them, while the spacer height reflects the full line count.
  result.bigMountedRows = document.querySelectorAll('.gp-files__row').length
  result.bigTotalLines = 5101
  const virtGrid = document.querySelector('.gp-files__single--virt')
  result.bigSpacerHeight = virtGrid ? parseInt(virtGrid.style.height || '0', 10) : 0
  // In-panel Find (Ctrl+F): open on a text file, type a query, assert match
  // count + highlighted hits + next-match navigation, then Esc closes it.
  const findRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('a.txt'))
  if (findRow) { findRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  const codeEl = document.querySelector('.gp-files__code')
  Object.defineProperty(codeEl, 'offsetParent', { configurable: true, get: () => document.body })
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 60))
  result.findOpened = document.querySelector('.gp-find__input') !== null
  const findInput = document.querySelector('.gp-find__input')
  if (findInput) {
    // Fixture a.txt content is "const x = 1\nconst y = 2\n" → two "const".
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(findInput, 'const')
    findInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
  }
  result.findHitCount = document.querySelectorAll('.gp-find-hit').length
  result.findActiveCount = document.querySelectorAll('.gp-find-hit--active').length
  result.findCountLabel = document.querySelector('.gp-find__count')?.textContent
  document.querySelector('.gp-find__btn[title="files.findNext"]')?.click()
  await new Promise((r) => setTimeout(r, 60))
  result.findCountAfterNext = document.querySelector('.gp-find__count')?.textContent
  if (findInput) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(findInput, 'zzzznotfound')
    findInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
  }
  result.findNoMatchLabel = document.querySelector('.gp-find__count')?.textContent
  // Case sensitivity: default is insensitive, so "CONST" matches the lowercase
  // "const"; toggling Match case drops the matches to zero.
  if (findInput) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(findInput, 'CONST')
    findInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
  }
  result.findCaseInsensitiveHits = document.querySelectorAll('.gp-find-hit').length
  document.querySelector('.gp-find__case')?.click()
  await new Promise((r) => setTimeout(r, 80))
  result.findCaseButtonActive = document.querySelector('.gp-find__case')?.classList.contains('gp-find__case--active') === true
  result.findCaseSensitiveHits = document.querySelectorAll('.gp-find-hit').length
  result.findCaseSensitiveLabel = document.querySelector('.gp-find__count')?.textContent
  // Toggle case back off so the Esc-close assertion below starts from a clean
  // insensitive state.
  document.querySelector('.gp-find__case')?.click()
  await new Promise((r) => setTimeout(r, 60))
  findInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 60))
  result.findClosed = document.querySelector('.gp-find__input') === null

  // Sticky restore: on the Files tab with `src` expanded and a file selected,
  // a view-tab switch unmounts the panel; returning within the window must
  // restore the Files tab, the expanded dir, and the selection (not reset to
  // the root). Simulate the switch by unmounting and remounting the view root.
  result.preUnmountFilesActive = document.querySelector('.gp-tab--active')?.textContent?.includes('tab.files') ?? false
  result.preUnmountSelected = document.querySelector('.gp-files__tree .gp-tree-row--active')?.textContent?.trim() ?? null
  result.preUnmountChildVisible = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].some((r) => (r.textContent || '').includes('a.txt'))
  viewRoot.unmount()
  await new Promise((r) => setTimeout(r, 50))
  const viewRoot2 = ReactDOM.createRoot(document.getElementById('panel'))
  viewRoot2.render(viewEntry.component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 500))
  result.restoredFilesActive = document.querySelector('.gp-tab--active')?.textContent?.includes('tab.files') ?? false
  result.restoredChildVisible = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].some((r) => (r.textContent || '').includes('a.txt'))
  result.restoredSelected = document.querySelector('.gp-files__tree .gp-tree-row--active')?.textContent?.trim() ?? null
  result.restoredPreviewShown = document.querySelector('.gp-files__code, .gp-files__markdown, .gp-files__image') !== null

  // Work-tree generation: a branch switch replaces every file under the root, so
  // the Files tab must drop its preserved state and re-list the root instead of
  // serving the previous branch's tree from its sticky cache.
  const filesTabBtn = [...document.querySelectorAll('.gp-tab')].find((t) => (t.textContent || '').includes('tab.files'))
  const overviewTabBtn = [...document.querySelectorAll('.gp-tab')].find((t) => (t.textContent || '').includes('tab.overview'))
  overviewTabBtn?.click()
  await wait(400)
  const rootListsBefore = fileQueries.filter((p) => p === '').length
  // The branch tree loads async; wait for the row's button before using it.
  for (let i = 0; i < 20 && switchBtnOf('feature') === null; i += 1) await wait(50)
  switchBtnOf('feature')?.click()
  await wait(80)
  ;[...document.querySelectorAll('.gp-modal__footer .gp-btn')].find((b) => (b.textContent || '').includes('switch.confirm'))?.click()
  await wait(250)
  result.switchRelistsFiles = fileQueries.filter((p) => p === '').length > rootListsBefore
  result.switchClearsFileSelection = document.querySelector('.gp-files__tree .gp-tree-row--active') === null
  // Back to Files for the real-input zoom phase (it needs a visible pane).
  filesTabBtn?.click()
  await wait(200)
  return result
}, SNAP)

// Real (trusted) mouse input for drag-to-pan: the in-page block above drives the
// handlers with synthetic PointerEvents, which cannot prove the browser's own
// input path reaches them — nor that zooming past 100% really resizes the picture.
const realInput = await (async () => {
  const dragAt = await page.evaluate(async () => {
    const row = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('big.png'))
    row?.click()
    await new Promise((r) => setTimeout(r, 400))
    const root = document.querySelector('.gp-files__image')?.parentElement
    root?.querySelector('.gp-zoom__pct')?.click() // 100%
    await new Promise((r) => setTimeout(r, 150))
    root?.querySelector('button[aria-label="files.zoomIn"]')?.click() // 125% > natural
    await new Promise((r) => setTimeout(r, 150))
    const rect = document.querySelector('.gp-files__image')?.getBoundingClientRect()
    return rect === undefined ? null : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  if (dragAt === null) return null
  const read = () => page.evaluate(() => {
    const vp = document.querySelector('.gp-files__image')
    const img = vp?.querySelector('img')
    return {
      left: vp?.scrollLeft ?? 0,
      top: vp?.scrollTop ?? 0,
      rendered: Math.round(img?.getBoundingClientRect().width ?? 0),
      natural: img?.naturalWidth ?? 0,
      pct: vp?.parentElement?.querySelector('.gp-zoom__pct')?.textContent ?? '',
      lightbox: document.querySelector('.gp-zl-backdrop') !== null,
    }
  })
  const before = await read()
  await page.mouse.move(dragAt.x, dragAt.y)
  await page.mouse.down()
  await page.mouse.move(dragAt.x - 60, dragAt.y - 40, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  return { before, after: await read() }
})()

await browser.close()

try {
  assert.equal(out.error, undefined, out.error)
  assert.deepEqual(out.slots.sort(), ['conversation.input.left', 'conversation.view', 'plugins.bundle.config'])
  assert.equal(out.pillHasDirty, true, 'dirty pill shows the orange git class')
  assert.equal(out.viewOrder, 30, 'panel is ordered after Chat/Trajectory')
  assert.equal(out.tabCount, 3, 'three sub-tabs')
  assert.equal(out.dirtyDefault, true, 'opening a dirty Git workspace defaults to Changes')
  assert.equal(out.noInitialFileListing, true, 'dirty default does not fetch hidden file-browser data')
  assert.equal(out.fontDefault, '13px', 'panel keeps the existing default font size')
  assert.equal(out.fontIncreased, '14px', 'font control increases panel text size')
  assert.equal(out.fontStored, '1', 'font adjustment persists locally')
  assert.equal(out.fontReset, '13px', 'font reset restores default size')
  assert.equal(out.wideLayout, 'wide', 'a wide panel uses the three-column wide layout')
  assert.equal(out.wideShowsControls, true, 'a wide panel shows the trailing controls')
  assert.equal(out.wideShowsLabel, true, 'a wide panel shows the tab labels')
  assert.equal(out.narrowLayout, 'compact', 'a phone-width panel switches to the compact layout')
  assert.equal(out.narrowShowsControls, true, 'the compact layout keeps the trailing controls (wrapped, not hidden)')
  assert.equal(out.narrowKeepsLabel, true, 'the compact layout still keeps the tab labels')
  assert.equal(out.tinyHidesLabel, true, 'a very narrow panel drops the tab labels')
  assert.equal(out.tinyKeepsIcon, true, 'a very narrow panel keeps the tab icons')
  assert.equal(out.tinyShowsControls, true, 'a very narrow compact panel still keeps the trailing controls')
  assert.equal(out.restoresLayout, 'wide', 'widening the panel restores the wide layout')
  assert.equal(out.restoresLabel, true, 'widening the panel restores the tab labels')
  assert.equal(out.hasStats, true, 'stats bar rendered')
  assert.equal(out.hasCommitBox, true, 'commit box rendered')
  assert.equal(out.hasAmend, true, 'amend checkbox present')
  assert.equal(out.hasStashBtn, true, 'stash button present in the changes toolbar')
  assert.equal(out.stashRows, 1, 'the stash list expands to its one entry')
  assert.equal(out.stashDropHint, true, 'the stash drop confirm shows the AI hint')
  assert.equal(out.stashDropEscClosed, true, 'Escape dismisses the stash drop confirm')
  assert.equal(out.stashPushOpened, true, 'the stash push dialog opens from the toolbar button')
  assert.equal(out.stashPushHint, true, 'the stash push dialog shows the AI hint')
  assert.equal(out.stashPushEscClosed, true, 'Escape dismisses the stash push dialog')
  assert.equal(out.commitDisabledEmpty, true, 'commit button is disabled without a message')
  assert.equal(out.commitEnabledWithMessage, true, 'commit button enables once a message is typed')
  assert.equal(out.commitPrimaryHoverKeepsColor, true, 'primary button defines a hover style that keeps its color')
  assert.equal(out.suggestLocksMessage, true, 'commit message box is read-only while AI suggest is in flight')
  assert.equal(out.suggestLocksAmend, true, 'amend toggle is disabled while AI suggest is in flight')
  assert.equal(out.suggestUnlocksMessage, true, 'message box and amend unlock once the suggestion lands')
  assert.equal(out.suggestFilled, true, 'the suggestion fills the message box')
  assert.equal(out.changeRows, 5, 'five change rows (three text + one image + one svg)')
  assert.equal(out.imagePanes, 2, 'image diff renders both panes in split mode')
  assert.equal(out.imageImgs, 2, 'both panes render an image')
  assert.equal(out.imageSrcOk, true, 'panes carry data URL images')
  assert.deepEqual(out.imageHeads, ['diff.before', 'diff.after'], 'pane labels before/after')
  assert.equal(out.imageSingle, true, 'after-mode collapses to one pane')
  assert.equal(out.imageSingleHead, 'diff.after', 'the single pane keeps its label')
  assert.equal(out.svgHasToggle, true, 'an SVG diff shows the render/source toggle bar')
  assert.equal(out.svgRenderDefault, true, 'an SVG diff defaults to the rendered comparison')
  assert.equal(out.svgSourceShowsDiff, true, 'switching an SVG to source shows the text diff')
  assert.equal(out.svgRenderRestored, true, 'switching an SVG back to render restores the comparison')
  assert.equal(out.hasBranchList, true, 'branch list rendered on overview')
  assert.equal(out.statusBarShown, true, 'the wide left column renders the status bar')
  assert.equal(out.statusRepoHref, 'https://github.com/owner/repo', 'the status bar links to the parsed GitHub repo page')
  assert.equal(out.statusSyncedShown, true, 'a synced branch shows the up-to-date state')
  assert.equal(out.statusNoPullWhenSynced, true, 'a synced branch offers no pull button')
  assert.equal(out.statusNoPushWhenSynced, true, 'a synced branch offers no push button')
  assert.equal(out.statusAheadPushShown, true, 'a strictly-ahead branch offers a push button')
  assert.equal(out.statusPushConfirmOpened, true, 'push opens a confirm dialog')
  assert.equal(out.statusPushScopeShown, true, 'the push confirm shows the outgoing scope')
  assert.equal(out.statusNoUpstreamNoPush, true, 'a branch without an upstream offers no push button')
  assert.equal(out.statusPublishShown, true, 'a branch without an upstream offers a publish button')
  assert.equal(out.statusPublishConfirmOpened, true, 'publish opens a second-reminder confirm dialog')
  assert.equal(out.searchFullHint, true, 'a wide search box shows the full message/hash hint')
  assert.equal(out.searchShortHint, true, 'a narrow search box drops the hint to the short placeholder')
  assert.equal(out.searchHintRestored, true, 'widening the search box restores the full hint')
  assert.equal(out.commitRows, 2, 'two commit rows')
  assert.equal(out.hasGraph, true, 'commit graph svg rendered')
  assert.equal(out.hasDetailFileRow, true, 'selecting a commit lists its changed files')
  assert.equal(out.hasChangeSummary, true, 'commit detail shows a change summary row')
  assert.equal(out.summaryHasFileCount, true, 'summary carries the file-count label')
  assert.equal(out.summaryAdd, '+12', 'summary shows added lines')
  assert.equal(out.summaryDel, '\u22124', 'summary shows deleted lines')
  assert.equal(out.treeDirRowShown, true, 'changed-file tree shows a folder row')
  assert.equal(out.treeChildVisibleDefault, true, 'folder is expanded by default')
  assert.equal(out.treeDirExpandedDefault, true, 'folder row reports aria-expanded=true by default')
  assert.equal(out.treeChildHiddenAfterCollapse, true, 'clicking the folder collapses its children')
  assert.equal(out.treeDirCollapsedAttr, true, 'collapsed folder reports aria-expanded=false')
  assert.equal(out.treeChildVisibleAfterReexpand, true, 'clicking again re-expands the folder')
  assert.equal(out.treeDirFocusable, true, 'folder row is keyboard-focusable (tabIndex 0)')
  assert.equal(out.treeChildHiddenAfterKeyToggle, true, 'Enter on the folder collapses it')
  assert.equal(out.treeChildVisibleAfterKeyReexpand, true, 'Enter again re-expands it')
  assert.equal(out.hasCreateTagBtn, true, 'commit detail shows a create-tag action')
  assert.equal(out.tagModalOpened, true, 'the create-tag dialog opens')
  assert.equal(out.tagModalHint, true, 'the create-tag dialog shows the AI hint')
  assert.equal(out.tagModalClosed, true, 'the create-tag dialog closes via its close button')
  assert.equal(out.hasRevertBtn, true, 'commit detail shows a revert action')
  assert.equal(out.revertModalHint, true, 'the revert confirm shows the AI hint')
  assert.equal(out.hasResetBtn, true, 'commit detail shows a reset action')
  assert.equal(out.resetModeCount, 3, 'the reset dialog offers soft/mixed/hard')
  assert.equal(out.resetHardAck, true, 'hard mode reveals the acknowledgement')
  assert.equal(out.resetConfirmDisabledBeforeAck, true, 'hard reset confirm is disabled until acknowledged')
  assert.equal(out.resetConfirmEnabledAfterAck, true, 'acknowledging enables the hard reset confirm')
  assert.equal(out.resetModalClosed, true, 'Escape dismisses the reset dialog')
  assert.equal(out.hasModal, true, 'clicking a file opens the diff modal')
  assert.equal(out.modalHasDiff, true, 'the modal renders a unified diff (default view)')
  assert.equal(out.modalWordSyntax, true, 'word emphasis retains DSH syntax colors')
  assert.equal(out.diffFindOpened, true, 'Ctrl+F opens Find inside the diff modal')
  assert.ok(out.diffFindHits >= 1, 'the diff Find highlights matches')
  assert.equal(out.diffFindActive, 1, 'exactly one diff match is the active hit')
  assert.ok(/^1\/\d+$/.test(out.diffFindCount || ''), 'the diff Find shows an active/total count')
  assert.ok(out.diffFindCaseInsensitiveHits >= 1, 'diff Find is case-insensitive by default: COUNT matches count')
  assert.equal(out.diffFindCaseSensitiveHits, 0, 'enabling Match case in the diff Find drops mismatched-case matches')
  assert.equal(out.diffFindClosedModalKept, true, 'Esc closes diff Find without closing the modal')
  assert.equal(out.modalClosedByEsc, true, 'Esc closes the modal')
  assert.equal(out.modalClosedByBtn, true, 'the close button closes the modal')
  assert.equal(out.livePillJump, true, 'pill jump still takes the active panel to Changes')
  assert.ok(out.filesTreeRows >= 3, 'files tab lists the root directory entries')
  assert.equal(out.ignoredRowsDimmed, true, 'Git ignored files and directories appear translucent')
  assert.equal(out.folderIcon, 'folder', 'folder rows use the official folder glyph')
  assert.ok(out.filesTreeRowsAfterExpand > out.filesTreeRows, 'expanding a directory reveals its children')
  assert.equal(out.filesCodeShown, true, 'selecting a text file shows the code preview')
  assert.equal(out.txtRowSelected, true, 'the selected file row carries the active class')
  assert.equal(out.selectionStyled, true, 'the active file row has a distinct primary-tinted highlight')
  assert.equal(out.officialCodeHighlight, true, 'code preview renders syntax spans from the DSH highlighter')
  assert.equal(out.codeIconPath, 'src/index.ts', 'code file glyph receives its relative path for official type classification')
  assert.equal(out.copiedPath, 'src/index.ts', 'preview copies the selected file path relative to browse root')
  assert.equal(out.copyFeedback, 'files.pathCopied', 'copy button confirms successful clipboard write')
  assert.equal(out.copyFeedbackReset, true, 'late copy of previous file cannot change current file feedback')
  assert.equal(out.copyDeniedFeedback, true, 'clipboard denial shows an actionable failure state')
  assert.equal(out.filesImageShown, true, 'selecting an image shows the inline image preview')
  assert.equal(out.zoomDiffBars, 2, 'each diff image pane renders its own zoom bar')
  assert.equal(out.zoomBarShown, true, 'the file preview shows the zoom bar')
  assert.equal(out.zoomPctBefore, '100%', 'the fit label starts at the fit percentage')
  assert.equal(out.zoomWheelZoomed, true, 'ctrl+wheel (pinch) zooms the image')
  assert.equal(out.zoomPctAfter, '120%', 'a pinch step applies the 1.2x scale factor')
  assert.equal(out.zoomPlainWheelNoop, true, 'a plain wheel leaves zoom alone so panning stays native')
  assert.equal(out.zoomDblClickFit, true, 'double click returns to fit')
  assert.equal(out.zoomFitPressed, true, 'fit reports aria-pressed while active')
  assert.equal(out.zoomLightboxShown, true, 'the fullscreen lightbox opens')
  assert.equal(out.zoomLightboxClosed, true, 'Escape closes the lightbox')
  assert.equal(out.zoomLightboxImagePressKeeps, true, 'pressing the lightbox image keeps it open')
  assert.equal(out.zoomLightboxBackdropCloses, true, 'pressing the lightbox empty area closes it')
  assert.equal(out.zoomInZoomed, true, 'the zoom bar steps the zoom level up')
  assert.equal(out.zoomFitLabelHonest, true, 'after resizing while zoomed, the fit label matches the rendered size')
  assert.equal(out.zoomResetsOnNewImage, true, 'switching images resets the zoom instead of carrying it over')
  assert.equal(out.zoomFitTracksViewport, true, 'the fit label tracks a viewport resize at the size actually rendered')
  assert.equal(out.zoomAboveNaturalRendered, true, 'zooming past 100% really grows the rendered image, not just the label')
  assert.equal(out.zoomAboveNaturalScrolls, true, 'zooming past 100% extends the scrollable area instead of fake-panning')
  assert.equal(out.zoomImgClickNoFullscreen, true, 'a click on the image does not open the lightbox (fullscreen lives in the zoom bar)')
  assert.equal(out.zoomPanScrollable, true, 'a zoomed image overflows its viewport, so it can be panned')
  assert.equal(out.zoomPanImgNotDraggable, true, 'the image opts out of the browser native drag so a mouse drag pans instead')
  assert.equal(out.zoomFitCursor, 'zoom-in', 'the fit viewport advertises click-to-zoom, not a drag')
  assert.equal(out.zoomGrabCursor, 'grab', 'the zoomed viewport advertises drag-to-pan')
  assert.equal(out.zoomDragPanned, true, 'dragging with the mouse pans the zoomed image')
  assert.equal(out.zoomDragKeepsMode, true, 'a drag never doubles as a double click that changes the zoom')
  assert.equal(out.zoomTouchNotTakenOver, true, 'touch presses keep native scrolling instead of being taken over')
  assert.equal(out.zoomGestureScales, true, "Safari's gesture events scale the image")
  assert.equal(out.zoomDiffPanesIndependent, true, 'each comparison pane zooms on its own')
  assert.equal(out.zoomDiffResetsOnFileSwitch, true, 'a new diff file drops the panes\u2019 zoom instead of carrying it over')
  assert.equal(out.markdownRenderedDefault, true, 'Markdown defaults to the rendered view')
  assert.equal(out.markdownSourceShown, true, 'source button shows the code view')
  assert.equal(out.markdownRenderRestored, true, 'render button restores official MarkdownText')
  assert.equal(out.htmlSourceDefault, true, 'HTML defaults to the source view, never auto-rendered')
  assert.equal(out.htmlRenderShown, true, 'switching HTML to render mounts the preview iframe')
  assert.equal(out.htmlFrameSandbox, 'allow-scripts', 'the HTML iframe runs scripts but stays a unique opaque origin (no allow-same-origin)')
  assert.equal(out.htmlFrameHasSrcdoc, true, 'the HTML iframe carries the page bytes via srcdoc (no extra fetch)')
  assert.equal(out.bigHighlightOff, true, 'a large text file skips highlighting and shows the notice')
  assert.equal(out.bigNoSyntaxSpans, true, 'a large text file renders plain text (no syntax spans)')
  assert.equal(out.bigLineTruncated, true, 'an over-long line is truncated with a marker')
  assert.ok(out.bigMountedRows > 0 && out.bigMountedRows < out.bigTotalLines, `virtualized: mounts a window (${out.bigMountedRows}), not all ${out.bigTotalLines} rows`)
  assert.equal(out.bigSpacerHeight, out.bigTotalLines * 20, 'the virtual spacer height reflects the full line count')
  assert.equal(out.findOpened, true, 'Ctrl+F opens the in-panel find while the preview is visible')
  assert.equal(out.findHitCount, 2, 'the query highlights every match in the file')
  assert.equal(out.findActiveCount, 1, 'exactly one match is the active hit')
  assert.equal(out.findCountLabel, '1/2', 'the count shows the active index and total')
  assert.equal(out.findCountAfterNext, '2/2', 'next-match navigation advances the active index')
  assert.equal(out.findNoMatchLabel, 'files.findNoMatch', 'a query with no results shows the no-match label')
  assert.equal(out.findCaseInsensitiveHits, 2, 'case-insensitive by default: CONST matches lowercase const')
  assert.equal(out.findCaseButtonActive, true, 'the Match case toggle reflects its active state')
  assert.equal(out.findCaseSensitiveHits, 0, 'enabling Match case drops mismatched-case matches')
  assert.equal(out.findCaseSensitiveLabel, 'files.findNoMatch', 'case-sensitive no-match shows the no-match label')
  assert.equal(out.findClosed, true, 'Esc closes the find box')
  assert.equal(out.preUnmountFilesActive, true, 'before the switch the Files tab is active')
  assert.ok(out.preUnmountSelected, 'before the switch a file is selected')
  assert.equal(out.preUnmountChildVisible, true, 'before the switch the expanded dir shows its child')
  assert.equal(out.restoredFilesActive, true, 'a quick return restores the Files sub-tab')
  assert.equal(out.restoredChildVisible, true, 'a quick return keeps the expanded directory open')
  assert.equal(out.restoredSelected, out.preUnmountSelected, 'a quick return keeps the same file selected')
  assert.equal(out.restoredPreviewShown, true, 'a quick return restores the file preview')

  // Branch switch (wide): per-row switch button, confirm + stash choice,
  // run payload, refusal kept in the dialog.
  assert.equal(out.switchNoFixedEntry, true, 'the left column has no fixed switch entry any more')
  assert.deepEqual(out.switchBtnRows, ['feature', 'origin/release'],
    'only rows with a switch target carry the button (not the current branch or the remote resolving to it)')
  assert.equal(out.switchBtnHidden, true, 'the switch button is hidden until the row is hovered')
  assert.equal(out.switchBtnHoverRule, true, 'a hover rule reveals the switch button')
  assert.equal(out.switchBtnTitleTrack, true, 'a remote row without a local branch says it creates a tracking branch')
  assert.equal(out.switchBtnTitleLocal, true, 'a local row titles a plain switch')
  assert.equal(out.switchBtnNoFilter, true, 'clicking the switch button does not toggle the history filter')
  assert.equal(out.switchCancelRunsNothing, true, 'closing the confirm runs no checkout')
  assert.equal(out.switchConfirmOpened, true, 'picking a row opens the switch confirm')
  assert.equal(out.switchConfirmBody, true, 'the confirm states the from → to switch')
  assert.equal(out.switchTrackingNote, true, 'a remote row explains the local branch it will create and track')
  assert.equal(out.switchDirtyWarn, true, 'a dirty work tree is called out before switching')
  assert.equal(out.switchStashChoice, true, 'the dirty work tree offers the stash-first choice')
  assert.equal(out.switchDefaultNoStash, true, 'the default is a plain switch, not a stash')
  assert.equal(out.switchStashRelabel, true, 'choosing stash relabels the confirm button')
  assert.deepEqual(out.switchAction, {
    kind: 'branch-checkout', name: 'release', createFrom: 'origin/release', stashMessage: 'switch.stashMessage',
  }, 'the confirm runs the tracking checkout, stashing first when chosen')
  assert.equal(out.switchModalClosed, true, 'a landed switch closes the dialog')
  assert.equal(out.switchReloadedBranches, true, 'a landed switch reloads the branch list')
  assert.equal(out.switchRefusalShown, true, 'a refused switch shows the refusal inside the dialog')
  assert.equal(out.switchRefusalStaysOpen, true, 'a refused switch keeps the dialog open for another choice')
  assert.equal(out.switchRelistsFiles, true, 'a branch switch makes the Files tab re-list the root')
  assert.equal(out.switchClearsFileSelection, true, 'a branch switch drops the Files tab selection')

  assert.ok(realInput !== null && realInput.before.rendered > realInput.before.natural, `real input: zooming past 100% grows the rendered image (${JSON.stringify(realInput?.before)})`)
  assert.ok(realInput !== null && realInput.after.left > realInput.before.left && realInput.after.top > realInput.before.top, `real input: a mouse drag pans the zoomed image (${JSON.stringify(realInput?.before)} -> ${JSON.stringify(realInput?.after)})`)
  assert.equal(realInput?.after.pct, realInput?.before.pct, 'real input: a drag leaves the zoom level untouched')
  assert.equal(realInput?.after.lightbox, false, 'real input: a drag never opens the lightbox')
  assert.equal(errors.length, 0, 'no console errors: ' + JSON.stringify(errors))
  console.log('e2e run.mjs: PASS', JSON.stringify(out))
} catch (e) {
  console.error('e2e run.mjs: FAIL', e.message)
  console.error(JSON.stringify(out, null, 2))
  process.exit(1)
}
