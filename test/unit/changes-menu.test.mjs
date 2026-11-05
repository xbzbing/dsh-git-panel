/**
 * The changes list's menu entries.
 *
 * The cases that matter are the side ones: a path can be listed twice (edited
 * after being partly staged), and each direction must act on its own side only —
 * handing the other side's path to `git add` stages the whole file and wipes the
 * hunks `git add -p` left in the index.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changeMenuActions, changeDirMenuActions, stashMenuActions, pickStageTargets, pickUnstageTargets } from '../../lib/testkit.mjs'

const t = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`)
const FACTS = { isGit: true, revDiff: true, pathHistory: true }
const CALLBACKS = { compareRevision: () => {}, compareRef: () => {}, showHistory: () => {}, quote: () => {} }
const env = { t, menus: { notify: () => {} }, writeClipboard: async () => true, facts: FACTS, callbacks: CALLBACKS }

/** A commands recorder: every entry pushes its arguments instead of running. */
function recorder() {
  const calls = []
  const record = (name) => (...args) => calls.push([name, ...args])
  return {
    calls,
    commands: {
      openDiff: record('openDiff'),
      stage: record('stage'),
      openDiscard: record('openDiscard'),
      stashApply: record('stashApply'),
      stashPop: record('stashPop'),
      openStashDrop: record('openStashDrop'),
    },
  }
}

const row = (path, staged = false) => ({ sessionId: 's', owner: 'o', repo: '', path, staged })
const byId = (actions) => new Map(actions.map((a) => [a.id, a]))

test('a lone row acts on itself', async () => {
  const rec = recorder()
  const actions = changeMenuActions(row('src/a.ts'), env, rec.commands, { busy: false }, new Set())
  assert.deepEqual(actions.map((a) => a.id), ['open-diff', 'stage', 'discard'])
  await byId(actions).get('stage').run()
  assert.deepEqual(rec.calls, [['stage', ['src/a.ts'], false]])
})

test('a row outside the pick still acts on itself', async () => {
  const rec = recorder()
  const pick = new Set(['src/b.ts:w', 'src/c.ts:w'])
  const actions = changeMenuActions(row('src/a.ts'), env, rec.commands, { busy: false }, pick)
  assert.equal(actions[1].label, 'menu.stagePicked:{"n":1}', 'the label counts the row, not the pick')
  await byId(actions).get('stage').run()
  assert.deepEqual(rec.calls, [['stage', ['src/a.ts'], false]])
})

test('a working-tree pick stages only the working-tree side', async () => {
  const rec = recorder()
  // `src/a.ts` is listed on both sides (partly staged, then edited again) and
  // `src/b.ts` only on the index side. Staging the whole pick would hand
  // `src/b.ts` — already fully staged — to `git add`, which is harmless there
  // and destructive for a partly staged `src/a.ts`; the point is the index side
  // never enters the argv.
  const pick = new Set(['src/a.ts:w', 'src/a.ts:s', 'src/b.ts:s'])
  const actions = changeMenuActions(row('src/a.ts'), env, rec.commands, { busy: false }, pick)
  assert.equal(actions[1].label, 'menu.stagePicked:{"n":1}', 'the count is the working-tree side')
  await byId(actions).get('stage').run()
  assert.deepEqual(rec.calls, [['stage', ['src/a.ts'], false]], 'the index-side pick never widens git add')
})

test('an index-side pick unstages only the index side', async () => {
  const rec = recorder()
  const pick = new Set(['src/a.ts:s', 'src/a.ts:w', 'src/c.ts:w'])
  const actions = changeMenuActions(row('src/a.ts', true), env, rec.commands, { busy: false }, pick)
  assert.equal(actions[1].label, 'menu.unstagePicked:{"n":1}')
  assert.ok(!actions.some((a) => a.id === 'discard'), 'an index-side row has nothing to discard')
  await byId(actions).get('stage').run()
  assert.deepEqual(rec.calls, [['stage', ['src/a.ts'], true]], 'a working-tree pick never widens git reset')
})

test('discard counts only the working-tree side but opens on the captured set', async () => {
  const rec = recorder()
  const pick = new Set(['src/a.ts:w', 'src/a.ts:s', 'src/b.ts:s'])
  const actions = changeMenuActions(row('src/a.ts'), env, rec.commands, { busy: false }, pick)
  const discard = byId(actions).get('discard')
  assert.equal(discard.label, 'menu.discardPicked:{"n":1}', 'index-only picks are not promised')
  assert.equal(discard.danger, true)
  await discard.run()
  assert.deepEqual(rec.calls, [['openDiscard', ['src/a.ts']]], 'the confirm receives the working-tree paths')
})

test('a mixed pick whose working-tree side is empty hides discard', async () => {
  const pick = new Set(['src/a.ts:s', 'src/b.ts:s'])
  const actions = changeMenuActions(row('src/a.ts', true), env, recorder().commands, { busy: false }, pick)
  assert.ok(!actions.some((a) => a.id === 'discard'))
})

test('busy disables the write entries but keeps the diff', () => {
  const actions = changeMenuActions(row('src/a.ts'), env, recorder().commands, { busy: true }, new Set())
  assert.equal(byId(actions).get('open-diff').disabled, undefined)
  assert.equal(byId(actions).get('stage').disabled, true)
  assert.equal(byId(actions).get('discard').disabled, true)
})

test('a directory row acts on the paths the row carries', async () => {
  const rec = recorder()
  const value = {
    sessionId: 's', owner: 'o', repo: '', path: 'src/ui', staged: false,
    paths: ['src/ui/a.ts', 'src/ui/b.ts'], discardable: ['src/ui/a.ts'],
  }
  const actions = changeDirMenuActions(value, env, rec.commands, { busy: false })
  assert.deepEqual(actions.map((a) => a.id), ['stage-dir', 'discard-dir'])
  await byId(actions).get('stage-dir').run()
  await byId(actions).get('discard-dir').run()
  assert.deepEqual(rec.calls, [
    ['stage', ['src/ui/a.ts', 'src/ui/b.ts'], false],
    ['openDiscard', ['src/ui/a.ts']],
  ])
})

test('a stash row opens the existing drop confirm', async () => {
  const rec = recorder()
  const value = { sessionId: 's', owner: 'o', repo: '', sha: 'abc123', label: 'WIP on main' }
  const actions = stashMenuActions(value, env, rec.commands, { busy: false })
  assert.deepEqual(actions.map((a) => a.id), ['stash-apply', 'stash-pop', 'stash-drop', 'copy-message'])
  await byId(actions).get('stash-drop').run()
  assert.deepEqual(rec.calls, [['openStashDrop', 'abc123', 'WIP on main']], 'no drop from the menu itself')
})

test('the stage direction helpers ignore keys with no known side', () => {
  const keys = ['a:w', 'b:s', 'c', 'a:s']
  assert.deepEqual(pickStageTargets(keys), ['a'])
  assert.deepEqual(pickUnstageTargets(keys), ['a', 'b'])
})
