/**
 * E2E: Git Flow dialogs run through the shared `onAction` write path.
 *
 * Covers the four things the dialog shell cannot prove on its own:
 *   - the branch-list entry only exists on a host that declares
 *     `capabilities.flow`;
 *   - a start form submits the wire action with the resolved base (`develop`),
 *     not a display label;
 *   - a finish form's squash strategy with the branch delete needs the extra
 *     forced-delete acknowledgement, and the submitted action carries exactly
 *     the choices the form showed (strategy / forceDelete / pushRemote);
 *   - every finish raises a step confirmation before anything is written; a
 *     remote delete adds the acknowledgement that unlocks the write;
 *   - start and finish show the shared busy overlay while the write runs;
 *   - a release finish shows both landing branches (the main line it tags and
 *     the develop it merges back into) and submits the main line as target;
 *   - an in-flight submit locks the dialog, and a refusal renders inside it
 *     instead of closing it or claiming success.
 *
 * Isolated file:// harness, no dsh server. Requires test/e2e/setup.mjs first.
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

const SNAP = {
  root: 'flow-fixture', branch: 'feature/login', head: '44638f7', unborn: false,
  dirty: false, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
  hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
  capabilities: {
    revDiff: true, pathHistory: true, commitCheckout: true, branchDelete: true, remoteBranchDelete: true,
    branchCreate: true, branchMerge: true, cherryPick: true, flow: true,
  },
}

/** The branch list the flow dialogs read: both long-lived lines plus one branch
 * of every short-lived kind, and a tag so a release start prefills a version. */
const LOCAL = [
  { name: 'feature/login', shortHash: '44638f7' },
  { name: 'develop', shortHash: 'de54fc0' },
  { name: 'main', shortHash: 'de54fc0' },
  { name: 'release/1.2.0', shortHash: 'de54fc0' },
  { name: 'hotfix/1.2.1', shortHash: 'de54fc0' },
]
const REMOTE_BRANCHES = [
  { name: 'origin/develop', shortHash: 'de54fc0' },
  { name: 'origin/main', shortHash: 'de54fc0' },
]

const browser = await chromium.launch()
const consoleErrors = []

async function flush(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
}

/** Mount the panel on the Overview tab with a flow-shaped mock connection. */
async function openPanel(snapshot, remoteRefs = REMOTE_BRANCHES, tagNames = ['v1.2.3']) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', (error) => consoleErrors.push('PAGEERROR ' + error.message))
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  await page.evaluate(({ snapshot, local, remoteBranches, tags }) => {
    const panel = document.getElementById('panel')
    panel.style.width = '900px'
    panel.style.height = '740px'
    const { fixture, connection } = window.createGitPanelMock(snapshot)
    fixture.fingerprints = true
    window.__gpFixture = fixture
    const call = connection.rpc.call
    connection.rpc.call = async (channel, endpoint, payload) => {
      const request = payload?.args?.request
      if (endpoint === 'dbGitPanel/query' && request?.query?.kind === 'branches') {
        fixture.branchQueries += 1
        return { ok: true, value: { ok: true, value: { kind: 'branches', current: snapshot.branch ?? 'feature/login', defaultBranch: 'main', local, remote: remoteBranches } } }
      }
      if (endpoint === 'dbGitPanel/query' && request?.query?.kind === 'tags') {
        return { ok: true, value: { ok: true, value: { kind: 'tags', tags: tags.map((name) => ({ name, shortHash: 'de54fc0' })) } } }
      }
      return call(channel, endpoint, payload)
    }
    const registered = {}
    const dictionaries = {}
    const interpolate = (raw, params) => params === undefined
      ? raw
      : raw.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match))
    const ctx = {
      get: (key) => (key === 'connection' ? connection : undefined),
      effect: (cb) => { try { cb() } catch { /* ignore */ } },
      on: () => () => {},
      inject: (_deps, cb) => cb(ctx),
      slots: { inject: (_name, provider) => provider(), register: (reg, component) => { registered[reg.name] = component; return () => {} } },
      locale: {
        register: (ns, dict) => { dictionaries[ns] = dict },
        bind: (ns) => (key, params) => {
          const raw = dictionaries[ns]?.zh[key]
          return raw === undefined ? key : interpolate(raw, params)
        },
      },
    }
    window.__getLoaded().apply(ctx)
    window.ReactDOM.createRoot(panel).render(registered['conversation.view']({ sessionId: 'flow-session' }))
  }, { snapshot, local: LOCAL, remoteBranches: remoteRefs, tags: tagNames })
  await page.locator('[role="tab"]').first().waitFor()
  await page.waitForFunction(() => window.__gpFixture.snapshotReplies > 0)
  await flush(page)
  return page
}

/** Open the grouped flow menu and pick one entry. */
async function pickEntry(page, name) {
  await page.locator('.gp-flow-btn').click()
  await page.getByRole('menuitem', { name, exact: true }).click()
  await page.locator('.gp-modal--flow').waitFor()
  await flush(page)
}

/** Submit the open dialog and wait for its RPC to settle. */
async function submit(page) {
  await page.locator('.gp-modal__footer .gp-btn--primary').click()
}

/** The finish confirmation raised by the form's 完成. */
function remoteDeleteConfirm(page) {
  return page.locator('.gp-modal--sm:not(.gp-modal--flow)')
}

/** Finish through both stages: the form's 完成, then the confirmation (with the
 * remote-delete acknowledgement when the confirmation asks for one). */
async function submitFinish(page) {
  await page.locator('.gp-modal--flow .gp-modal__footer .gp-btn:last-child').click()
  await flush(page)
  const card = remoteDeleteConfirm(page)
  await card.waitFor()
  const ack = card.locator('.gp-modal__check input')
  if (await ack.count() > 0) await ack.check()
  await card.locator('.gp-modal__footer .gp-btn:last-child').click()
  await page.waitForFunction(() => document.querySelector('.gp-modal--flow') === null)
}

async function actions(page) {
  return page.evaluate(() => window.__gpFixture.actions)
}

// ── 1. entry + start form ───────────────────────────────────────────────────

const page = await openPanel(SNAP)
assert.equal(await page.locator('.gp-flow-btn').count(), 1, 'the host capability renders the Git Flow entry')
assert.equal((await page.locator('.gp-flow-btn').textContent()).trim(), 'Git Flow')

await pickEntry(page, '开始 Feature')
assert.equal(await page.locator('.gp-modal--flow .gp-flow__field select').inputValue(), 'develop', 'a feature starts on develop when it exists')
assert.equal(await page.locator('.gp-modal__check').count(), 1, 'the start dialog offers only the push choice')
assert.equal(await page.locator('.gp-modal__check input').isChecked(), true, 'pushing the new branch defaults on')
assert.deepEqual(
  await page.locator('.gp-flow-chain__col > .gp-flow-map__node:first-child .gp-flow-map__name').allTextContents(),
  ['develop', 'feature/…'],
  'the chain starts from the resolved base and previews the new branch',
)
await page.locator('.gp-modal--flow .gp-flow__field input').fill('login2')
await flush(page)
assert.match(await page.locator('.gp-flow-map').textContent(), /feature\/login2/, 'the legend previews the full branch name')
assert.match(await page.locator('.gp-flow-map').textContent(), /origin\/feature\/login2/, 'the default push is part of the preview')
assert.equal(await page.locator('.gp-flow-map__node--new').count(), 2, 'the local branch and its new remote both read as created')
assert.equal(
  await page.locator('.gp-flow-map__node--remote.gp-flow-map__node--new').textContent(),
  'origin/feature/login2',
  'a remote branch the push creates is marked as new',
)
assert.equal(await page.locator('.gp-flow-map__node--gone').count(), 0, 'a start deletes nothing')
// The start form has no second stage: it shows the shared busy overlay while
// the single write runs, and every dismissal path is locked meanwhile.
await page.evaluate(() => { window.__gpFixture.holdRun = { kind: 'flow-start' } })
await submit(page)
await page.waitForFunction(() => window.__gpFixture.releaseRun !== null)
assert.match(await page.locator('.gp-modal--flow .gp-modal__overlay-label').textContent(), /正在开始/, 'the start reports what is running')
assert.equal(await page.locator('.gp-modal--flow .gp-modal__close').isDisabled(), true, 'busy start cannot be dismissed')
await page.evaluate(() => {
  window.__gpFixture.holdRun = null
  window.__gpFixture.releaseRun()
})
await page.waitForFunction(() => document.querySelector('.gp-modal--flow') === null)
let sent = await actions(page)
assert.deepEqual(sent[sent.length - 1], {
  kind: 'flow-start', flow: 'feature', branch: 'feature/login2', base: 'develop', pushRemote: 'origin',
}, 'the start action carries the resolved base and the default publish')

// ── 1b. the legend reflows inside a phone-width dialog ─────────────────────

const phone = await openPanel(SNAP)
await pickEntry(phone, '开始 Feature')
await phone.setViewportSize({ width: 390, height: 844 })
await phone.evaluate(() => {
  const panel = document.getElementById('panel')
  panel.style.width = '390px'
  panel.style.height = '760px'
})
await flush(phone)
const phoneFit = await phone.evaluate(() => {
  const card = document.querySelector('.gp-flow-map')
  const form = document.querySelector('.gp-modal--flow .gp-modal__form')
  const chain = card.querySelector('.gp-flow-chain')
  return {
    cardOverflow: card.scrollWidth - card.clientWidth,
    formOverflow: form.scrollWidth - form.clientWidth,
    cols: chain.querySelectorAll('.gp-flow-chain__col').length,
    width: document.querySelector('.gp-modal--flow').getBoundingClientRect().width,
  }
})
assert.equal(phoneFit.cardOverflow, 0, 'the legend does not overflow a phone-width dialog')
assert.equal(phoneFit.formOverflow, 0, 'the dialog body does not scroll sideways')
assert.equal(phoneFit.cols, 2, 'the phone keeps the two-node chain')
assert.ok(phoneFit.width < 420, 'the dialog is inside the narrow container-query band')
await phone.close()

// ── 2. finish form: squash needs the forced-delete acknowledgement ─────────

await pickEntry(page, '完成 Feature')
const confirm = page.locator('.gp-modal--flow .gp-modal__footer .gp-btn:last-child')
assert.equal(await confirm.isDisabled(), false, 'merge + delete is the default and needs no extra step')
assert.equal(await confirm.evaluate((button) => button.classList.contains('gp-btn--danger')), true, 'a finish that deletes is painted as destructive')
assert.equal(await page.locator('.gp-modal__check').count(), 4, 'delete branch / delete remote / push / start release (no force box yet)')
assert.equal(await page.locator('.gp-modal__check input').last().isChecked(), false, 'starting the next release is off by default and sits last')
assert.equal(await page.locator('.gp-flow__field input[id$="-release"]').count(), 0, 'the release name field stays hidden until checked')
assert.equal(await page.locator('.gp-modal__check input').nth(2).isChecked(), true, 'push-to-remote defaults on when the remote has the branches')
assert.equal(await page.locator('.gp-modal__check input').nth(1).isChecked(), true, 'the remote delete starts checked when the branch has an upstream')
assert.equal(await page.locator('.gp-flow-map__node--gone').count(), 2, 'source branch and its remote read as deleted in the preview')
assert.equal(await page.locator('.gp-flow-chain--2').count(), 1, 'a feature is a two-branch chain')
assert.equal(await page.locator('.gp-flow-chain__col > .gp-flow-map__node:first-child').count(), 2, 'two local branch nodes')
assert.match(await page.locator('.gp-flow-chain').textContent(), /origin\/develop/, 'the pushed remote hangs under develop')
assert.equal(await page.locator('.gp-flow-chain__v:not(.gp-flow-chain__v--none)').count(), 2, 'the pushed develop and the deleted feature upstream')
assert.equal(await page.locator('.gp-flow-chain__v--del').count(), 1, 'the default remote delete is painted as a red connector')

await page.locator('.gp-flow__mode input').nth(1).check()
await flush(page)
assert.equal(await confirm.isDisabled(), true, 'a squashed branch delete needs its own acknowledgement')
const labels = await page.locator('.gp-modal__check').allTextContents()
assert.ok(labels.some((text) => /压缩合并/.test(text)), 'the force checkbox explains why the delete is forced')

await page.locator('.gp-modal__check input').nth(1).check()
await flush(page)
assert.equal(await confirm.isDisabled(), false, 'the acknowledgement unlocks the finish')
const finishLabels = await page.locator('.gp-modal__check').allTextContents()
assert.equal(await page.locator('.gp-modal__check input').nth(3).isChecked(), true, 'the push choice survived the force acknowledgement')
await flush(page)
assert.ok(finishLabels.length === 5)
// Finishing with the remote delete checked raises a second confirmation; the
// acknowledgement there is what reaches the wire (the form's 完成 does not).
const sentBefore = (await actions(page)).length
await page.locator('.gp-modal--flow .gp-modal__footer .gp-btn:last-child').click()
await flush(page)
const remoteCard = remoteDeleteConfirm(page)
assert.equal(await remoteCard.count(), 1, 'the remote delete asks a second time')
assert.equal(await page.locator('.gp-modal--flow').count(), 1, 'the finish form stays open behind the confirmation')
assert.match(await remoteCard.textContent(), /origin\/feature\/login/, 'the confirmation names the remote ref')
const remoteDanger = remoteCard.locator('.gp-btn--danger')
assert.equal(await remoteDanger.isDisabled(), true, 'the acknowledgement is the only unlock')
assert.equal(await remoteCard.locator('.gp-modal__check input').isChecked(), false, 'the acknowledgement starts unchecked')
assert.equal((await actions(page)).length, sentBefore, 'no action went out yet')
await page.keyboard.press('Escape')
await flush(page)
assert.equal(await remoteCard.count(), 0, 'Escape closes only the confirmation')
assert.equal(await page.locator('.gp-modal--flow').count(), 1, 'the form keeps its choices')
await page.waitForFunction(() => document.activeElement?.classList.contains('gp-btn--danger') === true)
await page.locator('.gp-modal--flow .gp-modal__footer .gp-btn:last-child').click()
await flush(page)
await remoteCard.locator('.gp-modal__check input').check()
assert.equal(await remoteDanger.isDisabled(), false, 'the acknowledgement unlocks the finish')
await remoteDanger.click()
await page.waitForFunction(() => document.querySelector('.gp-modal--flow') === null)
sent = await actions(page)
assert.deepEqual(sent[sent.length - 1], {
  kind: 'flow-finish', flow: 'feature', branch: 'feature/login', target: 'develop',
  strategy: 'squash', message: '完成 feature/login', deleteBranch: true, deleteRemote: true,
  pushRemote: 'origin', forceDelete: true,
}, 'the finish action carries exactly the choices the form showed')

// ── 2a. finish feature can chain the next release start ───────────────────

const chainPage = await openPanel(SNAP)
await pickEntry(chainPage, '完成 Feature')
const releaseToggle = chainPage.locator('.gp-modal__check input').last()
assert.equal(await releaseToggle.isChecked(), false, 'the chained release starts unchecked and sits last')
await releaseToggle.check()
await flush(chainPage)
const releaseInput = chainPage.locator('.gp-flow__field input[id$="-release"]')
assert.equal(await releaseInput.count(), 1, 'checking the option reveals the release name field')
assert.equal(await releaseInput.inputValue(), 'v1.3.0', 'the next release version is read off the tag')
assert.match(await chainPage.locator('.gp-flow-map').textContent(), /release\/v1\.3\.0/, 'the preview draws the new release branch')
assert.equal(await chainPage.locator('.gp-flow-chain--3').count(), 1, 'the preview grows from a two- to a three-branch chain')
assert.equal(await chainPage.locator('.gp-flow-chain__col').count(), 3, 'the chained release adds a visible graph column')
assert.equal(await chainPage.locator('.gp-flow-map__node--new').count(), 2, 'the release and its new remote are the only new nodes')
assert.ok((await chainPage.locator('.gp-modal__check').allTextContents()).some((text) => /开始 Release/.test(text)))
assert.equal(await chainPage.locator('.gp-modal__check').count(), 5, 'the chained release adds its own push choice')
const chainReleasePush = chainPage.locator('.gp-modal__check input').last()
assert.equal(await chainReleasePush.isChecked(), true, 'pushing the new release defaults on')
assert.match(await chainPage.locator('.gp-flow-map').textContent(), /origin\/release\/v1\.3\.0/, 'the default push draws the release remote branch')
assert.equal(
  await chainPage.locator('.gp-flow-map__node--remote.gp-flow-map__node--new').textContent(),
  'origin/release/v1.3.0',
  'the new release remote is marked as new',
)
await chainReleasePush.uncheck()
await flush(chainPage)
assert.doesNotMatch(await chainPage.locator('.gp-flow-map').textContent(), /origin\/release/, 'unchecking drops the release remote from the preview')
await chainReleasePush.check()
await flush(chainPage)
await releaseInput.fill('1.4.0')
await flush(chainPage)
assert.match(await chainPage.locator('.gp-flow-map').textContent(), /release\/1\.4\.0/, 'the preview follows the edited name')
assert.match(await chainPage.locator('.gp-flow-map').textContent(), /origin\/release\/1\.4\.0/, 'the release remote follows the edited name too')
await submitFinish(chainPage)
await chainPage.waitForFunction(() => document.querySelector('.gp-modal--flow') === null)
const chained = await actions(chainPage)
assert.equal(chained[chained.length - 1].startRelease, 'release/1.4.0', 'the finish carries the full release branch')
assert.equal(chained[chained.length - 1].pushRemote, 'origin', 'the default publish still covers the moved branches')
assert.equal(chained[chained.length - 1].releasePushRemote, 'origin', 'the release push is a separate wire field')
await chainPage.close()

// ── 2a2. no version tag: the release push still updates the legend ────────

const untagged = await openPanel(SNAP, REMOTE_BRANCHES, [])
await pickEntry(untagged, '完成 Feature')
await untagged.locator('.gp-modal__check input').last().check()
await flush(untagged)
const untaggedInput = untagged.locator('.gp-flow__field input[id$="-release"]')
assert.equal(await untaggedInput.inputValue(), '', 'without a version tag the name starts empty')
assert.match(await untagged.locator('.gp-flow-map').textContent(), /release\/…/, 'the placeholder release is previewed')
const untaggedPush = untagged.locator('.gp-modal__check input').last()
assert.equal(await untaggedPush.isChecked(), true, 'the release push defaults on without a version tag too')
assert.match(await untagged.locator('.gp-flow-map').textContent(), /origin\/release\/…/, 'the default push previews the placeholder remote release')
assert.equal(
  await untagged.locator('.gp-flow-map__node--remote.gp-flow-map__node--new').textContent(),
  'origin/release/…',
  'the placeholder remote release is marked as new',
)
await untaggedPush.uncheck()
await flush(untagged)
assert.doesNotMatch(await untagged.locator('.gp-flow-map').textContent(), /origin\/release/, 'unchecking drops the placeholder remote')
await untaggedPush.check()
await flush(untagged)
assert.equal(await untagged.locator('.gp-modal--flow .gp-modal__footer .gp-btn:last-child').isDisabled(), true, 'an empty name still blocks the finish')
await untagged.close()

// ── 2b. a release finish names both landing branches ──────────────────────

const releasePage = await openPanel({ ...SNAP, branch: 'release/1.2.0' })
await pickEntry(releasePage, '完成 Release')
assert.equal(await releasePage.locator('.gp-flow-chain--3').count(), 1, 'a release is a three-branch chain')
assert.deepEqual(
  await releasePage.locator('.gp-flow-chain__col > .gp-flow-map__node:first-child .gp-flow-map__name').allTextContents(),
  ['release/1.2.0', 'main', 'develop'],
  'the local chain runs release → main → develop',
)
assert.equal(await releasePage.locator('.gp-flow-chain__h').count(), 2, 'two horizontal edges')
assert.deepEqual(
  await releasePage.locator('.gp-flow-map__node--remote').allTextContents(),
  ['origin/release/1.2.0', 'origin/main', 'origin/develop'],
  'the default remote delete and both pushed branches hang under their local branch',
)
assert.equal(await releasePage.locator('.gp-flow-chain__v:not(.gp-flow-chain__v--none)').count(), 3, 'two pushes and one remote delete')
assert.match(await releasePage.locator('.gp-flow-map__tag').textContent(), /1\.2\.0/, 'the tag rides on the main line')
assert.equal(await releasePage.locator('.gp-flow__target').count(), 0, 'the chain names the fixed target, so no duplicate value row')
assert.equal(await releasePage.locator('.gp-modal__confirmtext').count(), 0, 'the legend replaced the prose body')
assert.equal(await releasePage.locator('.gp-flow__field select').count(), 0, 'a release has one fixed landing main line')
const releasePush = await releasePage.locator('.gp-modal__check').last().textContent()
assert.match(releasePush, /origin\/main.*origin\/develop/, 'the push option names both moved branches')
assert.equal(await releasePage.locator('.gp-modal__check input').last().isChecked(), true, 'pushing both branches is on by default')

// The remote delete starts checked (there is an upstream), and unchecking
// removes the struck pill again.
assert.equal(await releasePage.locator('.gp-modal__check input').nth(1).isChecked(), true, 'the remote delete defaults on')
assert.equal(await releasePage.locator('.gp-flow-map__node--gone').count(), 2, 'source and its remote both read as deleted')
assert.equal(await releasePage.locator('.gp-flow-chain__v--del').count(), 1, 'the deleted remote connector is red')
assert.match(await releasePage.locator('.gp-flow-chain').textContent(), /origin\/release\/1\.2\.0/)
await releasePage.locator('.gp-modal__check input').nth(1).uncheck()
await flush(releasePage)
assert.equal(await releasePage.locator('.gp-flow-map__node--gone').count(), 1, 'unchecking leaves only the local delete')
await releasePage.locator('.gp-modal__check input').nth(1).check()
await flush(releasePage)
assert.equal(await releasePage.locator('.gp-flow-map__node--gone').count(), 2, 'rechecking restores the remote delete')
await submitFinish(releasePage)
await releasePage.waitForFunction(() => document.querySelector('.gp-modal--flow') === null)
sent = await actions(releasePage)
assert.equal(sent[sent.length - 1].target, 'main', 'a release submits the main line as its target')
assert.equal(sent[sent.length - 1].deleteRemote, true, 'the default remote delete is part of the submitted action')
assert.equal(sent[sent.length - 1].pushRemote, 'origin', 'the default push is part of the submitted action')
await releasePage.close()

// ── 2c. no upstream: the remote delete stays off and disabled ──────────────

const noUpstream = await openPanel({ ...SNAP, hasUpstream: false })
await pickEntry(noUpstream, '完成 Feature')
const remoteChoice = noUpstream.locator('.gp-modal__check input').nth(1)
assert.equal(await remoteChoice.isChecked(), false, 'nothing to delete on the remote leaves the choice off')
assert.equal(await remoteChoice.isDisabled(), true, 'the remote delete is disabled without an upstream')
const noUpstreamFinish = noUpstream.locator('.gp-modal--flow .gp-modal__footer .gp-btn:last-child')
assert.equal(await noUpstreamFinish.evaluate((button) => button.classList.contains('gp-btn--danger')), true, 'deleting the local branch still paints the finish as destructive')
await noUpstream.locator('.gp-modal__check input').first().uncheck()
await flush(noUpstream)
assert.equal(await noUpstreamFinish.evaluate((button) => button.classList.contains('gp-btn--primary')), true, 'with both deletes off the finish returns to the primary tone')
await noUpstream.close()

// ── 2d. a remote without develop still accepts the default push ────────────

const missingDevelop = await openPanel(SNAP, [{ name: 'origin/main', shortHash: 'de54fc0' }])
await pickEntry(missingDevelop, '完成 Feature')
const pushChoice = missingDevelop.locator('.gp-modal__check input').nth(2)
assert.equal(await pushChoice.isChecked(), true, 'the finish push still defaults on')
assert.equal(await pushChoice.isDisabled(), false, 'a missing remote branch does not disable the push')
assert.match(await missingDevelop.locator('.gp-flow-map').textContent(), /origin\/develop/, 'the preview still names the pushed develop')
assert.equal(
  await missingDevelop.locator('.gp-flow-map__node--remote.gp-flow-map__node--new').textContent(),
  'origin/develop',
  'the missing remote develop is marked as new',
)
// With the remote delete unchecked there is nothing to authorise, but the
// finish still raises its step confirmation before anything is written.
await missingDevelop.locator('.gp-modal__check input').nth(1).uncheck()
await flush(missingDevelop)
await missingDevelop.locator('.gp-modal--flow .gp-modal__footer .gp-btn:last-child').click()
await flush(missingDevelop)
const plainConfirm = remoteDeleteConfirm(missingDevelop)
assert.equal(await plainConfirm.count(), 1, 'every finish confirms the steps it will run')
assert.equal(await plainConfirm.locator('.gp-modal__check input').count(), 0, 'without a remote delete there is nothing to acknowledge')
await plainConfirm.locator('.gp-modal__footer .gp-btn:last-child').click()
await missingDevelop.waitForFunction(() => document.querySelector('.gp-modal--flow') === null)
sent = await actions(missingDevelop)
assert.equal(sent[sent.length - 1].pushRemote, 'origin', 'the push creates develop on the remote')
await missingDevelop.close()

// ── 3. busy lock + a refusal stays inside the dialog ───────────────────────

await pickEntry(page, '完成 Feature')
const before = (await actions(page)).length
const busyCard = remoteDeleteConfirm(page)
await page.locator('.gp-modal--flow .gp-modal__footer .gp-btn:last-child').click()
await flush(page)
await busyCard.locator('.gp-modal__check input').check()
await page.evaluate(() => {
  const fixture = window.__gpFixture
  fixture.holdRun = { kind: 'flow-finish' }
  fixture.runFailure = { kind: 'flow-finish', code: 'local-changes-block' }
})
await busyCard.locator('.gp-btn--danger').evaluate((button) => { button.click(); button.click() })
await page.waitForFunction(() => window.__gpFixture.releaseRun !== null)
assert.equal(await busyCard.locator('.gp-btn--danger').isDisabled(), true, 'busy confirm disabled')
assert.equal(await busyCard.locator('.gp-modal__close').isDisabled(), true, 'busy close disabled')
assert.match(await busyCard.locator('.gp-modal__overlay-label').textContent(), /正在完成/, 'the confirmation shows the running finish')
await page.evaluate(() => {
  window.__gpFixture.holdRun = null
  window.__gpFixture.releaseRun()
})
await page.waitForFunction(() => document.querySelector('.gp-modal--sm:not(.gp-modal--flow) .gp-feedback') !== null)
assert.match(await busyCard.locator('.gp-feedback').textContent(), /未提交变更/, 'the host refusal renders in the confirmation')
assert.equal(await page.locator('.gp-modal--sm:not(.gp-modal--flow)').count(), 1, 'a failure keeps the confirmation open')
assert.equal((await actions(page)).length, before + 1, 'a double press reaches the wire once')
await busyCard.locator('.gp-modal__footer .gp-btn').first().click()
await flush(page)
assert.equal(await page.locator('.gp-modal--flow').count(), 1, 'cancelling the confirmation returns to the form')
await page.locator('.gp-modal--flow .gp-modal__footer .gp-btn').first().click()
await page.waitForFunction(() => document.querySelector('.gp-modal--flow') === null)
await page.close()

// ── 4. the entry is gated on the host capability ───────────────────────────

const { capabilities: _capabilities, ...older } = SNAP
const oldHost = await openPanel(older)
assert.equal(await oldHost.locator('.gp-flow-btn').count(), 0, 'an older host gets no flow entry instead of a failing button')
await oldHost.close()

assert.deepEqual(consoleErrors, [], 'no console errors')
await browser.close()
console.log('flow-dialogs: ok')
