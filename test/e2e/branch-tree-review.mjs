/** PR #39 regressions: remote pinning and cached trees through real UI renders. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'

const browser = await chromium.launch()
try {
  for (const defaultBranch of ['main', 'develop']) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(new URL('./harness.html', import.meta.url).href)
    for (const file of ['client.js', 'mock-rpc.mjs']) {
      await page.addScriptTag({ path: fileURLToPath(new URL(file, import.meta.url)) })
    }
    const result = await page.evaluate(async (primary) => {
      const snap = {
        root: 'branch-review', branch: 'feature', head: 'abc1234', dirty: false,
        unborn: false, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
        changes: [], stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
        remote: { name: 'origin' }, refreshIntervalMs: 0, checkedAt: Date.now(),
      }
      const { fixture, connection } = window.createGitPanelMock(snap)
      let nameReads = 0
      const local = [{ name: 'feature', shortHash: 'abc1234' }, ...Array.from({ length: 300 }, (_, i) => ({
        get name() { nameReads++; return `feat/team${i}/topic` }, shortHash: 'abc1234',
      }))]
      let remote = ['origin/feature', `origin/${primary}`].map((name) => ({ name, shortHash: 'abc1234' }))
      const call = connection.rpc.call
      connection.rpc.call = async (channel, endpoint, payload) => {
        if (endpoint === 'gitPanel/query' && payload.args.request.query.kind === 'branches') {
          return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'feature', defaultBranch: primary, local, remote } } }
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
      const root = window.ReactDOM.createRoot(document.getElementById('panel'))
      root.render(registered['conversation.view']({ sessionId: 'branch-review' }))
      const flush = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const waitFor = async (test) => {
        const deadline = performance.now() + 4000
        while (!test()) {
          if (performance.now() > deadline) throw new Error('branch review UI did not settle')
          await flush()
        }
      }
      await waitFor(() => document.querySelector('.gp-branch-row[title="feat"]'))
      await flush()
      const before = nameReads
      document.querySelector('.gp-select-trigger:not(.gp-search-scope__trigger)').click()
      await waitFor(() => document.querySelector('[role="menu"]'))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flush()
      const search = document.querySelector('.gp-search')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'topic')
      search.dispatchEvent(new Event('input', { bubbles: true }))
      await flush()
      const readsOnLocalRender = nameReads - before
      const remoteGroup = [...document.querySelectorAll('.gp-branch-group')].find((group) => group.querySelector('.gp-branch-group__head').textContent.includes('overview.remote'))
      remoteGroup.querySelector('.gp-branch-group__head').click()
      await waitFor(() => remoteGroup.querySelector('.gp-branch-row[title="origin"]'))
      const firstRemote = remoteGroup.querySelector('.gp-branch-row:not(.gp-branch-row--dir)')?.title
      const deepLeavesHidden = document.querySelector('.gp-branch-row[title="feat/team0/topic"]') === null
      remote = ['origin/feature', 'origin/master'].map((name) => ({ name, shortHash: 'abc1234' }))
      document.querySelector('.gp-toolbar button[title="overview.fetch"]').click()
      await waitFor(() => remoteGroup.querySelector('.gp-branch-row[title="origin/master"]'))
      const refreshedRemote = remoteGroup.querySelector('.gp-branch-row:not(.gp-branch-row--dir)')?.title
      root.unmount()
      return { primary, firstRemote, refreshedRemote, readsOnLocalRender, initialNameReads: before, deepLeavesHidden, queries: fixture.queries }
    }, defaultBranch)
    assert.equal(result.firstRemote, `origin/${defaultBranch}`, 'remote primary must be first without a local counterpart')
    assert.ok(result.initialNameReads > 0, 'probe must observe the initial tree construction')
    assert.equal(result.readsOnLocalRender, 0, 'menu/search renders must reuse the collapsed branch tree')
    assert.equal(result.deepLeavesHidden, true, 'nested directories remain collapsed')
    assert.equal(result.refreshedRemote, 'origin/master', 'fresh refs must invalidate cached trees and apply the fallback')
    assert.deepEqual(errors, [], 'no browser runtime errors')
    console.log('branch-tree review: PASS', JSON.stringify(result))
    await page.close()
  }
} finally {
  await browser.close()
}
