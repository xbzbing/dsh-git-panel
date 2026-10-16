/**
 * Injected by run.mjs with addScriptTag (classic script, no module imports).
 * Shares only its mutable mock RPC fixture: snapshot/response controls, query
 * and action logs, counted parent renders, and connection-reset callback.
 * React roots, mocks and the remaining browser scenarios stay in run.mjs.
 */
window.runSteadyStateScenarios = async (fixture) => {
  const result = {}
  const overviewBatch = ['authors', 'branches', 'history', 'tags']
  const changesBatch = ['diff', 'stash-list']
  const waitFor = async (predicate, label) => {
    const deadline = performance.now() + 5_000
    while (!predicate()) {
      if (performance.now() >= deadline) throw new Error('P1 timed out: ' + label)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  const flushUI = async () => {
    let painted = false
    requestAnimationFrame(() => requestAnimationFrame(() => { painted = true }))
    await waitFor(() => painted, 'React effects and paint')
  }
  const findText = (selector, text) => [...document.querySelectorAll(selector)].find((node) => (node.textContent || '').includes(text))
  const click = (node, label) => {
    if (!node || node.disabled) throw new Error('P1 missing enabled control: ' + label)
    node.click()
  }
  const selectTab = async (name) => {
    click(findText('.gp-tab', name), name)
    await waitFor(() => (document.querySelector('.gp-tab--active')?.textContent || '').includes(name), name + ' active')
    await flushUI()
  }
  const queriesSince = (start) => fixture.queries.slice(start).sort()
  const expectBatch = async (start, expected, label) => {
    await waitFor(() => fixture.queries.length >= start + expected.length, label + ' queries')
    await flushUI()
    const actual = queriesSince(start)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('P1 ' + label + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
    }
    return actual
  }
  const heldPoll = () => waitFor(() => typeof fixture.releaseSnapshot === 'function', 'held snapshot RPC')
  const releasePoll = async () => {
    await heldPoll()
    const replied = fixture.snapshotReplies
    const release = fixture.releaseSnapshot
    fixture.releaseSnapshot = null
    release()
    await waitFor(() => fixture.snapshotReplies > replied, 'snapshot RPC response')
  }
  const releaseAndParkNext = async () => {
    await releasePoll()
    await heldPoll()
    await flushUI()
  }
  const diffContains = (text) => (document.querySelector('.gp-changes .gp-diff__wrap')?.textContent || '').includes(text)
  const originalNow = Date.now
  const before = { snapshot: fixture.snapshot, stashes: fixture.stashes, history: fixture.history, diffText: fixture.diffText }
  let wallTime = originalNow()
  if (typeof fixture.resetConnection !== 'function') throw new Error('P1 connection/reset listener was not registered')
  try {
    // Park the very first reset before changing tabs; no timer can escape this
    // boundary. Each next poll parks again until this scenario releases it.
    fixture.holdSnapshot = true
    fixture.fingerprints = true
    fixture.snapshot = { ...fixture.snapshot, refreshIntervalMs: 300, stats: { ...fixture.snapshot.stats, lastChangeAt: wallTime - 30_000 } }
    fixture.stashes = [...fixture.defaultStashes, { index: 1, sha: 'non-tip', message: 'older stash', branch: 'main', relTime: '2 hours ago' }]
    fixture.diffText = 'same-fingerprint-baseline'
    Date.now = () => wallTime
    fixture.resetConnection()
    await heldPoll()
    await selectTab('tab.changes')
    await releasePoll()
    await waitFor(() => document.querySelector('.gp-file-row') !== null, 'Changes ready')
    click(findText('.gp-file-row', 'a.txt'), 'a.txt diff')
    await waitFor(() => diffContains('same-fingerprint-baseline'), 'baseline diff rendered')
    if (document.querySelectorAll('.gp-stash-row').length === 0) click(document.querySelector('.gp-stash .gp-group-head'), 'open stash list')
    await waitFor(() => (document.querySelector('.gp-stash')?.textContent || '').includes('older stash'), 'non-tip stash rendered')
    await heldPoll()
    await flushUI()

    const rendersBefore = { ...fixture.renders }
    const queriesBefore = fixture.queries.length
    const statsBefore = document.querySelector('.gp-stats')?.textContent
    const hadNonTipStash = (document.querySelector('.gp-stash')?.textContent || '').includes('older stash')
    for (let i = 1; i <= 2; i++) {
      wallTime += 60_000
      fixture.diffText = 'same-fingerprint-tick-' + i
      fixture.stashes = fixture.defaultStashes
      await releaseAndParkNext()
      await waitFor(() => diffContains(fixture.diffText), 'poll ' + i + ' diff rendered')
    }
    result.sameFingerprintPolling = {
      panelRenders: fixture.renders.panel - rendersBefore.panel,
      pillRenders: fixture.renders.pill - rendersBefore.pill,
      queries: queriesSince(queriesBefore),
      freshDiff: diffContains('same-fingerprint-tick-2'),
      nonTipStashRemoved: hadNonTipStash && !(document.querySelector('.gp-stash')?.textContent || '').includes('older stash'),
      relativeStatsUpdated: document.querySelector('.gp-stats')?.textContent !== statsBefore,
    }

    result.confirmationState = await window.runConfirmationStateScenarios(fixture, { waitFor, flushUI, click, releaseAndParkNext })

    // The action lands while an ordinary poll is held. Waiting for the next
    // parked poll proves its predecessor settled without relying on a short nap.
    const actionQueriesBefore = fixture.queries.length
    const actionsBefore = fixture.actions.length
    click(document.querySelector('.gp-stash-row__actions button[title="stash.drop"]'), 'stash drop')
    await waitFor(() => findText('.gp-modal__footer .gp-btn', 'stash.drop') !== undefined, 'stash confirm')
    click(findText('.gp-modal__footer .gp-btn', 'stash.drop'), 'confirm stash drop')
    await waitFor(() => fixture.actions.length > actionsBefore && document.querySelector('.gp-modal--sm') === null, 'stash action completed')
    const queriesAfterAction = await expectBatch(actionQueriesBefore, changesBatch, 'stash action')
    await releaseAndParkNext()
    result.sameFingerprintAction = {
      kind: fixture.actions.at(-1)?.kind,
      queriesAfterAction,
      queriesAfterOldPoll: queriesSince(actionQueriesBefore),
    }

    // Every history RPC returns this exact object and commits array. A new
    // array cannot accidentally unfreeze the relative-time memo under test.
    fixture.history = { ok: true, value: { ok: true, value: { kind: 'history', total: 1, commits: [
      { hash: 'fixed-clock-commit', shortHash: 'fixed', subject: 'stable history', author: 'Tester', dateIso: new Date(wallTime).toISOString(), parents: [], refs: [] },
    ] } } }
    await selectTab('tab.overview')
    await waitFor(() => document.querySelector('.gp-overview .gp-commit-date')?.textContent === 'time.justNow', 'fixed history initial clock')
    const overviewTimeBefore = document.querySelector('.gp-overview .gp-commit-date')?.textContent
    const overviewQueriesBefore = fixture.queries.length
    wallTime += 60_000
    await releaseAndParkNext()
    await waitFor(() => document.querySelector('.gp-overview .gp-commit-date')?.textContent === 'time.minutesAgo{"n":1}', 'fixed history clock advanced')
    result.sameFingerprintOverviewClock = {
      before: overviewTimeBefore,
      after: document.querySelector('.gp-overview .gp-commit-date')?.textContent,
      queries: queriesSince(overviewQueriesBefore),
    }

    // Tag writes bypass controller.accept. A held poll and unchanged business
    // snapshot force this batch to come from the local opBump key alone.
    click(document.querySelector('.gp-overview .gp-commit-row'), 'fixed history commit')
    await waitFor(() => findText('.gp-detail__ops .gp-btn', 'overview.createTag') !== undefined, 'commit tag action')
    click(findText('.gp-detail__ops .gp-btn', 'overview.createTag'), 'create tag')
    await waitFor(() => document.querySelector('input[placeholder="tag.namePlaceholder"]') !== null, 'tag name input')
    const tagInput = document.querySelector('input[placeholder="tag.namePlaceholder"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(tagInput, 'p1-refresh-tag')
    tagInput.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => findText('.gp-modal__footer .gp-btn', 'tag.create')?.disabled === false, 'tag submit enabled')
    const tagQueriesBefore = fixture.queries.length
    const tagActionsBefore = fixture.actions.length
    const tagSnapshotsBefore = fixture.snapshotCalls
    const tagRendersBefore = fixture.renders.panel
    const tagBusinessBefore = JSON.stringify(fixture.snapshot)
    click(findText('.gp-modal__footer .gp-btn', 'tag.create'), 'confirm create tag')
    await waitFor(() => fixture.actions.length > tagActionsBefore && document.querySelector('.gp-modal--sm') === null, 'tag created')
    result.tagCreateRefresh = {
      action: fixture.actions.at(-1),
      queries: await expectBatch(tagQueriesBefore, overviewBatch, 'local tag refresh'),
      snapshots: fixture.snapshotCalls - tagSnapshotsBefore,
      panelRenders: fixture.renders.panel - tagRendersBefore,
      sameBusiness: JSON.stringify(fixture.snapshot) === tagBusinessBefore,
    }

    // This selector deliberately targets the history toolbar, not the status
    // bar fetch button. The UI action must accept a snapshot and refresh once.
    const fetchQueriesBefore = fixture.queries.length
    const fetchActionsBefore = fixture.actions.length
    click(document.querySelector('.gp-history .gp-toolbar button[title="overview.fetch"]'), 'history toolbar fetch')
    await waitFor(() => fixture.actions.length > fetchActionsBefore && document.querySelector('.gp-history .gp-toolbar button[title="overview.fetch"]')?.disabled === false, 'toolbar fetch completed')
    const queriesAfterFetch = await expectBatch(fetchQueriesBefore, overviewBatch, 'toolbar fetch')
    await releaseAndParkNext()
    result.toolbarFetchRefresh = {
      kind: fixture.actions.at(-1)?.kind,
      queries: queriesAfterFetch,
      queriesAfterOldPoll: queriesSince(fetchQueriesBefore),
    }

    result.fetchFailureFeedback = await window.runOverviewFetchScenarios(fixture, { waitFor, flushUI, click, releaseAndParkNext })

    // A snapshot error removes resident Git tabs. Recovery must remount them,
    // reopen only the active Overview gate, and issue exactly one fresh batch.
    const oldOverview = document.querySelector('.gp-overview')
    const failureQueriesBefore = fixture.queries.length
    const errorRepliesBefore = fixture.snapshotReplies
    fixture.snapshotError = { code: 'git-error', message: 'P1 snapshot failure' }
    await releasePoll()
    await waitFor(() => (document.querySelector('.gp-panel .gp-empty')?.textContent || '') === 'pill.unavailable' && document.querySelector('.gp-overview') === null, 'snapshot error UI unmounted Git tabs')
    await heldPoll()
    await flushUI()
    const errorShown = fixture.snapshotReplies === errorRepliesBefore + 1 && fixture.snapshotError === null
    const queriesWhileFailed = queriesSince(failureQueriesBefore)
    const recoveryQueriesBefore = fixture.queries.length
    await releaseAndParkNext()
    await waitFor(() => document.querySelector('.gp-overview .gp-commit-row') !== null, 'Overview remounted after snapshot recovery')
    result.snapshotErrorRecovery = {
      errorShown,
      queriesWhileFailed,
      remounted: document.querySelector('.gp-overview') !== oldOverview,
      queries: await expectBatch(recoveryQueriesBefore, overviewBatch, 'snapshot recovery'),
      overviewActive: (document.querySelector('.gp-tab--active')?.textContent || '').includes('tab.overview'),
    }
  } finally {
    Date.now = originalNow
    fixture.fingerprints = false
    fixture.snapshotError = null
    fixture.diffText = before.diffText
    fixture.history = before.history
    fixture.stashes = before.stashes
    // Restore a long poll interval before releasing anything still parked. A
    // reset then consumes a fresh legacy snapshot for the following scenarios.
    fixture.snapshot = { ...before.snapshot, refreshIntervalMs: 300_000 }
    fixture.holdSnapshot = false
    const repliesBefore = fixture.snapshotReplies
    const release = fixture.releaseSnapshot
    fixture.releaseSnapshot = null
    release?.()
    fixture.resetConnection()
    await waitFor(() => fixture.snapshotReplies >= repliesBefore + (release ? 2 : 1) && document.querySelector('.gp-overview .gp-branch-row') !== null, 'fixture restored after P1')
    await flushUI()
  }
  return result
}
