window.createGitPanelMock = function createGitPanelMock(snap) {
  // Mutable snapshot the mock serves: the status-bar test flips it to an ahead
  // and a no-upstream state and re-drives the panel through the check button.
  const fixture = {
    snapshot: snap, fingerprints: false, snapshotError: null,
    snapshotCalls: 0, snapshotReplies: 0, holdSnapshot: false, releaseSnapshot: null,
    // The last snapshot request's `fullChanges` flag (the client's expand-all
    // mode); `fullSnapshot` is served instead when the flag is set, so a test
    // can model the host lifting the list cap.
    lastSnapshotFullChanges: false, fullSnapshot: null,
    // Resident Git queries only; Files' explicit reads have their own log.
    queries: [], actions: [], renders: { panel: 0, pill: 0 }, resetConnection: null,
    diffText: null, history: null,
    fetchError: null, holdFetch: false, releaseFetch: null,
    suggestCalls: 0, releaseSuggest: null,
    defaultStashes: [{ index: 0, sha: 'abcdef1234', message: 'wip on main', branch: 'main', relTime: '1 hour ago' }],
    fileQueries: [],
    // Paths served through the file-content query (the HTML asset packer's
    // reads land here); the styled.html assertion checks the css was read
    // through this route rather than the network.
    contentQueries: [],
    // Files-refresh fixtures: entries appended to the root listing and per-path
    // text overrides. The panel writes neither, so a test can stage a change
    // that happened outside the panel and observe the refresh pick it up.
    rootExtraEntries: [], textOverrides: {},
    // Files the panel asked the host to open outside the panel, and an optional
    // typed failure so the error path can be driven.
    openedFiles: [], openFileFailure: null,
    // Branch-switch probes: every `run` action lands here, and `branchQueries`
    // counts the branch-list reloads a landed checkout must trigger.
    // `runFailure` forces a wire error once: `{kind, code, message}` for exactly
    // the action named by `kind`. The field is required — the old default
    // (`branch-checkout`) silently armed whatever ran first, which is why the
    // discard refusal path could not be driven at all.
    runFailure: null, branchQueries: 0,
    // `holdRun = {kind}` parks that action's `run` until `releaseRun()` is
    // called, so a test can observe a dialog's in-flight busy state before the
    // response lands.
    holdRun: null, releaseRun: null,
    secondaryQueryFailure: null, secondaryFailures: [], repeatedDiffRevision: null,
    deferBinaryDiff: false, releaseBinaryDiff: null,
    // Nested-repository switcher fixture (issue #83): the repositories the
    // `repo-list` reply offers. The repository tag of a snapshot request is
    // recorded by the runner that needs it, not here.
    repos: [],
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
  // Park an in-flight RPC so a test can observe busy state before the response
  // lands. `slot` names the fixture field that holds the release handle; calling
  // it releases every call parked on that slot and clears the field, so a test
  // only needs `fixture.releaseX()` (taking the handle first, then nulling the
  // field, still works) and a second park can no longer strand the first waiter.
  const park = (slot) => new Promise((resolve) => {
    let handle = fixture[slot]
    if (handle === null) {
      const waiters = []
      handle = () => { if (fixture[slot] === handle) fixture[slot] = null; for (const waiter of waiters) waiter() }
      handle.waiters = waiters
      fixture[slot] = handle
    }
    handle.waiters.push(resolve)
  })
  // `runFailure` / `holdRun` target exactly one action kind. Requiring the field
  // keeps a forgotten or misspelled `kind` from silently arming an unrelated
  // action — the mistake the old `branch-checkout` default used to hide.
  const targetsRun = (spec, act) => {
    if (spec.kind === undefined) throw new Error('runFailure / holdRun needs an explicit `kind`')
    return act.kind === spec.kind
  }

  const connection = {
    rpc: {
      call: async (_channel, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'dbGitPanel/snapshot') {
          fixture.snapshotCalls++
          fixture.lastSnapshotFullChanges = request != null && request.fullChanges === true
          if (fixture.holdSnapshot) await park('releaseSnapshot')
          fixture.snapshotReplies++
          if (fixture.snapshotError !== null) {
            const error = fixture.snapshotError
            fixture.snapshotError = null
            return { ok: true, value: { ok: false, error } }
          }
          // Expand-all: serve the full list when the client lifted the cap.
          if (fixture.lastSnapshotFullChanges && fixture.fullSnapshot !== null) {
            return { ok: true, value: { ok: true, value: fixture.fullSnapshot } }
          }
          return { ok: true, value: { ok: true, value: snapshotValue() } }
        }
        if (endpoint === 'dbGitPanel/query') {
          const q = request.query
          if (q.kind === fixture.secondaryQueryFailure) {
            fixture.secondaryFailures.push(q.kind)
            return { ok: true, value: { ok: false, error: { code: 'git-error' } } }
          }
          if (q.kind === 'branches' || q.kind === 'tags' || q.kind === 'authors' || q.kind === 'history' || q.kind === 'stash-list' || q.kind === 'diff' || q.kind === 'image-diff') fixture.queries.push(q.kind)
          if (q.kind === 'worktree-stats') return { ok: true, value: { ok: true, value: { kind: 'worktree-stats', stats: { fileCount: 3, staged: 0, modified: 2, untracked: 1, insertions: 3, deletions: 0, lastChangeAt: Date.now(), headCommittedAt: new Date().toISOString() } } } }
          if (q.kind === 'branches') { fixture.branchQueries += 1; return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'feature', shortHash: 'd196623' }, { name: 'main', shortHash: 'de54fc0' }], remote: [{ name: 'origin/main', shortHash: 'de54fc0' }, { name: 'origin/release', shortHash: 'e5f6a7b' }, { name: 'origin/feat/branch-tree', shortHash: 'f7a8b9c' }] } } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: ['Tester'] } } }
          if (q.kind === 'history' && fixture.history !== null) return fixture.history
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 2, commits: [
            { hash: 'd196623aaa', shortHash: 'd196623', subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString(), parents: ['de54fc0bbb'], refs: [{ kind: 'branch', name: 'feature', head: false }] },
            { hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'init: first commit', author: 'Tester', dateIso: new Date().toISOString(), parents: [], refs: [{ kind: 'branch', name: 'main', head: true }] },
          ] } } }
          if (q.kind === 'show') return { ok: true, value: { ok: true, value: { kind: 'show', ref: q.ref, commit: { hash: q.ref, shortHash: q.ref.slice(0, 7), subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString() }, body: 'detailed body text', stats: [{ path: 'index.ts', status: 'modified' }, { path: 'src/app.ts', status: 'added' }], insertions: 12, deletions: 4 } } }
          if (q.kind === 'diff') {
            if (fixture.deferBinaryDiff && q.path === 'img.png') await park('releaseBinaryDiff')
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
              { name: 'src', dir: true }, { name: 'cache', dir: true, ignored: true }, { name: 'newdir', dir: true }, { name: 'vendored', dir: true }, { name: 'a.txt', dir: false, size: 12 }, { name: 'd.txt', dir: false, size: 10 }, { name: 'logo.png', dir: false, size: 64 }, { name: 'logo.svg', dir: false, size: 120 }, { name: 'icon.png', dir: false, size: 64 }, { name: 'big.png', dir: false, size: 3172 }, { name: 'wide.png', dir: false, size: 1600 }, { name: 'README.md', dir: false, size: 18 }, { name: 'diagram.md', dir: false, size: 48 }, { name: 'broken.md', dir: false, size: 24 }, { name: 'page.html', dir: false, size: 60 }, { name: 'csp.html', dir: false, size: 120 }, { name: 'heavy.html', dir: false, size: 614400 }, { name: 'styled.html', dir: false, size: 90 }, { name: 'styled.css', dir: false, size: 22 }, { name: 'unpacked.html', dir: false, size: 88 }, { name: 'big.js', dir: false, size: 60000 }, { name: 'blob.bin', dir: false, size: 5 }, { name: 'huge.txt', dir: false, size: 11534336 }, { name: 'ignored.log', dir: false, ignored: true },
              ...fixture.rootExtraEntries,
            ] } } }
            if (q.path === 'src') return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: 'src', truncated: false, entries: [
              { name: 'index.ts', dir: false, size: 40 },
            ] } } }
            if (q.path === 'newdir') return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: 'newdir', truncated: false, entries: [
              { name: 'note.txt', dir: false, size: 10 },
            ] } } }
            if (q.path === 'vendored') return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: 'vendored', truncated: false, entries: [
              { name: 'note.txt', dir: false, size: 10 },
            ] } } }
            // `cache` is the fixture's empty directory: the empty-listing hint
            // is asserted on it, so its emptiness is declared here instead of
            // riding the fallback (a future entry would silently change what
            // that assertion means).
            if (q.path === 'cache') return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: 'cache', truncated: false, entries: [] } } }
            return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries: [] } } }
          }
          if (q.kind === 'file-content') {
            fixture.contentQueries.push(q.path)
            // Binary and over-envelope fixtures: neither may show the
            // copy-content button in the preview toolbar.
            if (q.path.endsWith('.bin')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'binary', size: 5, mtimeMs: MOCK_MTIME } } }
            if (q.path.endsWith('huge.txt')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', tooLarge: true, size: 11 * 1024 * 1024, mtimeMs: MOCK_MTIME } } }
            // Mermaid fixtures (before the generic .md branch): one renders
            // through the chunk stub, one fails parsing and must fall back.
            if (q.path.endsWith('diagram.md')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: 'Intro para\n\n```mermaid\ngraph TD; A-->B\n```\n\nOutro para\n', lines: 7, size: 48, mtimeMs: MOCK_MTIME, absolutePath: '/mock/diagram.md' } } }
            if (q.path.endsWith('broken.md')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: '```mermaid\nbroken diagram\n```\n', lines: 3, size: 24, mtimeMs: MOCK_MTIME, absolutePath: '/mock/broken.md' } } }
            if (q.path.endsWith('.md')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: '# Hello Markdown\n', lines: 1, size: 1536, mtimeMs: MOCK_MTIME, absolutePath: '/mock/README.md' } } }
            // HTML asset-pack fixtures (before the generic .html branch): one
            // page references a packable stylesheet, one a missing asset so
            // the pack must fall back to the plain bytes.
            // A page whose own CSP blocks the appended paint report: the mask
            // can only be lifted by the load fallback.
            if (q.path.endsWith('csp.html')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: '<!doctype html><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"><p id="hi">CSP HTML</p>', lines: 1 } } }
            // A heavy document: its own inline script is past the weight the
            // preview accepts without asking, so the panel must confirm the
            // render before the frame is mounted. The script also keeps the
            // frame busy past the mask's slow threshold (4 s), so the slow
            // state — the one that must not look like a dead panel — is real.
            if (q.path.endsWith('heavy.html')) {
              const body = 'x'.repeat(600 * 1024)
              return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: `<!doctype html><title>Heavy</title><p id="hi">Heavy HTML</p><script>var pad="${body}";var t0=Date.now();while(Date.now()-t0<6000){}</script>`, lines: 3, size: 600 * 1024 } } }
            }
            if (q.path.endsWith('styled.html')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: '<!doctype html><title>Doc</title><link rel="stylesheet" href="styled.css"><p id="hi">Styled HTML</p>', lines: 1 } } }
            if (q.path.endsWith('unpacked.html')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: '<!doctype html><title>Doc</title><link rel="stylesheet" href="missing.css"><p id="hi">Unpacked HTML</p>', lines: 1 } } }
            if (q.path.endsWith('styled.css')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: 'body { color: rgb(1, 2, 3); }\n', lines: 1, size: 22, mtimeMs: MOCK_MTIME } } }
            // The unpacked.html fixture references this; a business failure
            // (not the default success fall-through) so the pack must abort.
            if (q.path.endsWith('missing.css')) return { ok: true, value: { ok: false, error: { code: 'file-not-found', message: q.path } } }
            if (q.path.endsWith('.html')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: '<!doctype html><title>Doc</title><p id="hi">Hello HTML</p><script>window.__htmlRan=(window.__htmlRan||0)+1;parent.postMessage("html-page-load","*")</script>', lines: 1 } } }
            // A big text file exercises both source-view guards: >5000 lines
            // (highlight off) with one >5000-char line (truncation).
            if (q.path.endsWith('big.js')) {
              const huge = 'x'.repeat(6000)
              const body = `const long = "${huge}"\n` + Array.from({ length: 5100 }, (_, i) => `line ${i}`).join('\n') + '\n'
              return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: body, lines: 5101 } } }
            }
            if (q.path.endsWith('wide.png')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'image', dataUrl: `data:image/png;base64,${MOCK_PNG_WIDE}` } } }
            if (q.path.endsWith('big.png')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'image', dataUrl: `data:image/png;base64,${MOCK_PNG_BIG}` } } }
            // An SVG is a picture whose markup rides along: the preview's two
            // faces come from this one response, so switching does not re-read.
            // `size` plays the stat the host would have run, so it is the
            // markup's own byte count — every size-gated rule (wrap cap, copy
            // envelope, properties) must see the number the real wire carries.
            if (q.path.endsWith('.svg')) {
              const markup = '<svg xmlns="http://www.w3.org/2000/svg">\n  <rect width="10" height="10"/>\n</svg>\n'
              return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'image', dataUrl: `data:image/svg+xml;base64,${btoa(markup)}`, content: markup, lines: 3, size: markup.length, mtimeMs: MOCK_MTIME } } }
            }
            if (q.path.endsWith('.png')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'image', dataUrl: `data:image/png;base64,${MOCK_PNG}`, size: 64, mtimeMs: MOCK_MTIME } } }
            const override = fixture.textOverrides[q.path]
            if (override !== undefined) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: override, lines: override.split('\n').length - 1, size: override.length, mtimeMs: MOCK_MTIME } } }
            return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: 'const x = 1\nconst y = 2\n', lines: 2, size: 24, mtimeMs: MOCK_MTIME } } }
          }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: 'init: first commit' } } }
          if (q.kind === 'pull-preview') return { ok: true, value: { ok: true, value: { kind: 'pull-preview', hasUpstream: true, commits: 2, files: 3, insertions: 10, deletions: 4 } } }
          if (q.kind === 'push-preview') return { ok: true, value: { ok: true, value: { kind: 'push-preview', hasUpstream: fixture.snapshot.hasUpstream === true, commits: 3, files: 2, insertions: 7, deletions: 1 } } }
          if (q.kind === 'stash-list') return { ok: true, value: { ok: true, value: { kind: 'stash-list', entries: fixture.stashes } } }
          // The panel asks for the workspace's repository list on first paint.
          // An empty list keeps the tab bar identical for every existing
          // runner; a fixture that needs the switcher opts in below.
          if (q.kind === 'repo-list') return { ok: true, value: { ok: true, value: { kind: 'repo-list', cwd: '/mock', repos: fixture.repos ?? [] } } }
        }
        if (endpoint === 'dbGitPanel/run') {
          const act = request.action
          fixture.actions.push(act)
          // Park the call so a test can assert the dialog's busy state before
          // the response lands.
          if (fixture.holdRun !== null && targetsRun(fixture.holdRun, act)) await park('releaseRun')
          if (act.kind === 'fetch') {
            if (fixture.holdFetch) await park('releaseFetch')
            if (fixture.fetchError !== null) {
              const error = fixture.fetchError
              fixture.fetchError = null
              return { ok: true, value: { ok: false, error } }
            }
          }
          // A forced failure drives a refusal path (dirty work tree, nested
          // repo, …) without the mock having to model the real git/fs checks;
          // it fires once, for the action named by `kind`.
          if (fixture.runFailure !== null && targetsRun(fixture.runFailure, act)) {
            const failure = fixture.runFailure
            fixture.runFailure = null
            const { kind: _kind, ...error } = failure
            return { ok: true, value: { ok: false, error } }
          }
          // A landed checkout moves HEAD: the panel must show the branch it read
          // back from the returned snapshot.
          if (act.kind === 'branch-checkout') fixture.snapshot = { ...fixture.snapshot, branch: act.name }
          return { ok: true, value: { ok: true, snapshot: snapshotValue() } }
        }
        if (endpoint === 'dbGitPanel/suggest') {
          fixture.suggestCalls++
          // Park until the test has observed the commit box's in-flight lock.
          await park('releaseSuggest')
          return { ok: true, value: { ok: true, value: { message: 'feat: suggested', truncated: fixture.suggestTruncated === true } } }
        }
        if (endpoint === 'dbGitPanel/version') return { ok: true, value: { current: '0.1.0', repositoryUrl: 'https://github.com/xbzbing/dsh-git-panel', updateAvailable: false, checkedRemote: request.check === true } }
        // "Open in the system browser": the harness records the request so a
        // test can prove the panel asked the host instead of mounting a frame.
        if (endpoint === 'dbGitPanel/openFile') {
          fixture.openedFiles.push(request.path)
          if (fixture.openFileFailure !== null) return { ok: true, value: { ok: false, error: fixture.openFileFailure } }
          return { ok: true, value: { ok: true, absolutePath: '/abs/' + request.path } }
        }
        return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
      },
    },
  }
  return { fixture, connection }
}
