/** Evidence-based filtered edges and selected nodes in the isolated client. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

mkdirSync(new URL('../../docs/local/', import.meta.url), { recursive: true })
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
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
  const result = await page.evaluate(async () => {
    const hash = (i) => i.toString(16).repeat(40)
    const commit = (i, parents, subject, author = 'Tester') => ({ hash: hash(i), shortHash: hash(i).slice(0, 7), parents: parents.map(hash), subject, author, dateIso: '2026-01-01T10:00:00Z', refs: [] })
    const visible = [commit(1, [2, 8], 'keep: merge'), commit(2, [6], 'keep: main'), commit(3, [9], 'keep: side'), commit(4, [10], 'keep: boundary'), commit(6, [], 'keep: root')]
    const hidden = [commit(8, [3], 'hidden: side', 'Other'), commit(9, [6], 'hidden: base', 'Other')]
    const full = [visible[0], visible[1], hidden[0], visible[2], visible[3], hidden[1], visible[4]]
    // The toolbar's fetch entry is what re-drives the snapshot below, and it
    // refuses to run with no remote configured (`runCheckSync` guards on
    // `remote === null`), so the fixture needs one even though this runner only
    // asserts the graph itself.
    const snap = {
      root: 'graph-fixture', branch: 'main', head: hash(1).slice(0, 7), dirty: false, unborn: false,
      staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: false,
      changes: [], remote: { name: 'origin', webUrl: 'https://github.com/example/graph', hostKind: 'github' }, refreshIntervalMs: 0, checkedAt: Date.now(), graphStyle: 'parallel',
      stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
    }
    const { fixture, connection } = window.createGitPanelMock(snap)
    const call = connection.rpc.call
    const historyQueries = []
    let topologyAvailable = true
    connection.rpc.call = async (channel, endpoint, payload) => {
      const q = payload?.args?.request?.query
      if (endpoint === 'dbGitPanel/query' && q.kind === 'history') {
        historyQueries.push(q)
        const filtered = q.search !== '1111111' && (q.author || q.since || q.search)
        const commits = q.search === 'exclude-head'
          ? visible.filter((commit) => !commit.hash.startsWith(fixture.snapshot.head ?? '!'))
          : filtered ? visible : full
        return { ok: true, value: { ok: true, value: {
          kind: 'history', commits, total: commits.length,
          ...(filtered && topologyAvailable ? { topology: hidden.map(({ hash, parents }) => ({ hash, parents })) } : {}),
        } } }
      }
      return call(channel, endpoint, payload)
    }
    const registered = {}
    const ctx = {
      get: (name) => name === 'connection' ? connection : undefined,
      effect: (callback) => callback(), on: () => () => {}, inject: (_deps, callback) => callback(ctx),
      slots: { inject: (_name, provider) => provider(), register: (reg, component) => { registered[reg.name] = component; return () => {} } },
      locale: { register: () => () => {}, bind: () => (key) => key },
    }
    window.__getLoaded().apply(ctx)
    window.ReactDOM.createRoot(document.getElementById('panel')).render(registered['conversation.view']({ sessionId: 'graph-fixture' }))
    const flush = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const waitFor = async (test) => {
      const deadline = performance.now() + 5000
      while (!test()) {
        if (performance.now() > deadline) throw new Error('filtered graph UI did not settle')
        await flush()
      }
    }
    const rows = () => [...document.querySelectorAll('.gp-commit-row')]
    const pick = async (index, label) => {
      document.querySelectorAll('.gp-select-trigger:not(.gp-search-scope__trigger)')[index].click()
      await waitFor(() => document.querySelector('[role="menu"]'))
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((node) => node.textContent === label)
      if (!item) throw new Error('missing filter option ' + label)
      item.click()
      await flush()
    }
    const inspect = () => ({
      rows: rows().length,
      graphs: document.querySelectorAll('.gp-graph-svg').length,
      currentNodes: document.querySelectorAll('.gp-graph-node--current').length,
      currentDots: document.querySelectorAll('.gp-graph-node--current + .gp-graph-node__dot').length,
      dashed: document.querySelectorAll('.gp-graph-edge[data-indirect="true"]').length,
      solid: document.querySelectorAll('.gp-graph-edge:not([data-indirect])').length,
      boundary: document.querySelectorAll('.gp-graph-boundary').length,
      maxWidth: Math.max(...[...document.querySelectorAll('.gp-graph-svg')].map((svg) => Number(svg.getAttribute('width')))),
    })
    await waitFor(() => rows().length === full.length)
    const unfiltered = inspect()
    const currentRow = () => document.querySelector('.gp-graph-node--current')?.closest('.gp-commit-row')
    const beforeSelection = currentRow()?.querySelector('.gp-commit-hash')?.textContent
    await pick(0, 'Tester')
    await waitFor(() => rows().length === visible.length)
    const author = inspect()
    rows()[2].click()
    await waitFor(() => rows()[2].classList.contains('gp-commit-row--active'))
    const ring = document.querySelector('.gp-graph-node--current')
    const dot = ring.parentElement.querySelector('.gp-graph-node__dot')
    const headMarker = {
      count: document.querySelectorAll('.gp-graph-node--current').length,
      fill: ring.getAttribute('fill'), dotFill: dot?.getAttribute('fill'),
      color: ring.getAttribute('stroke'), dotRadius: Number(dot?.getAttribute('r')),
      mask: ring.parentElement.querySelector('g').getAttribute('mask'),
      maskExists: ring.parentElement.querySelector('mask') !== null,
      concentric: dot?.getAttribute('cx') === ring.getAttribute('cx') && dot?.getAttribute('cy') === ring.getAttribute('cy'),
    }
    const headStaysAfterClick = currentRow() === rows()[0] && !rows()[2].querySelector('.gp-graph-node--current')
    rows()[1].click()
    await flush()
    const selectionIndependent = rows()[1].classList.contains('gp-commit-row--active') && currentRow() === rows()[0]
    await pick(0, 'overview.allUsers')
    await waitFor(() => rows().length === full.length)
    await pick(1, 'overview.last7d')
    await waitFor(() => rows().length === visible.length)
    const since = inspect()
    await pick(1, 'overview.allTime')
    await waitFor(() => rows().length === full.length)
    const search = document.querySelector('.gp-search')
    const setSearch = async (text) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, text)
      search.dispatchEvent(new Event('input', { bubbles: true }))
      await waitFor(() => (historyQueries.at(-1)?.search ?? '') === text)
      await flush()
    }
    await setSearch('keep')
    const searched = inspect()
    await setSearch('1111111')
    const hashJump = inspect()
    await setSearch('keep')
    const refreshSnapshot = async (next) => {
      fixture.snapshot = { ...fixture.snapshot, ...next }
      const count = historyQueries.length
      document.querySelector('.gp-toolbar button[title="overview.fetch"]').click()
      await waitFor(() => historyQueries.length > count)
      await flush()
    }
    // HEAD can move independently of selection, including a detached checkout.
    rows()[1].click()
    await flush()
    await refreshSnapshot({ branch: null, head: hash(3) })
    await waitFor(() => currentRow() === rows()[2])
    const followsDetachedHead = rows()[1].classList.contains('gp-commit-row--active') && currentRow() === rows()[2]
    await setSearch('exclude-head')
    await waitFor(() => rows().length === visible.length - 1)
    const excludedHead = inspect()
    rows()[0].click()
    await flush()
    const excludedHeadAfterClick = document.querySelector('.gp-graph-node--current') === null
    await setSearch('keep')
    await refreshSnapshot({ head: null, unborn: true })
    const unborn = inspect()
    await refreshSnapshot({ head: '', unborn: false })
    const emptyHead = inspect()
    await refreshSnapshot({ head: hash(3), unborn: false })
    // Older hosts omit topology even for filtered rows. Keep conservative
    // projection instead of holding unresolved parents open as ordinary lanes.
    topologyAvailable = false
    await setSearch('')
    await pick(0, 'Tester')
    await waitFor(() => rows().length === visible.length)
    const oldHostAuthor = inspect()
    topologyAvailable = true
    await pick(0, 'overview.allUsers')
    await setSearch('keep')
    rows()[0].click()
    await flush()
    return { unfiltered, author, since, searched, hashJump, beforeSelection, headMarker, headStaysAfterClick, selectionIndependent, followsDetachedHead, excludedHead, excludedHeadAfterClick, unborn, emptyHead, oldHostAuthor }
  })
  for (const key of ['author', 'since', 'searched']) {
    assert.equal(result[key].rows, 5, key + ' keeps the matched rows')
    assert.equal(result[key].graphs, 5, key + ' retains the graph')
    assert.equal(result[key].currentNodes, 1, key + ' retains the real HEAD marker')
    assert.equal(result[key].currentDots, 1, key + ' retains its centre dot')
    assert.ok(result[key].dashed > 0, key + ' marks omitted ancestry')
    assert.ok(result[key].solid > 0, key + ' preserves direct solid connections')
    assert.ok(result[key].boundary > 0, key + ' marks unresolved ancestry')
    assert.ok(result[key].maxWidth <= 42, key + ' does not accumulate phantom lanes')
  }
  assert.equal(result.unfiltered.dashed, 0, 'unfiltered connections remain solid')
  assert.equal(result.hashJump.dashed, 0, 'hash jump uses complete ancestry rather than content-filter projection')
  assert.equal(result.hashJump.graphs, 7)
  assert.equal(result.beforeSelection, '1111111', 'abbreviated repository HEAD is marked before any click')
  assert.equal(result.headMarker.count, 1)
  assert.equal(result.headMarker.fill, 'none', 'HEAD has an outer ring')
  assert.equal(result.headMarker.dotFill, result.headMarker.color, 'HEAD has a solid dot in the lane colour')
  assert.ok(result.headMarker.dotRadius > 0 && result.headMarker.dotRadius < 5.2, 'the dot fits inside the outer ring')
  assert.equal(result.headMarker.concentric, true, 'the ring and dot share their centre')
  assert.equal(result.headMarker.maskExists, true, 'lines are cut out between the ring and dot')
  assert.ok(result.headMarker.mask?.startsWith('url(#'))
  assert.equal(result.headStaysAfterClick, true, 'clicking a different commit never moves the HEAD marker')
  assert.equal(result.selectionIndependent, true, 'selection still moves the row highlight independently')
  assert.equal(result.followsDetachedHead, true, 'a detached HEAD update moves the marker without changing selection')
  assert.equal(result.excludedHead.currentNodes, 0, 'filtering HEAD out does not mark another commit')
  assert.equal(result.excludedHeadAfterClick, true, 'clicking filtered results cannot invent a HEAD marker')
  assert.equal(result.unborn.currentNodes, 0, 'an unborn repository has no current commit marker')
  assert.equal(result.emptyHead.currentNodes, 0, 'an empty HEAD never matches every commit')
  assert.equal(result.oldHostAuthor.rows, 5, 'older host author results remain visible')
  assert.equal(result.oldHostAuthor.graphs, 5, 'older host author results retain the graph')
  assert.equal(result.oldHostAuthor.dashed, 0, 'missing older-host ancestry never fabricates indirect links')
  assert.equal(result.oldHostAuthor.boundary, 3, 'each unresolved older-host parent ends at a short boundary')
  assert.ok(result.oldHostAuthor.solid > 0, 'older-host direct visible parent links remain solid')
  await page.locator('.gp-history').screenshot({ path: fileURLToPath(new URL('../../docs/local/filtered-graph-dark.png', import.meta.url)) })
  await page.addStyleTag({ content: `
    body{background:#fff;color:#20242c}
    :root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f7f8fa;
    --dsw-alias-label-primary:#20242c;--dsw-alias-label-secondary:#555d68;
    --dsw-alias-label-tertiary:#777;--dsw-alias-border-l2:#dadfe5;
    --dsw-alias-state-business-primary:#276fc7;--dsw-alias-interactive-bg-hover:#edf1f6}
  ` })
  await page.locator('.gp-history').screenshot({ path: fileURLToPath(new URL('../../docs/local/filtered-graph-light.png', import.meta.url)) })
  await page.evaluate(() => { document.getElementById('panel').style.width = '580px' })
  await page.waitForSelector('.gp-commit-row--compact .gp-graph-node--current')
  const compact = await page.locator('.gp-commit-row--compact .gp-graph-svg').first().boundingBox()
  assert.ok(compact.height > 30, 'compact graph uses the full taller row')
  assert.deepEqual(errors, [])
  console.log('filtered graph: PASS', JSON.stringify({ ...result, compactHeight: compact.height }))
} finally {
  await browser.close()
}
