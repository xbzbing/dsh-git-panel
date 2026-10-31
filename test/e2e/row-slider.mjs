/**
 * The travelling fill must sit exactly on the active row of every list that
 * hosts it.
 *
 * The fill is absolutely positioned inside its scroller, so it inherits that
 * scroller's positioning context: without `position: relative` on the host it
 * anchors to the panel and lands hundreds of pixels from the row it is supposed
 * to follow. A stylesheet-level assertion cannot catch that — the rule can be
 * present and still lose the cascade — so every host is driven through a real
 * click here and the geometry is measured against its active row.
 *
 * Expected deltas: top, height and width are exact (the fill is flush with
 * every scroller), and the fill's left corners are square so the select bar
 * stays a straight vertical line in every list.
 *
 * The run repeats at each font step: the panel applies it as CSS `zoom`, which
 * puts rects in visual pixels while the fill is laid out in CSS pixels, so a
 * missed conversion shows up as an offset that grows with the row's distance
 * from the top (hence the 20th commit, not the 2nd).
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'

const PICKED_COMMIT = 19

const browser = await chromium.launch()
try {
  for (const fontDelta of [0, 1, -1]) await run(fontDelta)
} finally {
  await browser.close()
}

async function run(fontDelta) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(new URL('./harness.html', import.meta.url).href)
  for (const file of ['client.js', 'mock-rpc.mjs']) {
    await page.addScriptTag({ path: fileURLToPath(new URL(file, import.meta.url)) })
  }

  const result = await page.evaluate(async ({ fontDelta, picked }) => {
    const now = new Date().toISOString()
    const hashOf = (i) => (String(i).padStart(4, '0') + 'abcdef0123').slice(0, 10)
    const commits = Array.from({ length: 30 }, (_, i) => ({
      hash: hashOf(i), shortHash: hashOf(i).slice(0, 7), subject: 'commit ' + i, author: 'Tester', dateIso: now,
      parents: i === 29 ? [] : [hashOf(i + 1)], refs: [],
    }))
    const snap = {
      root: '/mock', branch: 'main', head: 'd196623', dirty: true,
      unborn: false, staged: 0, modified: 2, untracked: 0, ahead: 0, behind: 0,
      changes: [
        { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
        { path: 'b.txt', status: 'modified', staged: false, isDirectory: false },
      ],
      stats: { fileCount: 2, staged: 0, modified: 2, untracked: 0, insertions: 3, deletions: 1, lastChangeAt: null, headCommittedAt: null },
      remote: null, refreshIntervalMs: 0, checkedAt: Date.now(), fontDelta,
    }
    const { fixture, connection } = window.createGitPanelMock(snap)
    // Two checkouts, so the repository list has a row to pick: a switch is the
    // only way to move that list's fill.
    fixture.repos = [
      { path: '', root: '/mock', name: 'fixture-repo', kind: 'workspace' },
      { path: 'site', root: '/mock/site', name: 'site', kind: 'nested' },
    ]
    fixture.history = { ok: true, value: { ok: true, value: { kind: 'history', total: commits.length, commits } } }

    const registered = {}
    const ctx = {
      get: (name) => (name === 'connection' ? connection : undefined),
      effect: (callback) => callback(), on: () => () => {}, inject: (_deps, callback) => callback(ctx),
      slots: { inject: (_name, provider) => provider(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
      locale: { register: () => () => {}, bind: () => (key) => key },
    }
    window.__getLoaded().apply(ctx)
    const view = registered['conversation.view']
    const root = window.ReactDOM.createRoot(document.getElementById('panel'))
    root.render(view.component({ sessionId: 'row-slider' }))

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const waitFor = async (test, label) => {
      const deadline = performance.now() + 6000
      while (!test()) {
        if (performance.now() > deadline) {
          // The failure has to say what the panel looked like: a missing row is
          // usually a pane that never mounted, not a slow one.
          const panel = document.querySelector('.gp-panel')
          const tabs = tabNodes().map((n) => (n.getAttribute('aria-selected') === 'true' ? '*' : '') + n.textContent.trim())
          throw new Error('row-slider: timed out waiting for ' + label
            + ' | tabs=' + tabs.join(',')
            + ' | panel=' + (panel === null ? '(none)' : panel.innerText.replace(/\s+/g, ' ').slice(0, 300)))
        }
        await wait(50)
      }
    }
    const inVisiblePane = (node) => {
      let el = node
      while (el !== null && el !== document.body) {
        if (el.getAttribute('role') === 'tabpanel' && el.style.display === 'none') return false
        el = el.parentElement
      }
      return true
    }
    const tabNodes = () => [...document.querySelectorAll('.gp-panel .gp-tabbar__tabs [role="tab"]')]
    const clickTab = (label) => {
      const node = tabNodes().find((n) => (n.querySelector('.gp-tab__label') || n).textContent.trim() === label)
      if (!node) throw new Error('no tab ' + label + ' in ' + tabNodes().map((n) => n.textContent.trim()).join('|'))
      node.click()
    }
    const textOf = (node, selector) => {
      const found = node.querySelector(selector)
      return found === null ? '' : found.textContent.replace(/\u200e/g, '').trim()
    }
    // Geometry of the fill against the row it follows, read from the pane that
    // is actually on screen (a hidden pane keeps its own copy in the DOM).
    const measure = (hostSelector, activeSelector) => {
      const host = [...document.querySelectorAll('.gp-panel ' + hostSelector)]
        .find((node) => inVisiblePane(node) && node.getBoundingClientRect().width > 0)
      if (host === undefined) return { error: 'no visible ' + hostSelector }
      const slider = host.querySelector('.gp-rowslider')
      if (slider === null) return { error: 'no slider inside ' + hostSelector }
      const active = host.querySelector(activeSelector)
      if (active === null) return { error: 'no ' + activeSelector + ' inside ' + hostSelector }
      const fill = slider.getBoundingClientRect()
      const row = active.getBoundingClientRect()
      return {
        host: hostSelector,
        top: Math.round(fill.top - row.top),
        height: Math.round(fill.height - row.height),
        width: Math.round(fill.width - row.width),
        on: !slider.classList.contains('gp-rowslider--off'),
        anchored: slider.offsetParent === host,
        leftRadius: getComputedStyle(slider).borderTopLeftRadius + ' ' + getComputedStyle(slider).borderBottomLeftRadius,
      }
    }

    // A dirty snapshot opens on the changes tab; the overview hosts three of
    // the six lists, so start there.
    await waitFor(() => document.querySelector('.gp-panel .gp-tabbar__tabs [role="tab"]'), 'the tab bar')
    clickTab('tab.overview')
    await waitFor(() => document.querySelector('.gp-panel .gp-commit-row'), 'the history rows')
    await wait(300)

    // 1. The branch tree: the fill marks the history filter row, so there is
    // none until a branch is picked; the checked-out branch carries its own
    // HEAD chip instead.
    await waitFor(() => document.querySelector('.gp-panel .gp-branch-row--current'), 'the current branch row')
    await wait(150)
    const branchScroll = () => [...document.querySelectorAll('.gp-panel .gp-col-left__scroll')]
      .find((node) => inVisiblePane(node) && node.getBoundingClientRect().width > 0)
    const idleFill = branchScroll().querySelector('.gp-rowslider')
    const idle = {
      off: idleFill !== null && idleFill.classList.contains('gp-rowslider--off'),
      head: textOf(branchScroll().querySelector('.gp-branch-row--current'), '.gp-branch-row__head'),
      heads: branchScroll().querySelectorAll('.gp-branch-row__head').length,
    }
    const featureRow = [...branchScroll().querySelectorAll('.gp-branch-row')].find((node) => textOf(node, '.gp-tree-name') === 'feature')
    if (featureRow === undefined) throw new Error('no feature branch row')
    featureRow.click()
    await waitFor(() => branchScroll().querySelector('.gp-branch-row--active') !== null, 'the filtered branch row')
    await wait(250)
    const branches = measure('.gp-col-left__scroll', '.gp-branch-row--active')

    // 1b. Folding the section that holds the filtered branch takes the row out of
    // the DOM; unfolding brings it back at the same place, and the fill must be
    // there at once rather than gliding in from the top of the list.
    let refold = null
    if (fontDelta === 0) {
      const groupHead = [...document.querySelectorAll('.gp-panel .gp-col-left__scroll .gp-branch-group__head')]
        .find((node) => inVisiblePane(node) && node.parentElement?.querySelector('.gp-branch-row--active') !== null)
      if (groupHead === undefined) throw new Error('no branch group holding the filtered branch')
      groupHead.click()
      await waitFor(() => branchScroll().querySelector('.gp-branch-row--active') === null, 'the folded section')
      await wait(100)
      groupHead.click()
      await waitFor(() => branchScroll().querySelector('.gp-branch-row--active') !== null, 'the unfolded section')
      await wait(40)
      refold = measure('.gp-col-left__scroll', '.gp-branch-row--active')
    }

    // 2. The history list: picking a commit moves the fill.
    const commitRows = () => [...document.querySelectorAll('.gp-panel .gp-history__list .gp-commit-row')]
    commitRows()[picked].click()
    await waitFor(() => document.querySelector('.gp-panel .gp-history__list .gp-commit-row--active'), 'the active commit')
    await wait(250)
    const history = measure('.gp-history__list', '.gp-commit-row--active')

    // 3. The detail pane's file tree: one row of the commit's stats.
    const detailRows = () => [...document.querySelectorAll('.gp-panel .gp-detail__files .gp-tree-row')]
    await waitFor(() => detailRows().length > 0, 'the detail file tree')
    const detailRowsInfo = detailRows().map((n) => n.className + ':' + textOf(n, '.gp-tree-name')).join('|')
    detailRows().find((n) => !n.classList.contains('gp-tree-row--dir'))?.click()
    await waitFor(() => document.querySelector('.gp-panel .gp-detail__files .gp-tree-row--active'), 'the active detail file among ' + detailRowsInfo)
    await wait(250)
    const detail = measure('.gp-detail__files', '.gp-tree-row--active')

    // 4. The changes list.
    clickTab('tab.changes')
    await waitFor(() => document.querySelector('.gp-panel .gp-changes__list .gp-file-row'), 'the change rows')
    await wait(200)
    document.querySelectorAll('.gp-panel .gp-changes__list .gp-file-row')[1].click()
    await waitFor(() => document.querySelector('.gp-panel .gp-changes__list .gp-file-row--active'), 'the active change')
    await wait(250)
    const changes = measure('.gp-changes__list', '.gp-file-row--active')

    // 5. The files tree.
    clickTab('tab.files')
    const fileRows = () => [...document.querySelectorAll('.gp-panel .gp-files__tree .gp-files__entry')]
    await waitFor(() => fileRows().length > 0, 'the file tree')
    await wait(200)
    const textRow = fileRows().find((node) => textOf(node, '.gp-tree-name') === 'a.txt') ?? fileRows()[0]
    textRow.click()
    await waitFor(() => document.querySelector('.gp-panel .gp-files__tree .gp-files__entry.gp-tree-row--active'), 'the active file')
    await wait(250)
    const files = measure('.gp-files__tree', '.gp-files__entry.gp-tree-row--active')

    // 6. The repository list: a pick from a collapsed block expands it first,
    // then the fill follows the checked row.
    clickTab('tab.overview')
    await wait(250)
    const repolist = () => [...document.querySelectorAll('.gp-panel .gp-repolist')]
      .find((node) => inVisiblePane(node) && node.getBoundingClientRect().width > 0)
    await waitFor(() => repolist() !== undefined, 'the repository list')
    const head = repolist().querySelector('.gp-repolist__head')
    if (head !== null && head.getAttribute('aria-expanded') === 'false') {
      head.click()
      await wait(250)
    }
    const repoRows = () => [...repolist().querySelectorAll('.gp-repolist__item')]
    const siteRow = repoRows().find((node) => textOf(node, '.gp-repolist__name') === 'site')
    if (siteRow === undefined) throw new Error('no site row: ' + repoRows().map((n) => textOf(n, '.gp-repolist__name')).join('|'))
    siteRow.click()
    await waitFor(() => {
      const active = repolist().querySelector('.gp-repolist__item--active')
      return active !== null && textOf(active, '.gp-repolist__name') === 'site'
    }, 'the picked repository row')
    await wait(400)
    const repos = measure('.gp-repolist__list', '.gp-repolist__item--active')

    root.unmount()
    return { idle, branches, refold, history, detail, changes, files, repos, root: fixture.snapshot.root }
  }, { fontDelta, picked: PICKED_COMMIT })
  await page.close()

  const step = 'font ' + fontDelta + ' '
  assert.deepEqual(errors, [], step + 'no browser runtime errors')
  assert.equal(result.idle.off, true, step + 'no filter row: the branch fill is hidden')
  assert.equal(result.idle.head, 'HEAD', step + 'the checked-out branch carries the HEAD chip')
  assert.equal(result.idle.heads, 1, step + 'only the checked-out branch carries the chip')
  const hosts = ['branches', 'history', 'detail', 'changes', 'files', 'repos']
  if (result.refold !== null) hosts.push('refold')
  for (const name of hosts) {
    const box = result[name]
    const label = step + name
    assert.equal(box.error, undefined, label + ': ' + (box.error ?? ''))
    assert.equal(box.on, true, label + ': the fill is drawn (not hidden)')
    assert.equal(box.anchored, true, label + ': the fill is positioned by its own scroller, not an ancestor')
    assert.ok(Math.abs(box.top) <= 1, label + ': the fill sits on the active row (top ' + box.top + 'px)')
    assert.ok(Math.abs(box.height) <= 1, label + ': the fill matches the row height (delta ' + box.height + 'px)')
    assert.ok(Math.abs(box.width) <= 1, label + ': the fill is as wide as the row (delta ' + box.width + 'px)')
    assert.equal(box.leftRadius, '0px 0px', label + ': the fill is square on the left, so the select bar is straight')
  }
  console.log('row-slider: ' + step + 'PASS', JSON.stringify(result))
}
