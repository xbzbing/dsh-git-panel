window.createGitPanelMock = function createGitPanelMock(snap) {
  // Mutable snapshot the mock serves: the status-bar test flips it to an ahead
  // and a no-upstream state and re-drives the panel through the check button.
  const fixture = {
    snapshot: snap, fingerprints: false, snapshotError: null,
    snapshotCalls: 0, snapshotReplies: 0, holdSnapshot: false, releaseSnapshot: null,
    // Resident Git queries only; Files' explicit reads have their own log.
    queries: [], actions: [], renders: { panel: 0, pill: 0 }, resetConnection: null,
    diffText: null, history: null,
    fetchError: null, holdFetch: false, releaseFetch: null,
    suggestCalls: 0, releaseSuggest: null,
    defaultStashes: [{ index: 0, sha: 'abcdef1234', message: 'wip on main', branch: 'main', relTime: '1 hour ago' }],
    fileQueries: [],
    // Branch-switch probes: every `run` action lands here, and `branchQueries`
    // counts the branch-list reloads a landed checkout must trigger.
    runFailure: null, branchQueries: 0,
    secondaryQueryFailure: null, secondaryFailures: [], repeatedDiffRevision: null,
    deferBinaryDiff: false, releaseBinaryDiff: null,
  }
  fixture.stashes = fixture.defaultStashes
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
  // One fixed mtime for every mocked file-content response, so the properties
  // dialog can assert a real absolute timestamp without pinning a date.
  const MOCK_MTIME = Date.now() - 60_000
  const snapshotValue = () => {
    if (!fixture.fingerprints) return fixture.snapshot
    const { checkedAt, stateFingerprint, ...business } = fixture.snapshot
    return { ...fixture.snapshot, checkedAt: Date.now(), stateFingerprint: JSON.stringify(business) }
  }

  const connection = {
    rpc: {
      call: async (_channel, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'gitPanel/snapshot') {
          fixture.snapshotCalls++
          if (fixture.holdSnapshot) await new Promise((resolve) => { fixture.releaseSnapshot = resolve })
          fixture.snapshotReplies++
          if (fixture.snapshotError !== null) {
            const error = fixture.snapshotError
            fixture.snapshotError = null
            return { ok: true, value: { ok: false, error } }
          }
          return { ok: true, value: { ok: true, value: snapshotValue() } }
        }
        if (endpoint === 'gitPanel/query') {
          const q = request.query
          if (q.kind === fixture.secondaryQueryFailure) {
            fixture.secondaryFailures.push(q.kind)
            return { ok: true, value: { ok: false, error: { code: 'git-error' } } }
          }
          if (q.kind === 'branches' || q.kind === 'tags' || q.kind === 'authors' || q.kind === 'history' || q.kind === 'stash-list' || q.kind === 'diff' || q.kind === 'image-diff') fixture.queries.push(q.kind)
          if (q.kind === 'worktree-stats') return { ok: true, value: { ok: true, value: { kind: 'worktree-stats', stats: { fileCount: 3, staged: 0, modified: 2, untracked: 1, insertions: 3, deletions: 0, lastChangeAt: Date.now(), headCommittedAt: new Date().toISOString() } } } }
          if (q.kind === 'branches') { fixture.branchQueries += 1; return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'feature', shortHash: 'd196623' }, { name: 'main', shortHash: 'de54fc0' }], remote: [{ name: 'origin/main', shortHash: 'de54fc0' }, { name: 'origin/release', shortHash: 'e5f6a7b' }] } } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: ['Tester'] } } }
          if (q.kind === 'history' && fixture.history !== null) return fixture.history
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 2, commits: [
            { hash: 'd196623aaa', shortHash: 'd196623', subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString(), parents: ['de54fc0bbb'], refs: [{ kind: 'branch', name: 'feature', head: false }] },
            { hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'init: first commit', author: 'Tester', dateIso: new Date().toISOString(), parents: [], refs: [{ kind: 'branch', name: 'main', head: true }] },
          ] } } }
          if (q.kind === 'show') return { ok: true, value: { ok: true, value: { kind: 'show', ref: q.ref, commit: { hash: q.ref, shortHash: q.ref.slice(0, 7), subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString() }, body: 'detailed body text', stats: [{ path: 'index.ts', status: 'modified' }, { path: 'src/app.ts', status: 'added' }], insertions: 12, deletions: 4 } } }
          if (q.kind === 'diff') {
            if (fixture.deferBinaryDiff && q.path === 'img.png') await new Promise((resolve) => { fixture.releaseBinaryDiff = resolve })
            // An image path diffs as the binary marker, like real git.
            if (q.path.endsWith('.png')) return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n', newLines: 0 } } }
            // An SVG is text: git produces a real source diff for it.
            if (q.path.endsWith('.svg')) return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/icon.svg b/icon.svg\n--- a/icon.svg\n+++ b/icon.svg\n@@ -1 +1 @@\n-<svg width="1"/>\n+<svg width="2"/>\n', newLines: 1 } } }
            if (q.path.endsWith('.ts')) return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-const count = 1\n+const count = 2\n', newLines: 1 } } }
            const addedLine = fixture.repeatedDiffRevision !== null && q.path === 'a.txt' ? 'repeat-diff-' + ++fixture.repeatedDiffRevision : fixture.diffText ?? 'line2'
            return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: `diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n line1\n+${addedLine}\n`, newLines: 2 } } }
          }
          if (q.kind === 'image-diff') return { ok: true, value: { ok: true, value: { kind: 'image-diff', path: q.path, mime: q.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png', old: `data:image/png;base64,${MOCK_PNG}`, new: `data:image/png;base64,${MOCK_PNG}` } } }
          if (q.kind === 'dir-list') {
            fixture.fileQueries.push(q.path)
            if (q.path === '') return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: '', truncated: false, entries: [
              { name: 'src', dir: true }, { name: 'cache', dir: true, ignored: true }, { name: 'newdir', dir: true }, { name: 'a.txt', dir: false, size: 12 }, { name: 'd.txt', dir: false, size: 10 }, { name: 'logo.png', dir: false, size: 64 }, { name: 'icon.png', dir: false, size: 64 }, { name: 'big.png', dir: false, size: 3172 }, { name: 'wide.png', dir: false, size: 1600 }, { name: 'README.md', dir: false, size: 18 }, { name: 'page.html', dir: false, size: 60 }, { name: 'big.js', dir: false, size: 60000 }, { name: 'ignored.log', dir: false, ignored: true },
            ] } } }
            if (q.path === 'src') return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: 'src', truncated: false, entries: [
              { name: 'index.ts', dir: false, size: 40 },
            ] } } }
            if (q.path === 'newdir') return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: 'newdir', truncated: false, entries: [
              { name: 'note.txt', dir: false, size: 10 },
            ] } } }
            return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries: [] } } }
          }
          if (q.kind === 'file-content') {
            if (q.path.endsWith('.md')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: '# Hello Markdown\n', lines: 1, size: 1536, mtimeMs: MOCK_MTIME } } }
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
            if (q.path.endsWith('.png')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'image', dataUrl: `data:image/png;base64,${MOCK_PNG}`, size: 64, mtimeMs: MOCK_MTIME } } }
            return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: 'const x = 1\nconst y = 2\n', lines: 2, size: 24, mtimeMs: MOCK_MTIME } } }
          }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: 'init: first commit' } } }
          if (q.kind === 'pull-preview') return { ok: true, value: { ok: true, value: { kind: 'pull-preview', hasUpstream: true, commits: 2, files: 3, insertions: 10, deletions: 4 } } }
          if (q.kind === 'push-preview') return { ok: true, value: { ok: true, value: { kind: 'push-preview', hasUpstream: fixture.snapshot.hasUpstream === true, commits: 3, files: 2, insertions: 7, deletions: 1 } } }
          if (q.kind === 'stash-list') return { ok: true, value: { ok: true, value: { kind: 'stash-list', entries: fixture.stashes } } }
        }
        if (endpoint === 'gitPanel/run') {
          const act = request.action
          fixture.actions.push(act)
          if (act.kind === 'fetch') {
            if (fixture.holdFetch) await new Promise((resolve) => { fixture.releaseFetch = resolve })
            if (fixture.fetchError !== null) {
              const error = fixture.fetchError
              fixture.fetchError = null
              return { ok: true, value: { ok: false, error } }
            }
          }
          // A forced failure drives the refusal path (dirty work tree) without
          // needing the mock to model git's real work-tree checks.
          if (fixture.runFailure !== null && act.kind === 'branch-checkout') {
            const failure = fixture.runFailure
            fixture.runFailure = null
            return { ok: true, value: { ok: false, error: failure } }
          }
          // A landed checkout moves HEAD: the panel must show the branch it read
          // back from the returned snapshot.
          if (act.kind === 'branch-checkout') fixture.snapshot = { ...fixture.snapshot, branch: act.name }
          return { ok: true, value: { ok: true, snapshot: snapshotValue() } }
        }
        if (endpoint === 'gitPanel/suggest') {
          fixture.suggestCalls++
          // Park until the test has observed the commit box's in-flight lock.
          await new Promise((r) => { fixture.releaseSuggest = r })
          fixture.releaseSuggest = null
          return { ok: true, value: { ok: true, value: { message: 'feat: suggested', truncated: false } } }
        }
        if (endpoint === 'gitPanel/version') return { ok: true, value: { current: '0.1.0', repositoryUrl: 'https://github.com/xbzbing/dsh-git-panel', updateAvailable: false, checkedRemote: request.check === true } }
        return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
      },
    },
  }
  return { fixture, connection }
}
