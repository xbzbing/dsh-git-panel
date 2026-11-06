/** History rows and their graph stay together while author requests are deferred. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(new URL('./harness.html', import.meta.url).href)
  for (const file of ['client.js', 'mock-rpc.mjs']) {
    await page.addScriptTag({ path: fileURLToPath(new URL(file, import.meta.url)) })
  }
  await page.addStyleTag({ content: `
    body{margin:0;background:#16191f;color:#ddd;font:13px system-ui}
    :root{--dsw-alias-bg-layer-1:#16191f;--dsw-alias-bg-layer-2:#20242c;
    --dsw-alias-label-primary:#e5e7eb;--dsw-alias-label-secondary:#a8aeb8;
    --dsw-alias-label-tertiary:#777;--dsw-alias-border-l2:#353a44;
    --dsw-alias-state-business-primary:#699cff;--dsw-alias-interactive-bg-hover:#262c35}
  ` })
  const data = await page.evaluate(() => {
    const author1 = '疯狂的 dabing'
    const author2 = '另一位作者'
    const hash = (n) => n.toString(16).repeat(40)
    const commit = (n, parents, subject, author) => ({
      hash: hash(n), shortHash: hash(n).slice(0, 7), parents: parents.map(hash),
      subject, author, dateIso: '2026-01-01T10:00:00Z', refs: [],
    })
    // A normal history page can end before a parent is loaded. Its unfiltered
    // lane must not become a filtered boundary until the new result arrives.
    const root = commit(4, [7], 'page bottom', author1)
    const B = commit(3, [4], 'B', author1)
    const hiddenH = commit(2, [3], 'hidden H', author2)
    const hiddenJ = commit(6, [2], 'hidden J', 'Hidden')
    const C = commit(5, [6], 'C', author2)
    const A = commit(1, [2], 'A', author1)
    const full = [A, C, hiddenJ, hiddenH, B, root]
    const first = [A, B, root]
    const second = [C, hiddenH]
    // The toolbar's fetch entry is what retries a failed filter below, and it
    // refuses to run with no remote configured (`runCheckSync` guards on
    // `remote === null`), so the fixture needs one even though this runner only
    // asserts the graph transitions.
    const snapshot = {
      root: 'graph-transition-fixture', branch: 'main', head: A.shortHash,
      dirty: false, unborn: false, staged: 0, modified: 0, untracked: 0,
      ahead: 0, behind: 0, hasUpstream: false, changes: [],
      remote: { name: 'origin', webUrl: 'https://github.com/example/transition', hostKind: 'github' },
      refreshIntervalMs: 0, checkedAt: Date.now(), graphStyle: 'parallel',
      stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
    }
    const { fixture, connection } = window.createGitPanelMock(snapshot)
    const call = connection.rpc.call
    const success = (value) => ({ ok: true, value: { ok: true, value } })
    const requests = []
    connection.rpc.call = async (channel, endpoint, payload) => {
      const query = payload?.args?.request?.query
      if (endpoint === 'dbGitPanel/query') {
        if (query.kind === 'branches') return success({ kind: 'branches', current: 'main', defaultBranch: null, local: [], remote: [] })
        if (query.kind === 'tags') return success({ kind: 'tags', tags: [] })
        if (query.kind === 'authors') return success({ kind: 'authors', authors: [author1, author2] })
        if (query.kind === 'history') {
          const commits = query.author === author1 ? first : query.author === author2 ? second : full
          const visible = new Set(commits.map((commit) => commit.hash))
          const value = {
            kind: 'history', commits, total: commits.length,
            ...(query.author ? { topology: full.filter((commit) => !visible.has(commit.hash)).map(({ hash, parents }) => ({ hash, parents })) } : {}),
          }
          const request = { id: requests.length, query, released: false, completed: false, release: null }
          const response = new Promise((resolve) => {
            request.release = (outcome = 'success') => {
              if (request.released) throw new Error('history response already released: ' + request.id)
              request.released = true
              resolve(outcome === 'failure'
                ? { ok: true, value: { ok: false, error: { code: 'git-error', message: 'deferred history failure' } } }
                : success(value))
            }
          })
          requests.push(request)
          const result = await response
          request.completed = true
          return result
        }
      }
      return call(channel, endpoint, payload)
    }
    const inspect = () => {
      const rows = [...document.querySelectorAll('.gp-history__list .gp-commit-row')]
      // React's instance IDs are incidental; all SVG geometry, styles and HEAD
      // markings remain in the signature, including path ordering and masks.
      const graphs = rows.map((row) => ({
        hash: row.querySelector('.gp-commit-hash')?.textContent,
        subject: row.querySelector('.gp-commit-subject')?.textContent,
        svg: row.querySelector('.gp-graph-svg')?.outerHTML
          .replace(/id="[^"]+"/g, 'id="MASK"').replace(/url\(#[^)]+\)/g, 'url(#MASK)'),
      }))
      return {
        hashes: graphs.map((row) => row.hash), signature: JSON.stringify(graphs),
        paths: JSON.stringify(rows.map((row) => [...row.querySelectorAll('.gp-graph-svg path')].map((path) => path.outerHTML))),
        graphs: rows.filter((row) => row.querySelector('.gp-graph-svg')).length,
        dashed: document.querySelectorAll('.gp-graph-edge[data-indirect="true"]').length,
        currentHashes: [...document.querySelectorAll('.gp-graph-node--current')].map((node) => node.closest('.gp-commit-row')?.querySelector('.gp-commit-hash')?.textContent),
        currentDots: document.querySelectorAll('.gp-graph-node__dot').length,
      }
    }
    let trace = null
    const record = (source) => {
      if (trace === null) return
      if (source === 'frame') trace.frames++
      if (source === 'mutation') trace.mutations++
      const state = inspect()
      if (trace.samples.at(-1)?.state.signature !== state.signature) trace.samples.push({ source, state })
    }
    const observer = new MutationObserver(() => record('mutation'))
    observer.observe(document.getElementById('panel'), { subtree: true, childList: true, attributes: true, characterData: true })
    const onFrame = () => { record('frame'); requestAnimationFrame(onFrame) }
    requestAnimationFrame(onFrame)
    window.graphTransition = {
      fixture, requests, inspect,
      release: (id, outcome) => requests[id].release(outcome),
      start: (label) => { trace = { label, frames: 0, mutations: 0, samples: [] }; record('start') },
      finish: () => { record('finish'); const result = trace; trace = null; return result },
      frames: async (count = 4) => {
        for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve))
      },
    }
    const registered = {}
    const ctx = {
      get: (name) => name === 'connection' ? connection : undefined,
      effect: (callback) => callback(), on: () => () => {}, inject: (_deps, callback) => callback(ctx),
      slots: { inject: (_name, provider) => provider(), register: (reg, component) => { registered[reg.name] = component; return () => {} } },
      locale: { register: () => () => {}, bind: () => (key) => key },
    }
    window.__getLoaded().apply(ctx)
    window.ReactDOM.createRoot(document.getElementById('panel')).render(registered['conversation.view']({ sessionId: 'graph-transition-fixture' }))
    return { author1, author2, head: A.shortHash, full: full.map((c) => c.shortHash), first: first.map((c) => c.shortHash), second: second.map((c) => c.shortHash) }
  })

  const inspect = () => page.evaluate(() => window.graphTransition.inspect())
  const frames = () => page.evaluate(() => window.graphTransition.frames())
  const requestCount = () => page.evaluate(() => window.graphTransition.requests.length)
  const waitRequest = async (after, author) => {
    await page.waitForFunction(({ after, author }) => window.graphTransition.requests.some((r) => r.id >= after && (r.query.author ?? '') === author), { after, author })
    return page.evaluate(({ after, author }) => {
      const request = window.graphTransition.requests.find((r) => r.id >= after && (r.query.author ?? '') === author)
      return { id: request.id, query: request.query }
    }, { after, author })
  }
  const release = async (request, outcome = 'success') => {
    await page.evaluate(({ id, outcome }) => window.graphTransition.release(id, outcome), { id: request.id, outcome })
    await page.waitForFunction((id) => window.graphTransition.requests[id].completed, request.id)
  }
  const waitRows = async (hashes) => {
    await page.waitForFunction((hashes) => JSON.stringify(window.graphTransition.inspect().hashes) === JSON.stringify(hashes), hashes)
    await frames()
  }
  const pickAuthor = async (author) => {
    await page.locator('.gp-select-trigger:not(.gp-search-scope__trigger)').first().click()
    await page.getByRole('menuitem', { name: author || 'overview.allUsers', exact: true }).click()
    await page.waitForSelector('[role="menu"]', { state: 'detached' })
  }
  const start = (label) => page.evaluate((label) => window.graphTransition.start(label), label)
  const finish = () => page.evaluate(() => window.graphTransition.finish())
  const assertHead = (state, label) => {
    const expected = state.hashes.includes(data.head) ? [data.head] : []
    assert.deepEqual(state.currentHashes, expected, label + ': only snapshot.head gets the current marker')
    assert.equal(state.currentDots, expected.length, label + ': current marker retains its centre dot')
    assert.equal(state.graphs, state.hashes.length, label + ': every retained row has its graph')
  }
  const reports = []
  const assertTrace = (trace, before, after) => {
    assert.ok(trace.frames >= 4, trace.label + ': observed animation frames during the deferred request')
    let published = false
    for (const { source, state } of trace.samples) {
      assert.ok(state.signature === before.signature || state.signature === after.signature,
        trace.label + ': ' + source + ' exposed mixed rows/topology: ' + state.signature)
      if (state.signature === after.signature) published = true
      if (published) assert.equal(state.signature, after.signature, trace.label + ': an accepted graph never flashes back to the old one')
      assertHead(state, trace.label + '/' + source)
    }
    reports.push({ label: trace.label, frames: trace.frames, mutations: trace.mutations, signatures: trace.samples.length })
  }
  const assertPending = async (request, before, label) => {
    await frames()
    assert.equal(await page.evaluate((id) => window.graphTransition.requests[id].released, request.id), false, label + ': history is still deferred')
    assert.equal((await inspect()).signature, before.signature, label + ': pending response preserves the exact old graph')
  }
  const transition = async (label, author, hashes) => {
    const before = await inspect()
    const afterIndex = await requestCount()
    await start(label)
    await pickAuthor(author)
    const request = await waitRequest(afterIndex, author)
    assert.equal(request.query.skip, 0, label + ': filter starts from page zero')
    await assertPending(request, before, label)
    await release(request)
    await waitRows(hashes)
    const after = await inspect()
    assert.deepEqual(after.hashes, hashes, label + ': response replaces visible rows')
    assert.notEqual(after.signature, before.signature, label + ': graph changes when the response is released')
    assertTrace(await finish(), before, after)
    return after
  }

  const initialRequest = await waitRequest(0, '')
  await release(initialRequest)
  await waitRows(data.full)
  const full = await inspect()
  assertHead(full, 'initial full history')
  assert.equal(full.dashed, 0, 'full history has only direct solid ancestry')
  const first = await transition('all to author while loading', data.author1, data.first)
  assert.ok(first.dashed > 0, 'first author projects the hidden H ancestor')
  // Selection changes highlighting/details, never the repository HEAD identity.
  await page.locator('.gp-commit-row').nth(1).click()
  await frames()
  assertHead(await inspect(), 'selected non-HEAD row')
  const restored = await transition('author to all while loading', '', data.full)
  assert.equal(restored.signature, full.signature, 'returning to all restores the original full topology')
  const firstAgain = await transition('all to author again', data.author1, data.first)
  assert.equal(firstAgain.signature, first.signature, 'the same sparse result has the same graph')
  const second = await transition('author one to author two', data.author2, data.second)
  assert.notDeepEqual(second.hashes, first.hashes, 'authors have different visible commits')
  assert.notEqual(second.paths, first.paths, 'authors also have different ancestry paths')
  assert.ok(second.dashed > 0, 'second author projects its own hidden J ancestor')
  assert.deepEqual(second.currentHashes, [], 'an author that excludes HEAD has no current marker')

  const failureStart = await requestCount()
  await start('failed author to all retains sparse graph')
  await pickAuthor('')
  const failed = await waitRequest(failureStart, '')
  await assertPending(failed, second, 'failed author to all')
  await release(failed, 'failure')
  await frames()
  const afterFailure = await inspect()
  assert.equal(afterFailure.signature, second.signature, 'failed filter retains the old graph without recomputing it')
  assertTrace(await finish(), second, second)

  const retryStart = await requestCount()
  const actionCount = await page.evaluate(() => window.graphTransition.fixture.actions.length)
  await start('fetch retries the failed filter')
  await page.locator('.gp-toolbar button[title="overview.fetch"]').click()
  const retried = await waitRequest(retryStart, '')
  assert.equal(await page.evaluate(() => window.graphTransition.fixture.actions.length), actionCount + 1, 'retry uses the real fetch action')
  assert.equal(await page.evaluate(() => window.graphTransition.fixture.actions.at(-1).kind), 'fetch')
  await assertPending(retried, second, 'fetch retry')
  await release(retried)
  await waitRows(data.full)
  const afterRetry = await inspect()
  assert.equal(afterRetry.signature, full.signature, 'successful fetch retry publishes the requested full graph')
  assertTrace(await finish(), second, afterRetry)

  const race = async (label, latestAuthor, latestHashes, staleOutcome) => {
    const before = await inspect()
    const firstIndex = await requestCount()
    await start(label)
    await pickAuthor(data.author1)
    const stale = await waitRequest(firstIndex, data.author1)
    await assertPending(stale, before, label + '/first request')
    const nextIndex = await requestCount()
    await pickAuthor(latestAuthor)
    const latest = await waitRequest(nextIndex, latestAuthor)
    await assertPending(latest, before, label + '/newer request')
    await release(latest)
    await waitRows(latestHashes)
    const accepted = await inspect()
    await release(stale, staleOutcome)
    await frames()
    assert.equal((await inspect()).signature, accepted.signature, label + ': out-of-order old response cannot replace the new graph')
    assertTrace(await finish(), before, accepted)
    return accepted
  }
  const latestSecond = await race('fast author switches ignore stale success', data.author2, data.second, 'success')
  assert.equal(latestSecond.signature, second.signature, 'the latest author owns the rows and topology')
  const latestFull = await race('fast author switches ignore stale failure', '', data.full, 'failure')
  assert.equal(latestFull.signature, full.signature, 'a stale failure cannot disturb the accepted full graph')
  assert.equal(await page.evaluate(() => window.graphTransition.requests.every((r) => r.released && r.completed)), true, 'every deferred request was explicitly released')
  assert.deepEqual(errors, [], 'frontend has no uncaught or console errors')
  console.log('graph filter transition: PASS', JSON.stringify(reports))
} finally {
  await browser.close()
}
