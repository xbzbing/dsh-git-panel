/**
 * E2E: the changes list's batch discard + the per-row hover hints (issue #40).
 *
 * (a) Checking two working-tree rows enables the toolbar's "discard selected"
 *     entry; its confirm dialog states the deduped file count (never a file
 *     list) and confirming sends one `{kind:'discard', paths}` carrying the
 *     working-tree paths only.
 * (b) A staged-only pick enables nothing (there is nothing to discard there);
 *     mixing it into a live selection adds the "not affected" line and still
 *     keeps its path out of the request.
 * (b2) The same mix as its own scenario, asserting the request carries the
 *     working-tree path alone.
 * (b3) An untracked directory reaches the request and is named as a disk
 *     deletion.
 * (c) The two row icon buttons explain themselves through the shared fast
 *     tooltip (a `div.gp-tip.gp-tip--sb` portaled to body, ~140ms delay),
 *     including the armed "click again" wording, while `aria-label` keeps the
 *     short name and no native `title` is left behind.
 * (d) The same tooltip contract for the stage hint on a working-tree row.
 * (e) A host refusal (`nested-repo`, e.g. discarding a directory that is
 *     itself a repository) surfaces the localized zh copy inside the still-open
 *     confirm dialog instead of closing it as if the discard had landed.
 * (f) Touch media: the compact 30px control height must outrank the global
 *     `@media (hover:none)` rule.
 * (g) A refused batch discard (`index-busy`, the index lock) keeps the dialog
 *     open with the localized copy, disables the confirm key only while the
 *     call is in flight, re-enables it afterwards, and re-sends exactly one
 *     `{kind:'discard', paths}` on retry.
 * (h) A snapshot poll that drops the checked row prunes the selection to empty:
 *     the dialog closes on its own, the entry returns to disabled, and a fresh
 *     pick does not resurrect the stale dialog.
 * (i) Group select-all (issue #60): each group head carries a tri-state
 *     checkbox. One press picks the whole group (enabling "discard selected"
 *     for a 20-file batch in one step), the state reads `partial` for a
 *     half-picked group, a second press clears just that group, and the press
 *     must not also collapse the group.
 *
 * Unlike the older runners this harness binds the *real* zh dictionary, so the
 * assertions pin the user-visible copy (and the body's {count} interpolation)
 * rather than locale keys. Isolated file:// harness, no dsh server; run
 * test/e2e/setup.mjs first.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

const FIXTURE_ROOT = 'fixture-repo'

// dup.txt carries both sides (porcelain `MM`): picking its `:s` row must read as
// staged-only, picking its `:w` row must clear that, and the batch count must
// dedupe the file. s1.txt is index-only; w1.txt is working-tree only. del.txt is
// an index-side deletion and rn.txt an index-side rename — the two index status
// letters whose discard button used to no-op or fail outright — and newdir is an
// untracked directory, which porcelain collapses into one entry.
//
// The array order is load-bearing: keep the unstaged `dup.txt` row next to the
// staged one so the input order does NOT already match the rendered order. The
// list groups staged → unstaged → untracked and sorts by path
// (ChangesTab.tsx), so a fixture that arrives pre-grouped would make the
// `staged group first` row assertion pass even if the grouping were removed.
const SNAP = {
  root: FIXTURE_ROOT, branch: 'main', head: 'de54fc0', unborn: false, dirty: true,
  staged: 4, modified: 2, untracked: 1, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null,
  changes: [
    { path: 'del.txt', status: 'deleted', staged: true, isDirectory: false },
    { path: 'dup.txt', status: 'modified', staged: true, isDirectory: false },
    { path: 'dup.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'rn.txt', status: 'renamed', staged: true, isDirectory: false },
    { path: 's1.txt', status: 'modified', staged: true, isDirectory: false },
    { path: 'w1.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'newdir', status: 'untracked', staged: false, isDirectory: true },
  ],
  // `fileCount` is the distinct-path count (host `core.ts`: `distinct.size`), so
  // the two dup.txt rows count once: 6 distinct paths, 7 list entries.
  stats: { fileCount: 6, staged: 4, modified: 2, untracked: 1, insertions: 5, deletions: 1, lastChangeAt: Date.now(), headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}

const STAGE_GLYPH = '+'
const UNSTAGE_GLYPH = '\u2212'

const browser = await chromium.launch()

/**
 * Mount the panel against the mock connection with the real zh dictionary bound
 * (the mock records every `run` action on `window.__gpFixture.actions`). A dirty
 * snapshot defaults to the changes sub-tab, so the toolbar is on screen once the
 * discard entry appears.
 */
async function openPanel(snap, opts = {}) {
  const page = opts.page ?? await browser.newPage()
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  await page.evaluate(async ({ snapshot, width, height }) => {
    if (width !== null) document.getElementById('panel').style.width = `${width}px`
    if (height !== null) document.getElementById('panel').style.height = `${height}px`
    const { fixture, connection } = window.createGitPanelMock(snapshot)
    window.__gpFixture = fixture
    const registered = {}
    const dictionaries = {}
    const interpolate = (raw, params) => params === undefined
      ? raw
      : raw.replace(/\{(\w+)\}/g, (m, key) => (key in params ? String(params[key]) : m))
    const ctx = {
      get: (k) => ({ connection })[k],
      effect: (cb) => { try { cb() } catch (e) { /* ignore */ } },
      on: (event, listener) => { if (event === 'connection/reset') fixture.resetConnection = listener; return () => {} },
      inject: (_deps, cb) => cb(ctx),
      slots: { inject: (_name, provider) => provider(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
      // The registered zh/en dictionaries instead of a key-echoing stub: the
      // changes copy and its {count} params are what these assertions pin.
      locale: {
        register: (ns, dict) => { dictionaries[ns] = dict },
        bind: (ns) => (key, params) => {
          const raw = dictionaries[ns] && dictionaries[ns].zh[key]
          return raw === undefined ? key : interpolate(raw, params)
        },
      },
    }
    window.__getLoaded().apply(ctx)
    window.ReactDOM.createRoot(document.getElementById('panel')).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
    await new Promise((r) => setTimeout(r, 500))
  }, { snapshot: snap, width: opts.width ?? null, height: opts.height ?? null })
  await page.waitForSelector('.gp-changes__discard-picked', { timeout: 5000 })
  return { page, errors }
}

/** (a)+(b): toolbar entry, confirm dialog copy, and the request that lands. */
async function batchScenario() {
  const { page, errors } = await openPanel(SNAP)
  const out = await page.evaluate(async (glyphs) => {
    const result = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const rows = () => [...document.querySelectorAll('.gp-file-row')]
    // A path can hold two rows; the first icon button's glyph names the side
    // (`+` working tree, `-` index) exactly like the ui shows it.
    const rowOf = (name, glyph) => rows().find((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === name
      && (r.querySelector('.gp-file-row__actions .gp-icon-btn')?.textContent ?? '') === glyph) ?? null
    const pick = async (name, glyph) => {
      rowOf(name, glyph)?.querySelector('input.gp-check')?.click()
      await wait(60)
    }
    const picked = () => document.querySelector('.gp-changes__discard-picked')
    const confirmBtn = () => [...document.querySelectorAll('.gp-modal--sm .gp-modal__footer .gp-btn')]
      .find((b) => b.classList.contains('gp-btn--danger')) ?? null

    result.rows = rows().map((r) => `${r.querySelector('.gp-tree-name')?.textContent}:${r.querySelector('.gp-file-row__actions .gp-icon-btn')?.textContent}`)
    // The index-side rename row must read as a rename (`R`) and, like the
    // deletion, offer unstage only — `git restore --` cannot touch the index.
    result.renamedBadge = rows().find((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === 'rn.txt')
      ?.querySelector('.gp-status-badge')?.textContent ?? null
    // Per-row action inventory: discard is a working-tree operation, so the
    // index-side rows must offer unstage only.
    result.rowActions = rows().map((r) => ({
      row: `${r.querySelector('.gp-tree-name')?.textContent}:${r.querySelector('.gp-file-row__actions .gp-icon-btn')?.textContent}`,
      labels: [...r.querySelectorAll('.gp-file-row__actions .gp-icon-btn')].map((b) => b.getAttribute('aria-label')),
    }))
    // Toolbar entries are tip-wrapped: each shell holds one button with the
    // accessible name (issue #61).
    const toolbar = [...document.querySelectorAll('.gp-toolbar button')]
    result.toolbar = toolbar.map((b) => b.getAttribute('aria-label'))
    // The icon entry retains its accessible name and position between these actions.
    // Toolbar order: stage-picked, stage-all, unstage-all, discard-picked, …
    result.entryAfterUnstageAll = toolbar[3] === picked() && toolbar[2].getAttribute('aria-label') === '全部取消暂存'
    result.entryBeforeStash = (toolbar[5].getAttribute('aria-label') ?? '').includes('贮藏')
    result.entryLabel = picked().getAttribute('aria-label')
    result.disabledEmpty = picked().disabled === true

    await pick('dup.txt', glyphs.unstage)
    result.disabledStagedOnly = picked().disabled === true
    await pick('dup.txt', glyphs.stage)
    await pick('w1.txt', glyphs.stage)
    result.enabledAfterPicks = picked().disabled === false

    picked().click()
    await wait(150)
    const modal = document.querySelector('.gp-modal--sm')
    result.modalShown = modal !== null
    result.modalPortaled = modal !== null && !document.getElementById('panel').contains(modal)
    result.modalTitle = modal?.querySelector('.gp-modal__path')?.textContent ?? null
    result.modalTexts = [...(modal?.querySelectorAll('.gp-modal__confirmtext') ?? [])].map((n) => n.textContent)
    const ok = confirmBtn()
    result.confirmLabel = ok?.textContent ?? null
    result.confirmDanger = ok?.classList.contains('gp-btn--danger') === true
    const actionsBefore = window.__gpFixture.actions.length
    ok?.click()
    await wait(250)
    result.actions = window.__gpFixture.actions.slice(actionsBefore)
    result.modalClosed = document.querySelector('.gp-modal--sm') === null
    return result
  }, { stage: STAGE_GLYPH, unstage: UNSTAGE_GLYPH })
  await page.close()
  return { out, errors }
}

/** (b2): a staged-only pick mixed with a working-tree pick. */
async function stagedOnlyScenario() {
  const { page, errors } = await openPanel(SNAP)
  const out = await page.evaluate(async (glyphs) => {
    const result = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const rows = () => [...document.querySelectorAll('.gp-file-row')]
    const rowOf = (name, glyph) => rows().find((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === name
      && (r.querySelector('.gp-file-row__actions .gp-icon-btn')?.textContent ?? '') === glyph) ?? null
    const pick = async (name, glyph) => {
      rowOf(name, glyph)?.querySelector('input.gp-check')?.click()
      await wait(60)
    }
    const picked = () => document.querySelector('.gp-changes__discard-picked')

    await pick('s1.txt', glyphs.unstage)
    result.disabledStagedOnly = picked().disabled === true
    await pick('w1.txt', glyphs.stage)
    result.enabledMixed = picked().disabled === false
    picked().click()
    await wait(150)
    const modal = document.querySelector('.gp-modal--sm')
    result.modalTexts = [...(modal?.querySelectorAll('.gp-modal__confirmtext') ?? [])].map((n) => n.textContent)
    const actionsBefore = window.__gpFixture.actions.length
    ;[...document.querySelectorAll('.gp-modal--sm .gp-modal__footer .gp-btn--danger')][0]?.click()
    await wait(250)
    result.actions = window.__gpFixture.actions.slice(actionsBefore)
    return result
  }, { stage: STAGE_GLYPH, unstage: UNSTAGE_GLYPH })
  await page.close()
  return { out, errors }
}

/** (b3): an untracked directory reaches the request and is named as a disk deletion. */
async function untrackedDirScenario() {
  const { page, errors } = await openPanel(SNAP)
  const out = await page.evaluate(async (glyphs) => {
    const result = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const rowOf = (name, glyph) => [...document.querySelectorAll('.gp-file-row')].find((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === name
      && (r.querySelector('.gp-file-row__actions .gp-icon-btn')?.textContent ?? '') === glyph) ?? null
    const picked = () => document.querySelector('.gp-changes__discard-picked')

    // The untracked directory is one row (porcelain collapses `?? newdir/`).
    rowOf('newdir', glyphs.stage)?.querySelector('input.gp-check')?.click()
    await wait(60)
    result.enabled = picked().disabled === false
    picked().click()
    await wait(150)
    const modal = document.querySelector('.gp-modal--sm')
    result.modalTexts = [...(modal?.querySelectorAll('.gp-modal__confirmtext') ?? [])].map((n) => n.textContent)
    const actionsBefore = window.__gpFixture.actions.length
    ;[...document.querySelectorAll('.gp-modal--sm .gp-modal__footer .gp-btn--danger')][0]?.click()
    await wait(250)
    result.actions = window.__gpFixture.actions.slice(actionsBefore)
    return result
  }, { stage: STAGE_GLYPH })
  await page.close()
  return { out, errors }
}

/** (e): a repository refusal keeps the dialog open with the localized copy. */
async function nestedRepoErrorScenario(code) {
  const { page, errors } = await openPanel(SNAP)
  const out = await page.evaluate(async (args) => {
    const result = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const rowOf = (name, glyph) => [...document.querySelectorAll('.gp-file-row')].find((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === name
      && (r.querySelector('.gp-file-row__actions .gp-icon-btn')?.textContent ?? '') === glyph) ?? null
    const picked = () => document.querySelector('.gp-changes__discard-picked')
    // The host refuses a directory that is itself a repository; the mock
    // replays that wire error for the discard action without modeling git.
    window.__gpFixture.runFailure = { kind: 'discard', code: args.code, message: 'repository directory: newdir' }
    const row = rowOf('newdir', args.stage)
    result.rowFound = row !== null
    row?.querySelector('input.gp-check')?.click()
    await wait(60)
    result.enabled = picked().disabled === false
    picked().click()
    await wait(150)
    result.modalShown = document.querySelector('.gp-modal--sm') !== null
    const actionsBefore = window.__gpFixture.actions.length
    ;[...document.querySelectorAll('.gp-modal--sm .gp-modal__footer .gp-btn--danger')][0]?.click()
    await wait(250)
    result.actions = window.__gpFixture.actions.slice(actionsBefore)
    const modal = document.querySelector('.gp-modal--sm')
    result.modalOpen = modal !== null
    result.feedback = modal?.querySelector('.gp-feedback')?.textContent ?? null
    return result
  }, { stage: STAGE_GLYPH, code })
  await page.close()
  return { out, errors }
}

/**
 * (g) A refused batch discard is not a silent success. The host's `index-busy`
 *     refusal lands while the confirm key is disabled (the in-flight latch);
 *     the dialog then stays open with the localized copy, the confirm key comes
 *     back enabled, and the retry sends exactly one `{kind:'discard', paths}`.
 */
async function discardFailureScenario() {
  const { page, errors } = await openPanel(SNAP)
  const out = await page.evaluate(async (glyphs) => {
    const result = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const rowOf = (name, glyph) => [...document.querySelectorAll('.gp-file-row')].find((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === name
      && (r.querySelector('.gp-file-row__actions .gp-icon-btn')?.textContent ?? '') === glyph) ?? null
    const picked = () => document.querySelector('.gp-changes__discard-picked')
    const confirmBtn = () => [...document.querySelectorAll('.gp-modal--sm .gp-modal__footer .gp-btn')]
      .find((b) => b.classList.contains('gp-btn--danger')) ?? null
    const overlay = () => document.querySelector('.gp-modal--sm .gp-modal__overlay')
    const actions = () => window.__gpFixture.actions.map((a) => ({ kind: a.kind, paths: a.paths }))

    // The host refuses the discard with an index lock; the mock parks the call
    // so the in-flight state is observable before the refusal lands.
    window.__gpFixture.runFailure = { kind: 'discard', code: 'index-busy', message: 'index.lock: File exists' }
    window.__gpFixture.holdRun = { kind: 'discard' }
    rowOf('w1.txt', glyphs.stage)?.querySelector('input.gp-check')?.click()
    await wait(60)
    result.enabled = picked().disabled === false
    picked().click()
    await wait(150)
    result.modalShown = document.querySelector('.gp-modal--sm') !== null
    const beforeFirst = window.__gpFixture.actions.length
    confirmBtn()?.click()
    // The mock publishes its release handle as soon as the call parks; the
    // busy render lands a tick later, so wait for the disabled key itself.
    for (let i = 0; i < 60 && confirmBtn()?.disabled !== true; i++) await wait(25)
    result.inflightParked = window.__gpFixture.releaseRun !== null
    result.inflightActions = actions().slice(beforeFirst)
    result.inflightConfirmDisabled = confirmBtn()?.disabled === true
    result.inflightOverlay = overlay()?.textContent ?? null
    // N1: while a write is in flight the whole pick surface freezes — row
    // checkboxes and the group-head select-all alike (same `busy` gate).
    result.inflightRowChecksDisabled = [...document.querySelectorAll('.gp-file-row input.gp-check')].every((c) => c.disabled === true)
    result.inflightGroupChecksDisabled = [...document.querySelectorAll('.gp-group-head input.gp-check')].every((c) => c.disabled === true)
    // A press while the first discard is still in flight must not queue another.
    // It holds because the key is `disabled` (the busy latch), not because of
    // `run()`'s `if (busy) return false`: React suppresses clicks on a button
    // whose props say disabled, so that re-entry guard is unreachable from the
    // DOM (flipping the DOM property does not lift the suppression) and stays
    // deliberately uncovered here.
    confirmBtn()?.click()
    await wait(80)
    result.inflightPressCount = actions().length - beforeFirst
    // Release: the refusal lands inside the still-open dialog.
    window.__gpFixture.holdRun = null
    window.__gpFixture.releaseRun?.()
    await wait(300)
    const afterFail = window.__gpFixture.actions.length
    result.failureActions = actions().slice(beforeFirst, afterFail)
    result.modalOpenAfterFail = document.querySelector('.gp-modal--sm') !== null
    result.feedback = document.querySelector('.gp-modal--sm .gp-feedback')?.textContent ?? null
    result.confirmEnabledAfterFail = confirmBtn()?.disabled === false
    result.overlayGone = overlay() === null
    // Retry: the forced failure fired once, so this attempt lands and closes.
    confirmBtn()?.click()
    await wait(300)
    result.retryActions = actions().slice(afterFail)
    result.modalClosedAfterRetry = document.querySelector('.gp-modal--sm') === null
    return result
  }, { stage: STAGE_GLYPH })
  await page.close()
  return { out, errors }
}

/**
 * (h) A snapshot poll that drops the checked row prunes the selection to empty:
 *     the dialog closes on its own, the toolbar entry returns to disabled, and
 *     a fresh pick must not resurrect the stale dialog. `refreshIntervalMs` is
 *     what makes the poll (and therefore the prune) happen.
 */
async function snapshotTrimScenario() {
  const { page, errors } = await openPanel({ ...SNAP, refreshIntervalMs: 120 })
  const out = await page.evaluate(async (glyphs) => {
    const result = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const rowOf = (name, glyph) => [...document.querySelectorAll('.gp-file-row')].find((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === name
      && (r.querySelector('.gp-file-row__actions .gp-icon-btn')?.textContent ?? '') === glyph) ?? null
    const picked = () => document.querySelector('.gp-changes__discard-picked')

    rowOf('w1.txt', glyphs.stage)?.querySelector('input.gp-check')?.click()
    await wait(60)
    result.enabledBefore = picked().disabled === false
    picked().click()
    await wait(150)
    result.modalBefore = document.querySelector('.gp-modal--sm') !== null
    // The next poll reports the file as resolved: the checked row is gone, so
    // the selection prunes to empty and nothing is left to discard.
    window.__gpFixture.snapshot = {
      ...window.__gpFixture.snapshot,
      changes: window.__gpFixture.snapshot.changes.filter((c) => c.path !== 'w1.txt'),
      checkedAt: Date.now(),
    }
    // Wait for the poll to land (bounded so a slow CI tick does not flake).
    for (let i = 0; i < 60 && rowOf('w1.txt', glyphs.stage) !== null; i++) await wait(50)
    // The prune and the auto-close land in the same commit; give React a beat.
    await wait(100)
    result.rowGone = rowOf('w1.txt', glyphs.stage) === null
    result.modalClosed = document.querySelector('.gp-modal--sm') === null
    result.entryDisabled = picked().disabled === true
    // Re-picking a living row must not pop the stale dialog back open.
    rowOf('dup.txt', glyphs.stage)?.querySelector('input.gp-check')?.click()
    await wait(250)
    result.enabledAfterRepick = picked().disabled === false
    result.modalStayedClosed = document.querySelector('.gp-modal--sm') === null
    return result
  }, { stage: STAGE_GLYPH })
  await page.close()
  return { out, errors }
}

/** (c)+(d): real pointer hover on the row buttons, tip text and delay. */
async function tipsScenario() {
  const { page, errors } = await openPanel(SNAP)
  const row = (name) => page.locator('.gp-file-row', { hasText: name })
  const button = (name, index) => row(name).locator('.gp-file-row__actions .gp-icon-btn').nth(index)
  // Record when the pointer enters the button and when the tooltip mounts, so
  // the 140ms delay is measured instead of assumed.
  await page.evaluate(() => {
    window.__tipLog = []
    document.addEventListener('mouseover', (e) => {
      const btn = e.target instanceof Element ? e.target.closest('.gp-file-row__actions .gp-icon-btn') : null
      if (btn !== null) window.__tipLog.push({ kind: 'hover', at: performance.now() })
    }, true)
    new MutationObserver(() => {
      const tip = document.querySelector('div.gp-tip.gp-tip--sb')
      if (tip !== null) window.__tipLog.push({ kind: 'tip', at: performance.now(), text: tip.textContent })
    }).observe(document.body, { childList: true, subtree: true })
  })
  const tip = () => page.evaluate(() => {
    const el = document.querySelector('div.gp-tip.gp-tip--sb')
    return el === null ? null : { text: el.textContent, onBody: el.parentElement === document.body }
  })
  // Where the bubble sits against the button it explains: the wide layout keeps
  // the left anchor, compact panels centre it.
  const tipGeometry = () => page.evaluate(() => {
    const el = document.querySelector('div.gp-tip.gp-tip--sb')
    const btn = document.querySelector('button[aria-label="再次点击以确认放弃"]')
    if (el === null || btn === null) return null
    const t = el.getBoundingClientRect()
    const b = btn.getBoundingClientRect()
    return {
      centered: el.classList.contains('gp-tip--center'),
      leftDelta: Math.round(t.left - b.left),
      centerDelta: Math.round((t.left + t.width / 2) - (b.left + b.width / 2)),
      width: Math.round(t.width),
      height: Math.round(t.height),
      top: Math.round(t.top),
      insideViewport: t.left >= -0.5 && t.right <= window.innerWidth + 0.5,
      insideVertically: t.top >= -0.5 && t.bottom <= window.innerHeight + 0.5,
    }
  })
  /** Geometry against one row's action (hover hint, rather than the armed one). */
  const tipGeometryOf = (fileName, btnSelector) => page.evaluate(({ name, sel }) => {
    const el = document.querySelector('div.gp-tip.gp-tip--sb')
    const row = [...document.querySelectorAll('.gp-file-row')]
      .find((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === name)
    const btn = row?.querySelector(sel)
    if (el === null || btn == null) return null
    const t = el.getBoundingClientRect()
    const b = btn.getBoundingClientRect()
    return {
      centered: el.classList.contains('gp-tip--center'),
      centerDelta: Math.round((t.left + t.width / 2) - (b.left + b.width / 2)),
      width: Math.round(t.width),
      height: Math.round(t.height),
      top: Math.round(t.top),
      insideViewport: t.left >= -0.5 && t.right <= window.innerWidth + 0.5,
      insideVertically: t.top >= -0.5 && t.bottom <= window.innerHeight + 0.5,
    }
  }, { name: fileName, sel: btnSelector })
  const clearLog = () => page.evaluate(() => { window.__tipLog.length = 0 })
  const readLog = () => page.evaluate(() => window.__tipLog.slice())
  const hoverButton = async (locator) => {
    // The actions are `visibility:hidden` until their row is hovered, so enter
    // the row first (a hidden box also fails Playwright's actionability check).
    await clearLog()
    await locator.hover()
    await page.waitForTimeout(300)
  }

  const result = {}
  // (d) stage hint on the working-tree row.
  await row('w1.txt').hover()
  const plus = button('w1.txt', 0)
  await hoverButton(plus)
  result.stageTip = await tip()
  result.stageLog = await readLog()
  result.stageAria = await plus.getAttribute('aria-label')
  result.stageTitle = await plus.getAttribute('title')
  result.stageGlyph = await plus.textContent()
  await page.mouse.move(2, 2)
  await page.waitForTimeout(150)
  result.stageTipGone = (await tip()) === null

  // (c) discard hint + the armed wording after one click.
  const discard = button('w1.txt', 1)
  await row('w1.txt').hover()
  await hoverButton(discard)
  result.discardTip = await tip()
  result.discardAria = await discard.getAttribute('aria-label')
  result.discardTitle = await discard.getAttribute('title')
  result.discardIcon = await discard.locator('svg').count()
  const actionsBefore = await page.evaluate(() => window.__gpFixture.actions.length)
  await discard.click()
  await page.waitForTimeout(150)
  result.armedAria = await discard.getAttribute('aria-label')
  result.armedIcon = await discard.locator('svg').count()
  result.armedTipOnClick = await tip()
  result.firstClickRunsNothing = await page.evaluate((n) => window.__gpFixture.actions.length === n, actionsBefore)
  // The armed hint stays pinned until a press outside (a move no longer hides
  // it), so dismiss it with a click before measuring a fresh hover delay.
  await page.mouse.click(2, 2)
  await page.waitForTimeout(150)
  await row('w1.txt').hover()
  await hoverButton(discard)
  result.armedTip = await tip()
  result.armedLog = await readLog()
  result.wideTipGeometry = await tipGeometry()

  // (c2) The arming press is self-explanatory: pressing the button with the
  // pointer parked away from it (so no hover can be responsible) raises the
  // confirm wording at once, an outside press dismisses it, and the next press
  // on the button runs the discard.
  // dup.txt has two rows; `.last()` is the working-tree one (staged group
  // first), and only that side carries a discard button at all.
  const discard2 = page.locator('.gp-file-row').filter({ hasText: 'dup.txt' }).last()
    .locator('button[aria-label="放弃更改"], button[aria-label="再次点击以确认放弃"]')
  // The pinned armed hint outlives the pointer now; a press outside dismisses
  // it (a plain mouse move no longer does).
  await page.mouse.click(2, 2)
  await page.waitForTimeout(200)
  result.noTipBeforePress = (await tip()) === null
  // A plain element.click() — no pointer move, so no hover/focus hint.
  await discard2.evaluate((el) => el.click())
  await page.waitForTimeout(200)
  result.armedTipOnPress = await tip()
  result.armedTipAriaOnPress = await discard2.getAttribute('aria-label')
  result.armedTipOnPressRunsNothing = await page.evaluate((n) => window.__gpFixture.actions.length === n, actionsBefore)
  const dismissBefore = await page.evaluate(() => window.__gpFixture.actions.length)
  await page.mouse.click(2, 2)
  await page.waitForTimeout(200)
  result.armedTipDismissedOutside = (await tip()) === null
  result.outsidePressRunsNothing = await page.evaluate((n) => window.__gpFixture.actions.length === n, dismissBefore)
  await discard2.evaluate((el) => el.click())
  await page.waitForTimeout(250)
  result.secondPressRan = await page.evaluate((n) => window.__gpFixture.actions.slice(n).some((a) => a.kind === 'discard' && a.paths?.includes('dup.txt')), dismissBefore)
  result.secondPressClearedTip = (await tip()) === null
  result.secondPressDisarmed = (await discard2.getAttribute('aria-label')) === '放弃更改'

  // The staged row's first button is the inverse action, with its own copy.
  await row('s1.txt').hover()
  const minus = button('s1.txt', 0)
  await hoverButton(minus)
  result.unstageTip = await tip()
  result.unstageAria = await minus.getAttribute('aria-label')
  result.unstageGlyph = await minus.textContent()

  // (c3) The compact (phone) panel centres the bubble on the row icon: the
  // action sits at the panel's right edge, where a left-anchored bubble reads
  // as belonging to the row above it.
  await page.mouse.move(2, 2)
  await page.waitForTimeout(150)
  await page.evaluate(() => { document.getElementById('panel').style.width = '360px' })
  await page.waitForTimeout(300)
  result.compactLayout = await page.evaluate(() => document.querySelector('.gp-panel')?.getAttribute('data-layout'))
  const compactDiscard = page.locator('.gp-file-row').filter({ hasText: 'newdir' })
    .locator('button[aria-label="放弃更改"]')
  await compactDiscard.evaluate((el) => el.click())
  await page.waitForTimeout(250)
  result.compactTipText = (await tip())?.text
  result.compactTipGeometry = await tipGeometry()

  // (c4) A real phone viewport, not just a narrow panel: the fixed bubble must
  // keep a readable width and stay inside both viewport edges. It used to size
  // itself from `left` to the right edge — a ~36px column — and, when it could
  // not fit at all, oscillate until React threw.
  await page.mouse.click(2, 2)
  await page.waitForTimeout(150)
  const phoneRow = page.locator('.gp-file-row').filter({ hasText: 'w1.txt' }).first()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.evaluate((w) => { document.getElementById('panel').style.width = `${w}px` }, width)
    await page.waitForTimeout(350)
    await phoneRow.hover()
    await phoneRow.locator('button[aria-label="放弃更改"]').hover()
    await page.waitForTimeout(400)
    result[`phoneTip${width}`] = await tipGeometryOf('w1.txt', 'button[aria-label="放弃更改"]')
    result[`phoneLayout${width}`] = await page.evaluate(() => document.querySelector('.gp-panel')?.getAttribute('data-layout'))
  }

  // (c5) Two guards on the armed confirmation. A double-click's second press
  // carries detail > 1 — it must not count as the confirmation (for an
  // untracked path it would delete the file). And the arm expires after its
  // deadline, so a stray later press re-arms instead of executing, with the
  // press-pinned confirm hint going away with it.
  await page.mouse.click(2, 2)
  await page.waitForTimeout(250)
  const guardBtn = page.locator('.gp-file-row').filter({ hasText: 'w1.txt' }).first()
    .locator('button[aria-label="放弃更改"], button[aria-label="再次点击以确认放弃"]')
  const guardBefore = await page.evaluate(() => window.__gpFixture.actions.length)
  await guardBtn.evaluate((el) => el.click())
  await page.waitForTimeout(200)
  result.armTipBeforeExpiry = (await tip())?.text ?? null
  await guardBtn.evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })))
  await page.waitForTimeout(200)
  result.dblPressIgnored = await page.evaluate((n) => window.__gpFixture.actions.length === n, guardBefore)
  result.stillArmedAfterDbl = (await guardBtn.getAttribute('aria-label')) === '再次点击以确认放弃'
  await page.waitForTimeout(4300)
  result.armExpired = (await guardBtn.getAttribute('aria-label')) === '放弃更改'
  result.armTipGoneOnExpiry = (await tip()) === null
  const afterExpiry = await page.evaluate(() => window.__gpFixture.actions.length)
  await guardBtn.evaluate((el) => el.click())
  await page.waitForTimeout(200)
  result.expiredPressRearmsOnly = await page.evaluate((n) => window.__gpFixture.actions.length === n, afterExpiry)
  result.expiredPressRearmed = (await guardBtn.getAttribute('aria-label')) === '再次点击以确认放弃'

  await page.close()
  return { out: result, errors }
}

/**
 * (f) Touch media: the compact 30px control height must outrank the global
 * `@media (hover:none)` rule that lifts `.gp-btn` to 36px. Desktop Chromium
 * reports `hover:hover`, so this needs a touch page.
 */
async function touchScenario() {
  const page = await browser.newPage({ hasTouch: true, viewport: { width: 390, height: 844 } })
  // A cramped panel (narrow *and* short) is what folds the editor into the bar;
  // the 30px rule only applies there, so the panel must actually be short.
  const { errors } = await openPanel(SNAP, { page, width: 390, height: 420 })
  const out = await page.evaluate(() => {
    const height = (sel) => {
      const el = document.querySelector(sel)
      return el === null ? 0 : Math.round(el.getBoundingClientRect().height)
    }
    // Cascade probe for the two toolbar families that size their icon controls
    // with a two-class selector: only a node nested under that exact wrapper
    // answers whether the touch enlargement outsizes them. Built inside
    // `.gp-panel` (so panel-scoped rules apply), measured, then removed.
    const boxed = (wrapperClass, childClass) => {
      const host = document.querySelector('.gp-panel')
      if (host === null) return null
      const wrap = document.createElement('div')
      wrap.className = wrapperClass
      const el = document.createElement('button')
      el.className = childClass
      wrap.appendChild(el)
      host.appendChild(wrap)
      const r = el.getBoundingClientRect()
      const size = { w: Math.round(r.width), h: Math.round(r.height) }
      wrap.remove()
      return size
    }
    return {
      hoverNone: matchMedia('(hover: none)').matches,
      // The phone predicate keys on this: a touch page must report a coarse
      // primary pointer, otherwise the size half alone decides the device class.
      pointerCoarse: matchMedia('(pointer: coarse)').matches,
      layout: document.querySelector('.gp-panel')?.getAttribute('data-layout'),
      barCommit: height('.gp-commitbar__commit'),
      barOpen: height('.gp-commitbar__open'),
      // `plain` is the control: the same button with no wrapper must be 34px, so
      // a 34 elsewhere cannot come from a rule that never matched.
      diffBarPlain: boxed('', 'gp-icon-btn'),
      diffBarIcon: boxed('gp-diff__toolbar', 'gp-icon-btn'),
      modalBarIcon: boxed('gp-modal__bar', 'gp-icon-btn'),
      modalBarFs: boxed('gp-modal__bar', 'gp-btn gp-files__fs-screen'),
    }
  })
  await page.close()
  return { out, errors }
}

/**
 * (i) Group select-all: the head checkbox picks a whole group in one press so a
 *     full-batch discard needs no per-row clicks (issue #60). The tri-state
 *     follows the picks, the second press clears only that group, and the press
 *     never collapses the group. The whole-group pick then drives the existing
 *     discard flow: entry enabled, dialog counts every working-tree file.
 */
async function groupSelectScenario() {
  const { page, errors } = await openPanel(SNAP)
  const out = await page.evaluate(async () => {
    const result = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const headOf = (label) => [...document.querySelectorAll('.gp-changes__vrow .gp-group-head')]
      // The label rides in its own text node ("更改 (2)"), so a prefix match on
      // that node rules out the substring hit on "已暂存的更改".
      .find((n) => [...n.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim().startsWith(`${label} (`))) ?? null
    const pickOf = (label) => headOf(label)?.querySelector('input.gp-check') ?? null
    const rows = () => [...document.querySelectorAll('.gp-file-row')]
    const checked = () => rows().filter((r) => r.querySelector('input.gp-check')?.checked === true).length
    const picked = () => document.querySelector('.gp-changes__discard-picked')

    // Fixture heads: 已暂存的更改 (4) / 更改 (2) / 未版本控制的文件 (1).
    result.headCount = document.querySelectorAll('.gp-changes__vrow .gp-group-head input.gp-check').length
    result.initial = {
      staged: pickOf('已暂存的更改')?.checked, unstaged: pickOf('更改')?.checked,
      untracked: pickOf('未版本控制的文件')?.checked,
      discardDisabled: picked()?.disabled,
      rowsExpanded: headOf('更改')?.closest('.gp-changes__vrow') !== null && rows().length,
    }

    // One press on the "更改" head picks both working-tree rows.
    pickOf('更改')?.click()
    await wait(60)
    result.afterUnstagedPick = {
      checkedRows: checked(),
      stagedHead: pickOf('已暂存的更改')?.checked,
      discardDisabled: picked()?.disabled,
      groupNotCollapsed: rows().some((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === 'w1.txt'),
    }

    // A staged-side row picked alone leaves that head reading partial.
    rows().find((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === 's1.txt')
      ?.querySelector('input.gp-check')?.click()
    await wait(60)
    result.partial = {
      indeterminate: pickOf('已暂存的更改')?.indeterminate === true,
      checked: pickOf('已暂存的更改')?.checked,
    }

    // Second press on the same head clears just that group; the other group's
    // pick survives. Only the staged-side s1.txt remains picked, and a
    // staged-only pick has nothing to discard — the entry stays disabled,
    // which is also the proof that the staged pick was not swept away.
    pickOf('更改')?.click()
    await wait(60)
    result.afterSecondPress = {
      checkedRows: checked(),
      discardDisabled: picked()?.disabled,
    }

    // Clear the leftover pick, then the full flow: pick the whole working-tree
    // group → entry enabled → dialog counts both files.
    rows().find((r) => (r.querySelector('.gp-tree-name')?.textContent ?? '') === 's1.txt')
      ?.querySelector('input.gp-check')?.click()
    await wait(60)
    result.afterClearLeftover = checked()
    pickOf('更改')?.click()
    await wait(60)
    picked()?.click()
    await wait(150)
    result.modalTexts = [...(document.querySelectorAll('.gp-modal--sm .gp-modal__confirmtext') ?? [])].map((n) => n.textContent)
    const actionsBefore = window.__gpFixture.actions.length
    ;[...document.querySelectorAll('.gp-modal--sm .gp-modal__footer .gp-btn--danger')][0]?.click()
    await wait(250)
    result.actions = window.__gpFixture.actions.slice(actionsBefore)
    return result
  })
  await page.close()
  return { out, errors }
}

/**
 * (j) Expand-all on a truncated list: the bar offers "展开全部", the request
 *     carries `fullChanges`, the mock serves the full snapshot, the group-head
 *     select-all checkbox reappears (it was hidden while truncated), and a
 *     whole-group pick then covers every loaded row.
 */
async function expandAllScenario() {
  // Truncated fixture: stats count 50 but only 2 rows arrive.
  const truncated = {
    ...SNAP,
    staged: 0, modified: 50, untracked: 0,
    changes: [
      { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
      { path: 'b.txt', status: 'modified', staged: false, isDirectory: false },
    ],
    stats: { fileCount: 50, staged: 0, modified: 50, untracked: 0, insertions: 5, deletions: 1, lastChangeAt: Date.now(), headCommittedAt: null },
    truncated: true, truncatedReason: 'cap',
  }
  // Full snapshot the mock swaps in once the client asks for it.
  const fullChanges = Array.from({ length: 50 }, (_, i) => ({ path: `f${String(i).padStart(2, '0')}.txt`, status: 'modified', staged: false, isDirectory: false }))
  const full = {
    ...truncated,
    changes: fullChanges,
    truncated: false, truncatedReason: undefined,
  }
  const { page, errors } = await openPanel(truncated)
  const out = await page.evaluate(async (fullSnap) => {
    const result = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    window.__gpFixture.fullSnapshot = fullSnap

    const bar = () => document.querySelector('.gp-changes__expandbar')
    const barBtn = () => bar()?.querySelector('button') ?? null
    result.barShown = bar() !== null
    result.barText = bar()?.querySelector('.gp-changes__expandbar__text')?.textContent ?? null
    result.barBtnLabel = barBtn()?.textContent ?? null
    // O1: while truncated the group-head select-all checkbox is hidden.
    result.headCheckboxWhileTruncated = [...document.querySelectorAll('.gp-group-head input.gp-check')].length
    result.rowsWhileTruncated = document.querySelectorAll('.gp-file-row').length

    barBtn()?.click()
    // Wait for the full snapshot to land (the group head reads the full count).
    for (let i = 0; i < 80 && !(document.querySelector('.gp-group-head')?.textContent ?? '').includes('(50)'); i++) await wait(50)
    await wait(100)
    result.fullChangesRequested = window.__gpFixture.lastSnapshotFullChanges === true
    // Virtualized list: only the viewport window mounts rows, so the evidence
    // is the group-head count (50) plus the vlist spacer height, not 50 DOM rows.
    result.headCountAfterExpand = document.querySelector('.gp-group-head')?.textContent ?? null
    result.mountedRowsAfterExpand = document.querySelectorAll('.gp-file-row').length
    result.vlistHeightAfterExpand = Math.round(document.querySelector('.gp-changes__vlist')?.getBoundingClientRect().height ?? 0)
    result.barTextAfter = bar()?.querySelector('.gp-changes__expandbar__text')?.textContent ?? null
    result.barBtnAfter = barBtn()?.textContent ?? null
    // O1 resolved: the checkbox is back now that the group is complete.
    result.headCheckboxAfterExpand = [...document.querySelectorAll('.gp-group-head input.gp-check')].length

    // Whole-group pick now covers every row (data-level: all mounted rows check).
    const head = [...document.querySelectorAll('.gp-group-head')]
      .find((n) => [...n.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim().startsWith('更改 (')))
    head?.querySelector('input.gp-check')?.click()
    await wait(80)
    const mounted = [...document.querySelectorAll('.gp-file-row')]
    result.checkedAfterGroupPick = mounted.filter((r) => r.querySelector('input.gp-check')?.checked === true).length
    result.mountedTotal = mounted.length

    // Collapse back to the capped view.
    barBtn()?.click()
    for (let i = 0; i < 80 && !(bar()?.querySelector('.gp-changes__expandbar__text')?.textContent ?? '').includes('仅显示前'); i++) await wait(50)
    await wait(100)
    result.collapsedFlag = window.__gpFixture.lastSnapshotFullChanges === false
    result.barTextAfterCollapse = bar()?.querySelector('.gp-changes__expandbar__text')?.textContent ?? null
    result.headCheckboxAfterCollapse = [...document.querySelectorAll('.gp-group-head input.gp-check')].length
    result.mountedRowsAfterCollapse = document.querySelectorAll('.gp-file-row').length
    return result
  }, full)
  await page.close()
  return { out, errors }
}

/**
 * (k) Toolbar "discard all": the confirm dialog counts from the full stats
 *     (honest while truncated), confirming sends one `{kind:'discard-all'}`
 *     with no paths, and a host refusal (`status-lossy`) keeps the dialog open
 *     with the localized copy.
 */
async function discardAllScenario() {
  const truncated = {
    ...SNAP,
    staged: 0, modified: 50, untracked: 3,
    changes: [
      { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
      { path: 'b.txt', status: 'modified', staged: false, isDirectory: false },
    ],
    stats: { fileCount: 53, staged: 0, modified: 50, untracked: 3, insertions: 5, deletions: 1, lastChangeAt: Date.now(), headCommittedAt: null },
    truncated: true, truncatedReason: 'cap',
  }
  const { page, errors } = await openPanel(truncated)
  const out = await page.evaluate(async () => {
    const result = {}
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const allBtn = () => document.querySelector('.gp-changes__discard-all')
    const confirmBtn = () => [...document.querySelectorAll('.gp-modal--sm .gp-modal__footer .gp-btn')]
      .find((b) => b.classList.contains('gp-btn--danger')) ?? null

    result.enabled = allBtn()?.disabled === false
    allBtn()?.click()
    await wait(150)
    result.modalTitle = document.querySelector('.gp-modal__path')?.textContent ?? null
    result.modalTexts = [...document.querySelectorAll('.gp-modal--sm .gp-modal__confirmtext')].map((n) => n.textContent)
    const before = window.__gpFixture.actions.length
    confirmBtn()?.click()
    await wait(250)
    result.actions = window.__gpFixture.actions.slice(before)
    result.modalClosed = document.querySelector('.gp-modal--sm') === null

    // A lossy-status refusal keeps the dialog open with the localized copy.
    window.__gpFixture.runFailure = { kind: 'discard-all', code: 'status-lossy', message: 'status clipped' }
    allBtn()?.click()
    await wait(150)
    const before2 = window.__gpFixture.actions.length
    confirmBtn()?.click()
    await wait(250)
    result.refusalActions = window.__gpFixture.actions.slice(before2)
    result.refusalModalOpen = document.querySelector('.gp-modal--sm') !== null
    result.refusalFeedback = document.querySelector('.gp-modal--sm .gp-feedback')?.textContent ?? null
    return result
  })
  await page.close()
  return { out, errors }
}

/** The measured hover→tooltip delay, only meaningful when both entries exist. */
function tipDelay(log) {
  const hover = [...log].reverse().find((e) => e.kind === 'hover')
  const shown = [...log].reverse().find((e) => e.kind === 'tip')
  return hover === undefined || shown === undefined ? -1 : Math.round(shown.at - hover.at)
}

try {
  const batch = await batchScenario()
  assert.equal(batch.errors.length, 0, 'no console errors: ' + JSON.stringify(batch.errors))
  // Fixture sanity: the list regroups the fixture's deliberately interleaved
  // rows into staged (del.txt / dup.txt / rn.txt / s1.txt), then the
  // working-tree ones, then the untracked directory; no group is collapsed.
  assert.deepEqual(batch.out.rows, ['del.txt:\u2212', 'dup.txt:\u2212', 'rn.txt:\u2212', 's1.txt:\u2212', 'dup.txt:+', 'w1.txt:+', 'newdir:+'], 'one row per changed side, staged group first')
  assert.equal(batch.out.renamedBadge, 'R', 'the index-side rename carries the R status glyph')
  // The index side has no working-tree changes to discard: offering the button
  // there used to no-op (`M `/`A `/`R `) or fail outright (`D `, del.txt here).
  assert.deepEqual(batch.out.rowActions, [
    { row: 'del.txt:\u2212', labels: ['取消暂存'] },
    { row: 'dup.txt:\u2212', labels: ['取消暂存'] },
    { row: 'rn.txt:\u2212', labels: ['取消暂存'] },
    { row: 's1.txt:\u2212', labels: ['取消暂存'] },
    { row: 'dup.txt:+', labels: ['暂存', '放弃更改'] },
    { row: 'w1.txt:+', labels: ['暂存', '放弃更改'] },
    { row: 'newdir:+', labels: ['暂存', '放弃更改'] },
  ], 'index-side rows (including the `R ` rename) offer unstage only; working-tree and untracked rows keep both actions')
  assert.equal(batch.out.entryAfterUnstageAll, true, 'the discard entry follows "unstage all": ' + JSON.stringify(batch.out.toolbar))
  assert.equal(batch.out.entryBeforeStash, true, 'the discard entry precedes "stash changes": ' + JSON.stringify(batch.out.toolbar))
  assert.equal(batch.out.entryLabel, '放弃选中的更改', 'toolbar label is the zh entry copy')
  assert.equal(batch.out.disabledEmpty, true, 'nothing picked → the entry is disabled')
  assert.equal(batch.out.disabledStagedOnly, true, 'a staged-only pick has nothing to discard → still disabled')
  assert.equal(batch.out.enabledAfterPicks, true, 'two working-tree picks enable the entry')
  assert.equal(batch.out.modalShown, true, 'clicking the entry opens the confirm dialog')
  assert.equal(batch.out.modalPortaled, true, 'the dialog is portaled outside the panel')
  assert.equal(batch.out.modalTitle, '放弃选中的更改', 'dialog title')
  // Only the deduped count, never the file names: dup.txt is one file even
  // though both of its rows are picked, and its `:s` row is not staged-only.
  assert.deepEqual(batch.out.modalTexts, ['将放弃 2 个文件在工作区的未提交更改，此操作不可恢复。'], 'body carries the deduped count and no file list')
  assert.equal(batch.out.confirmLabel, '放弃更改', 'confirm button label')
  assert.equal(batch.out.confirmDanger, true, 'confirm button carries the danger style')
  assert.deepEqual(batch.out.actions, [{ kind: 'discard', paths: ['dup.txt', 'w1.txt'] }], 'one discard action with the deduped working-tree paths, sorted')
  assert.equal(batch.out.modalClosed, true, 'a landed discard closes the dialog')

  const stagedOnly = await stagedOnlyScenario()
  assert.equal(stagedOnly.errors.length, 0, 'no console errors: ' + JSON.stringify(stagedOnly.errors))
  assert.equal(stagedOnly.out.disabledStagedOnly, true, 'staged-only alone keeps the entry disabled')
  assert.equal(stagedOnly.out.enabledMixed, true, 'a working-tree pick enables it again')
  assert.deepEqual(stagedOnly.out.modalTexts, [
    '将放弃 1 个文件在工作区的未提交更改，此操作不可恢复。',
    '另有 1 个选中项在暂存区，不在此次放弃范围（如需撤销暂存请用「取消暂存」）。',
  ], 'an index-side pick is reported as out of scope, not silently swallowed')
  assert.deepEqual(stagedOnly.out.actions, [{ kind: 'discard', paths: ['w1.txt'] }], 'the staged-only path never reaches the request')

  // Untracked targets are deleted from disk, not restored from the index — the
  // host does that recursively now, so a directory must reach the request too.
  const untrackedDir = await untrackedDirScenario()
  assert.equal(untrackedDir.errors.length, 0, 'no console errors: ' + JSON.stringify(untrackedDir.errors))
  assert.equal(untrackedDir.out.enabled, true, 'an untracked directory pick enables the entry')
  assert.deepEqual(untrackedDir.out.modalTexts, [
    '将放弃 1 个文件在工作区的未提交更改，此操作不可恢复。',
    '其中 1 个是未跟踪的文件或目录，将从磁盘删除（不在 Git 历史中，无法恢复）。',
  ], 'untracked targets are called out as disk deletions')
  assert.deepEqual(untrackedDir.out.actions, [{ kind: 'discard', paths: ['newdir'] }], 'the untracked directory reaches the discard request')

  // A refused discard must not read as success: the action lands, the dialog
  // stays open, and the host's code is mapped to the localized zh copy. Both
  // refusal codes are pinned — the partial one exists precisely because the
  // generic copy would claim nothing was deleted after an earlier path was.
  const refused = await nestedRepoErrorScenario('nested-repo')
  assert.equal(refused.errors.length, 0, 'no console errors: ' + JSON.stringify(refused.errors))
  assert.equal(refused.out.rowFound, true, 'the untracked directory row is present')
  assert.equal(refused.out.enabled, true, 'picking it enables the toolbar entry')
  assert.equal(refused.out.modalShown, true, 'the confirm dialog opens')
  assert.deepEqual(refused.out.actions, [{ kind: 'discard', paths: ['newdir'] }], 'the refused discard still sends its request')
  assert.equal(refused.out.modalOpen, true, 'the confirm dialog stays open after a refusal')
  assert.equal(refused.out.feedback, '该条目本身是一个 Git 仓库（嵌套仓库或子模块），放弃会连带删除整个内部仓库；此操作请在终端中完成', 'the nested-repo refusal shows the localized copy in the dialog')

  const partial = await nestedRepoErrorScenario('nested-repo-partial')
  assert.equal(partial.errors.length, 0, 'no console errors: ' + JSON.stringify(partial.errors))
  assert.equal(partial.out.feedback, '该条目本身是一个 Git 仓库（嵌套仓库或子模块），拒绝连带删除；但同批中位于它之前的条目已经被删除了，请刷新后确认剩余变更，此操作请在终端中完成', 'the mid-batch refusal says earlier paths were already deleted')

  // A non-repo refusal (`index-busy`, the index lock) follows the same rule:
  // the dialog survives, the confirm key is only disabled while the call is in
  // flight, and the retry re-sends the same single request.
  const busy = await discardFailureScenario()
  assert.equal(busy.errors.length, 0, 'no console errors: ' + JSON.stringify(busy.errors))
  assert.equal(busy.out.enabled, true, 'picking a working-tree row enables the toolbar entry')
  assert.equal(busy.out.modalShown, true, 'the confirm dialog opens')
  assert.equal(busy.out.inflightParked, true, 'the discard call is parked in flight for the busy assertions')
  assert.deepEqual(busy.out.inflightActions, [{ kind: 'discard', paths: ['w1.txt'] }], 'confirming sends exactly one discard request')
  assert.equal(busy.out.inflightConfirmDisabled, true, 'the confirm key is disabled while the discard is in flight')
  assert.equal(busy.out.inflightOverlay, '正在放弃…', 'the in-flight overlay carries the localized busy label')
  assert.equal(busy.out.inflightRowChecksDisabled, true, 'N1: row checkboxes freeze while a write is in flight')
  assert.equal(busy.out.inflightGroupChecksDisabled, true, 'N1: group-head select-all freezes with the same busy gate')
  assert.equal(busy.out.inflightPressCount, 1, 'a press while in flight queues no second request')
  assert.deepEqual(busy.out.failureActions, [{ kind: 'discard', paths: ['w1.txt'] }], 'the refusal consumed exactly the one request')
  assert.equal(busy.out.modalOpenAfterFail, true, 'the confirm dialog stays open after an index-busy refusal')
  assert.equal(busy.out.feedback, 'Git 正忙（另一进程占用索引），请稍后重试', 'the index-busy refusal shows the localized copy in the dialog')
  assert.equal(busy.out.confirmEnabledAfterFail, true, 'the confirm key is usable again once the refusal landed')
  assert.equal(busy.out.overlayGone, true, 'the busy overlay is gone once the refusal landed')
  assert.deepEqual(busy.out.retryActions, [{ kind: 'discard', paths: ['w1.txt'] }], 'the retry sends one discard with the same paths')
  assert.equal(busy.out.modalClosedAfterRetry, true, 'the landed retry closes the dialog')

  // The poll-driven prune: a row vanishing from the snapshot empties the
  // selection, which must close the dialog and clear the entry — and must not
  // let a later pick pop the stale dialog back open.
  const trim = await snapshotTrimScenario()
  assert.equal(trim.errors.length, 0, 'no console errors: ' + JSON.stringify(trim.errors))
  assert.equal(trim.out.enabledBefore, true, 'the picked working-tree row enables the entry')
  assert.equal(trim.out.modalBefore, true, 'the dialog is open before the poll')
  assert.equal(trim.out.rowGone, true, 'the polled snapshot dropped the checked row')
  assert.equal(trim.out.modalClosed, true, 'pruning the selection to empty closes the dialog on its own')
  assert.equal(trim.out.entryDisabled, true, 'the entry returns to disabled once nothing is selected')
  assert.equal(trim.out.enabledAfterRepick, true, 'a fresh working-tree pick enables the entry again')
  assert.equal(trim.out.modalStayedClosed, true, 're-picking does not resurrect the stale dialog')

  // Group select-all: one press on a head checkbox picks the whole group.
  const group = await groupSelectScenario()
  assert.equal(group.errors.length, 0, 'no console errors: ' + JSON.stringify(group.errors))
  assert.equal(group.out.headCount, 3, 'every visible group head carries a select-all checkbox')
  assert.deepEqual(group.out.initial, {
    staged: false, unstaged: false, untracked: false,
    discardDisabled: true, rowsExpanded: 7,
  }, 'all heads start unchecked and the entry disabled; the fixture renders 7 rows')
  assert.deepEqual(group.out.afterUnstagedPick, {
    checkedRows: 2, stagedHead: false, discardDisabled: false, groupNotCollapsed: true,
  }, 'one press picks both working-tree rows, enables the entry, and leaves the group expanded')
  assert.deepEqual(group.out.partial, { indeterminate: true, checked: false }, 'a half-picked group head reads partial')
  assert.deepEqual(group.out.afterSecondPress, { checkedRows: 1, discardDisabled: true }, 'the second press clears just that group; the staged-side pick survives and keeps the entry disabled')
  assert.equal(group.out.afterClearLeftover, 0, 'clearing the leftover staged pick empties the selection again')
  assert.deepEqual(group.out.modalTexts, ['将放弃 2 个文件在工作区的未提交更改，此操作不可恢复。'], 'a whole-group pick drives the existing discard dialog with the full count')
  assert.deepEqual(group.out.actions, [{ kind: 'discard', paths: ['dup.txt', 'w1.txt'] }], 'one discard with every working-tree path of the picked group')

  const tips = await tipsScenario()
  assert.equal(tips.errors.length, 0, 'no console errors: ' + JSON.stringify(tips.errors))
  assert.equal(tips.out.stageGlyph, '+', 'the working-tree row shows the stage glyph')
  assert.equal(tips.out.stageTip?.text, '暂存此文件，下一次提交会包含它的改动', 'stage hover hint copy')
  assert.equal(tips.out.stageTip?.onBody, true, 'the hint is portaled to body')
  assert.ok(tipDelay(tips.out.stageLog) >= 100 && tipDelay(tips.out.stageLog) <= 400, `the hint waits for the ~140ms hover delay (measured ${tipDelay(tips.out.stageLog)}ms)`)
  assert.equal(tips.out.stageAria, '暂存', 'the aria-label keeps the short name')
  assert.equal(tips.out.stageTitle, null, 'no native title is left behind')
  assert.equal(tips.out.stageTipGone, true, 'leaving the button dismisses the hint')
  assert.equal(tips.out.discardIcon, 1, 'the discard button shows the trash icon (not a refresh-like glyph)')
  assert.equal(tips.out.discardTip?.text, '放弃此文件在工作区的改动（不可恢复）；再点一次确认', 'discard hover hint copy')
  assert.equal(tips.out.discardAria, '放弃更改', 'the discard aria-label keeps the short name')
  assert.equal(tips.out.discardTitle, null, 'no native title is left behind')
  assert.equal(tips.out.armedAria, '再次点击以确认放弃', 'the armed button announces the confirm step')
  assert.equal(tips.out.armedIcon, 1, 'arming keeps the trash icon (only the wording/color changes)')
  assert.equal(tips.out.armedTipOnClick?.text, '再点一次即放弃此文件的改动，不可恢复', 'arming raises the confirm wording on the spot')
  assert.equal(tips.out.noTipBeforePress, true, 'no hint is up before the arming press (nothing hovered)')
  assert.equal(tips.out.armedTipOnPress?.text, '再点一次即放弃此文件的改动，不可恢复', 'the press alone raises the confirm hint (no hover needed)')
  assert.equal(tips.out.armedTipOnPress?.onBody, true, 'the press-raised hint is portaled to body')
  assert.equal(tips.out.wideTipGeometry?.centered, false, 'the wide layout keeps the left-anchored bubble')
  assert.equal(tips.out.wideTipGeometry?.leftDelta, 0, 'the wide bubble starts at the control left edge')
  assert.equal(tips.out.compactLayout, 'compact', 'a 360px panel is the compact layout')
  assert.equal(tips.out.compactTipText, '再点一次即放弃此文件的改动，不可恢复', 'compact raises the same confirm wording')
  assert.equal(tips.out.compactTipGeometry?.centered, true, 'the compact bubble centres itself on the control')
  assert.ok(Math.abs(tips.out.compactTipGeometry?.centerDelta ?? 99) <= 1, `the compact bubble is horizontally centred (off by ${tips.out.compactTipGeometry?.centerDelta}px)`)
  assert.equal(tips.out.compactTipGeometry?.insideViewport, true, 'the centred bubble stays inside the viewport')
  assert.equal(tips.out.armedTipAriaOnPress, '再次点击以确认放弃', 'the pressed button announces the confirm step')
  assert.equal(tips.out.armedTipOnPressRunsNothing, true, 'the arming press still runs nothing')
  assert.equal(tips.out.armedTipDismissedOutside, true, 'a press outside the hint dismisses it')
  assert.equal(tips.out.outsidePressRunsNothing, true, 'the dismissing press runs nothing')
  assert.equal(tips.out.secondPressRan, true, 'the second press on the button runs the discard')
  assert.equal(tips.out.secondPressClearedTip, true, 'executing drops the hint')
  assert.equal(tips.out.secondPressDisarmed, true, 'executing clears the armed state')
  assert.equal(tips.out.firstClickRunsNothing, true, 'the first click only arms; nothing runs')
  assert.equal(tips.out.armedTip?.text, '再点一次即放弃此文件的改动，不可恢复', 'armed hover hint copy')
  assert.ok(tipDelay(tips.out.armedLog) >= 100 && tipDelay(tips.out.armedLog) <= 400, `the armed hint keeps the fast delay (measured ${tipDelay(tips.out.armedLog)}ms)`)
  assert.equal(tips.out.unstageGlyph, UNSTAGE_GLYPH, 'the staged row shows the unstage glyph')
  assert.equal(tips.out.unstageTip?.text, '取消暂存此文件，改动仍留在工作区', 'unstage hover hint copy')
  assert.equal(tips.out.unstageAria, '取消暂存', 'the unstage aria-label keeps the short name')

  // Phone viewports, not just a narrow panel: the bubble keeps its natural
  // width instead of shrinking to the strip left of the control, and stays
  // inside both edges. 320px also exercises the width cap / fold-back.
  for (const width of [390, 320]) {
    const geo = tips.out[`phoneTip${width}`]
    assert.equal(tips.out[`phoneLayout${width}`], 'compact', `a ${width}px viewport is the compact layout`)
    assert.ok(geo !== null, `the ${width}px hint is on screen`)
    assert.ok((geo?.width ?? 0) >= 200, `the ${width}px hint keeps a readable width (got ${geo?.width}px)`)
    assert.equal(geo?.insideViewport, true, `the ${width}px hint stays inside the horizontal edges`)
    assert.equal(geo?.insideVertically, true, `the ${width}px hint stays inside the vertical edges`)
  }
  // The armed confirmation's two guards: the double-click second press never
  // executes, the arm expires on its deadline (taking its pinned hint with it),
  // and a press after the deadline re-arms rather than running.
  assert.equal(tips.out.armTipBeforeExpiry, '再点一次即放弃此文件的改动，不可恢复', 'arming pins the confirm hint on the spot')
  assert.equal(tips.out.dblPressIgnored, true, 'the double-click second press (detail > 1) never executes the discard')
  assert.equal(tips.out.stillArmedAfterDbl, true, 'and it does not consume the armed confirmation either')
  assert.equal(tips.out.armExpired, true, 'the armed confirmation expires after its deadline')
  assert.equal(tips.out.armTipGoneOnExpiry, true, 'the pinned confirm hint goes with the expired arm')
  assert.equal(tips.out.expiredPressRearmsOnly, true, 'a press after the deadline re-arms instead of executing')
  assert.equal(tips.out.expiredPressRearmed, true, 'the button announces the confirm step again')
  // Touch media: the compact 30px height must outrank the global
  // `@media (hover:none)` rule that lifts `.gp-btn` to 36px.
  const touch = await touchScenario()
  assert.equal(touch.errors.length, 0, 'no console errors: ' + JSON.stringify(touch.errors))
  assert.equal(touch.out.hoverNone, true, 'the touch page really reports (hover: none)')
  assert.equal(touch.out.pointerCoarse, true, 'the touch page reports a coarse primary pointer (the phone predicate keys on it)')
  assert.equal(touch.out.layout, 'compact', 'the touch page mounts compact')
  assert.equal(touch.out.barCommit, 30, 'compact 30px outranks the touch 36px rule (commit)')
  assert.equal(touch.out.barOpen, 30, 'compact 30px outranks the touch 36px rule (bar)')
  // The diff toolbar and the dialog bar size their icon controls with a
  // two-class selector, which outranks the plain touch rule on specificity
  // alone; the touch sizes are restated at that specificity so a phone does not
  // get pointer-density controls.
  assert.deepEqual(touch.out.diffBarPlain, { w: 34, h: 34 }, `the plain icon keeps its touch size (${JSON.stringify(touch.out.diffBarPlain)})`)
  assert.deepEqual(touch.out.diffBarIcon, { w: 34, h: 34 }, `the diff toolbar icon keeps a touch target (${JSON.stringify(touch.out.diffBarIcon)})`)
  assert.deepEqual(touch.out.modalBarIcon, { w: 34, h: 34 }, `the dialog bar icon keeps a touch target (${JSON.stringify(touch.out.modalBarIcon)})`)
  assert.equal(touch.out.modalBarFs?.h, 36, `the reader fullscreen toggle keeps the touch height (${touch.out.modalBarFs?.h}px)`)

  // Expand-all: the truncated bar offers the lift, the request carries the
  // flag, the full list arrives, and the group checkbox returns.
  const expand = await expandAllScenario()
  assert.equal(expand.errors.length, 0, 'no console errors: ' + JSON.stringify(expand.errors))
  assert.equal(expand.out.barShown, true, 'a truncated list shows the expand bar')
  assert.match(expand.out.barText ?? '', /仅显示前 2 项/, 'the bar states the loaded prefix')
  assert.equal(expand.out.barBtnLabel, '展开全部', 'the bar offers expand-all')
  assert.equal(expand.out.headCheckboxWhileTruncated, 0, 'O1: no group select-all while truncated')
  assert.equal(expand.out.rowsWhileTruncated, 2, 'the capped list carries the prefix')
  assert.equal(expand.out.fullChangesRequested, true, 'the expand request carries fullChanges')
  // Virtualized list: evidence of the full load is the head count + spacer.
  assert.match(expand.out.headCountAfterExpand ?? '', /更改 \(50\)/, 'the group head counts all 50 after expand')
  assert.ok((expand.out.vlistHeightAfterExpand ?? 0) >= 50 * 28, `the vlist spacer covers 50 rows (got ${expand.out.vlistHeightAfterExpand}px)`)
  assert.ok(expand.out.mountedRowsAfterExpand >= 1 && expand.out.mountedRowsAfterExpand < 50, 'only the viewport window mounts rows')
  assert.match(expand.out.barTextAfter ?? '', /已展开全部 50 个变更/, 'the bar reports the expanded count')
  assert.equal(expand.out.barBtnAfter, '收起', 'the expanded bar offers collapse')
  assert.equal(expand.out.headCheckboxAfterExpand, 1, 'the group select-all checkbox returns once complete')
  assert.equal(expand.out.checkedAfterGroupPick, expand.out.mountedTotal, 'a whole-group pick checks every mounted row')
  assert.ok((expand.out.mountedTotal ?? 0) >= 1, 'the group pick had rows to check')
  assert.equal(expand.out.collapsedFlag, true, 'collapse drops the fullChanges flag')
  assert.match(expand.out.barTextAfterCollapse ?? '', /仅显示前 2 项/, 'collapse returns to the truncated bar wording')
  assert.equal(expand.out.headCheckboxAfterCollapse, 0, 'the group checkbox hides again while truncated')
  assert.ok((expand.out.mountedRowsAfterCollapse ?? 0) <= (expand.out.mountedRowsAfterExpand ?? 0), 'collapse never grows the mounted window')

  // Discard-all: counts from the full stats, one pathless action, refusal kept.
  const discardAll = await discardAllScenario()
  assert.equal(discardAll.errors.length, 0, 'no console errors: ' + JSON.stringify(discardAll.errors))
  assert.equal(discardAll.out.enabled, true, 'discard-all is enabled with working-tree changes')
  assert.equal(discardAll.out.modalTitle, '放弃全部工作区更改', 'dialog title')
  assert.deepEqual(discardAll.out.modalTexts, [
    '将放弃全部 53 个工作区文件的未提交更改，回到最后一次提交的状态，此操作不可恢复。',
    '其中 3 个是未跟踪的文件或目录，将从磁盘删除（不在 Git 历史中，无法恢复）。',
  ], 'the body counts from the full stats even while truncated')
  assert.deepEqual(discardAll.out.actions, [{ kind: 'discard-all' }], 'confirming sends one pathless discard-all')
  assert.equal(discardAll.out.modalClosed, true, 'a landed discard-all closes the dialog')
  assert.deepEqual(discardAll.out.refusalActions, [{ kind: 'discard-all' }], 'the refused attempt still sent its request')
  assert.equal(discardAll.out.refusalModalOpen, true, 'a status-lossy refusal keeps the dialog open')
  assert.equal(discardAll.out.refusalFeedback, 'Git 输出超出上限，无法确认完整变更集；「放弃全部」已取消，请刷新后重试或改用逐项放弃', 'the refusal shows the localized copy')

  console.log('e2e changes-discard.mjs: PASS', JSON.stringify({
    discard: batch.out.actions, stagedOnly: stagedOnly.out.actions,
    groupSelect: { pick: group.out.afterUnstagedPick, actions: group.out.actions },
    expandAll: { rows: expand.out.rowsAfterExpand, checked: expand.out.checkedAfterGroupPick },
    discardAll: { actions: discardAll.out.actions, refusal: discardAll.out.refusalFeedback },
    stageDelay: tipDelay(tips.out.stageLog), armedDelay: tipDelay(tips.out.armedLog),
    tips: [tips.out.stageTip?.text, tips.out.discardTip?.text, tips.out.armedTip?.text, tips.out.unstageTip?.text],
    refusals: [refused.out.feedback, partial.out.feedback],
    busyFailure: { feedback: busy.out.feedback, retry: busy.out.retryActions },
    trim: { modalClosed: trim.out.modalClosed, stayedClosed: trim.out.modalStayedClosed },
  }))
} catch (e) {
  console.error('e2e changes-discard.mjs: FAIL', e.message)
  process.exit(1)
} finally {
  await browser.close()
}
