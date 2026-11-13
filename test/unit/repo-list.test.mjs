/**
 * Repository list model: which rows exist, what each row says, and how
 * they group.
 *
 * The load-bearing properties: an empty scan yields no tab at all (an older
 * host must keep the three-pane panel), a cwd that owns no checkout still gets
 * no synthetic "workspace root" row — only what the scan found — labels never
 * repeat a basename that already is the path, and the two checkout families
 * (the workspace's own worktrees vs unrelated repositories) split into groups
 * only when both are present — a lone group must not render a header that
 * restates the block title. The browse-root dropdown (filesRootRows) is the
 * one deliberate exception: it synthesises the project root as its first row,
 * because the browser can be rooted there even when the cwd owns no checkout.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repoChoices, repoLabel, repoDetail, repoGroups, repoDisabledKey, repoRowTip, filesRootRows, gitRepoForFilesRoot } from '../../lib/testkit.mjs'

/** A scan entry; only the fields the list reads. */
function entry(path, name, kind) {
  return { path, name, kind, root: `/w/${path}` }
}

test('an empty scan yields no rows, so the panel keeps its three tabs', () => {
  assert.deepEqual(repoChoices([]), [])
})

test('a checkout that owns the cwd is listed as-is', () => {
  const rows = repoChoices([entry('', 'workspace', 'workspace'), entry('site', 'site', 'nested')])
  assert.deepEqual(rows.map((r) => r.path), ['', 'site'])
  assert.deepEqual(rows.map((r) => r.kind), ['workspace', 'repo'])
})

test('a cwd with no checkout of its own lists only the scanned repositories', () => {
  const rows = repoChoices([entry('alpha', 'alpha', 'nested')])
  assert.deepEqual(rows.map((r) => r.path), ['alpha'], 'no synthetic root row')
  assert.deepEqual(rows.map((r) => r.kind), ['repo'])
})

test('a linked worktree row keeps its wire fields and becomes the worktree kind', () => {
  const rows = repoChoices([
    { path: '', name: 'repo', kind: 'workspace', root: '/r', role: 'main', branch: 'main' },
    { path: '.agents/worktrees/feat/x', name: 'x', kind: 'nested', root: '/x', role: 'linked', branch: 'feat/x', locked: true },
    { path: 'site', name: 'site', kind: 'nested', root: '/s', role: 'repo' },
  ])
  assert.deepEqual(rows.map((r) => r.kind), ['workspace', 'worktree', 'repo'])
  assert.equal(rows[0].role, 'main')
  assert.equal(rows[1].branch, 'feat/x')
  assert.equal(rows[1].locked, true)
  // An older host sends none of the new fields: the row still lands in the
  // repository group instead of crashing or inventing a branch.
  const legacy = repoChoices([entry('', 'workspace', 'workspace'), entry('site', 'site', 'nested')])
  assert.equal(legacy[1].kind, 'repo')
  assert.equal(legacy[1].branch, undefined)
  assert.equal(legacy[1].disabled, undefined)
})

test('a workspace-file root is external, groups with foreign repositories, and keeps its label', () => {
  const rows = repoChoices([
    { path: '', name: 'hub', kind: 'workspace', root: '/hub' },
    { path: 'inner', name: 'inner', kind: 'nested', root: '/hub/inner', role: 'repo' },
    { path: '../service-a', name: 'service-a', kind: 'external', root: '/service-a', role: 'repo', label: 'API' },
    { path: '../service-b', name: 'service-b', kind: 'external', root: '/service-b', role: 'repo' },
  ])
  assert.deepEqual(rows.map((r) => r.kind), ['workspace', 'repo', 'external', 'external'])
  assert.equal(repoLabel(rows[2]), 'API', 'folders[].name wins over the basename/path pair')
  assert.equal(repoLabel(rows[3]), 'service-b (../service-b)', 'without a label the path disambiguates')
  const groups = repoGroups(rows)
  assert.deepEqual(groups.map((g) => g.key), ['own', 'foreign'])
  assert.deepEqual(groups[1].items.map((r) => r.path), ['inner', '../service-a', '../service-b'])
})

test('labels drop the path when it is the basename and keep it otherwise', () => {
  assert.equal(repoLabel(entry('site', 'site', 'nested')), 'site')
  assert.equal(repoLabel(entry('apps/web', 'web', 'nested')), 'web (apps/web)')
  assert.equal(repoLabel(entry('', 'workspace', 'workspace')), 'workspace')
})

test('the detail line is the relative path, on every row but the workspace itself', () => {
  assert.equal(repoDetail(entry('apps/web', 'web', 'nested')), 'apps/web')
  assert.equal(repoDetail(entry('alpha', 'alpha', 'nested')), 'alpha', 'a first-level directory states its path beside its name')
  assert.equal(repoDetail(entry('', 'workspace', 'workspace')), '')
})

test('a worktree label is the name alone and its detail drops the repeated directory', () => {
  const wt = { path: '.agents/worktrees/review/pr-85', name: 'pr-85', kind: 'worktree', root: '/r' }
  assert.equal(repoLabel(wt), 'pr-85', 'the path lives on the detail line only')
  assert.equal(repoDetail(wt), '.agents/worktrees/review', 'repeating pr-85 under pr-85 only adds noise')
})

test('groups split the family from the workspace; a single group stays alone', () => {
  const own = { path: '', name: 'repo', kind: 'workspace', root: '/r' }
  const wt = { path: 'wts/a', name: 'a', kind: 'worktree', root: '/a', branch: 'a' }
  const foreign = { path: 'site', name: 'site', kind: 'repo', root: '/s' }

  const one = repoGroups([own, wt])
  assert.equal(one.length, 1, 'one family earns no header')
  assert.equal(one[0].key, 'own')
  assert.equal(one[0].selectable, 2)

  const both = repoGroups([own, wt, foreign])
  assert.deepEqual(both.map((g) => g.key), ['own', 'foreign'], 'the family leads, the workspace follows')
  assert.deepEqual(both.map((g) => g.items.length), [2, 1])

  const onlyForeign = repoGroups([foreign])
  assert.equal(onlyForeign.length, 1, 'a non-checkout workspace is one flat list, as before')
  assert.equal(onlyForeign[0].key, 'foreign')
  assert.equal(repoGroups([]).length, 0)
})

test('disabled rows count in the group but not as selectable', () => {
  const rows = [
    { path: '', name: 'repo', kind: 'workspace', root: '/r' },
    { path: 'wt/out', name: 'out', kind: 'worktree', root: '/o', disabled: 'outside' },
    { path: 'wt/gone', name: 'gone', kind: 'worktree', root: '/g', disabled: 'stale' },
    { path: '../copy', name: 'copy', kind: 'worktree', root: '/c', disabled: 'uncertified' },
  ]
  const groups = repoGroups(rows)
  assert.equal(groups[0].items.length, 4)
  assert.equal(groups[0].selectable, 1, 'the count badge must show both numbers')
  assert.equal(repoDisabledKey(rows[1]), 'repos.disabled.outside')
  assert.equal(repoDisabledKey(rows[2]), 'repos.disabled.stale')
  // A record this repository does not own states that, not "outside the cwd":
  // the row is outside precisely because the certification check failed.
  assert.equal(repoDisabledKey(rows[3]), 'repos.disabled.uncertified')
  assert.equal(repoDisabledKey(rows[0]), null, 'an ordinary row carries no reason')
})

test('the main checkout of a worktree session reads as family, not as a foreign repo', () => {
  // A session that moved into a linked worktree gets the main work tree as a
  // row with `role: 'main'`. It belongs to the same family, so it groups with
  // the worktrees and is labelled by name with the relative path beneath — a
  // `repo` kind would file it under the unrelated repositories instead.
  const choices = repoChoices([
    { path: '', root: '/r/.agents/worktrees/x', name: 'x', kind: 'workspace', role: 'linked', branch: 'feat/x' },
    { path: '../../../..', root: '/r', name: 'r', kind: 'nested', role: 'main', branch: 'main' },
  ])
  assert.deepEqual(choices.map((c) => c.kind), ['workspace', 'worktree'])
  const groups = repoGroups(choices)
  assert.equal(groups.length, 1, 'one family means one group, no foreign header')
  assert.equal(groups[0].key, 'own')
  assert.equal(groups[0].selectable, 2, 'the main checkout outside the cwd is selectable')
  assert.equal(repoLabel(choices[1]), 'r', 'the name leads')
  assert.equal(repoDetail(choices[1]), '../../../..', 'and the relative path is the detail line')
  assert.equal(repoDisabledKey(choices[1]), null, 'no reason to show')
})

test('the browse-root menu leads with the project root, then every checkout', () => {
  const rows = filesRootRows('/r', [
    { path: '', name: 'repo', kind: 'workspace', root: '/r' },
    { path: 'wts/a', name: 'a', kind: 'worktree', root: '/a' },
    { path: 'site', name: 'site', kind: 'repo', root: '/s' },
  ], null)
  assert.deepEqual(rows.map((r) => r.selector), ['', 'wts/a', 'site'], 'the workspace row collapses into the project root')
  assert.equal(rows[0].kind, 'project')
  assert.equal(rows[0].root, '/r')
  assert.equal(rows[0].active, false, 'following marks no root row — the follow row is the caller\'s')
  assert.equal(rows[1].path, 'wts', 'the grey line repeats the switcher\'s detail rule')
  assert.equal(rows[2].path, 'site', 'a first-level repository keeps its own path')
})

test('the browse-root menu names an external root the way the switcher does', () => {
  // `folders[].name` is the name the user sees in their editor; two menus must
  // not show two different names for one root.
  const rows = filesRootRows('/hub', [
    { path: '', name: 'hub', kind: 'workspace', root: '/hub' },
    { path: '../service-a', name: 'service-a', kind: 'external', root: '/service-a', role: 'repo', label: 'API' },
    { path: '../service-b', name: 'service-b', kind: 'external', root: '/service-b', role: 'repo' },
  ], null)
  assert.equal(rows[1].name, 'API', 'the workspace file\'s label wins here too')
  assert.equal(rows[1].path, '../service-a', 'the selector stays on the grey line')
  assert.equal(rows[2].name, 'service-b', 'without a label the basename leads')
})

test('the browse-root menu marks the manual pick and keeps disabled rows listed', () => {
  const rows = filesRootRows('/p', [
    { path: '', name: 'p', kind: 'workspace', root: '/p' },
    { path: 'site', name: 'site', kind: 'repo', root: '/s' },
    { path: 'gone', name: 'gone', kind: 'repo', root: '/g', disabled: 'stale' },
  ], 'site')
  assert.equal(rows[0].active, false, 'the project root is not the pick')
  assert.equal(rows[1].active, true, 'the picked checkout is marked')
  assert.equal(rows[2].disabled, 'stale', 'disabled entries stay visible and marked')
  assert.equal(rows[2].active, false)

  const project = filesRootRows('/p', [], '')
  assert.equal(project.length, 1, 'a workspace without checkouts still offers the project root')
  assert.equal(project[0].active, true, "'' is the project-root pick itself")
  assert.equal(project[0].root, '/p')
})

test('a browse-root pick that lands on a checkout drags Git along', () => {
  const entries = [
    { path: '', name: 'p', kind: 'workspace', root: '/p' },
    { path: 'site', name: 'site', kind: 'nested', root: '/p/site' },
    { path: 'gone', name: 'gone', kind: 'nested', root: '/p/gone', disabled: 'stale' },
  ]
  assert.equal(gitRepoForFilesRoot('site', entries), 'site', 'a checkout root switches Git to it')
  assert.equal(gitRepoForFilesRoot('', entries), '', 'a project root that is a checkout switches Git back to it')
  assert.equal(gitRepoForFilesRoot(null, entries), null, 'the follow row moves the browser, not Git')
  assert.equal(gitRepoForFilesRoot('gone', entries), null, 'a disabled row cannot be switched to')
  assert.equal(gitRepoForFilesRoot('elsewhere', entries), null, 'a root the list does not offer is no checkout')
  const nonGit = entries.slice(1)
  assert.equal(gitRepoForFilesRoot('', nonGit), null, 'a project root that is no repository leaves Git where it is')
  assert.equal(gitRepoForFilesRoot('site', nonGit), 'site')
})

const tipText = (lines) => lines.map((line) => line.text).join('\n')
const tipKinds = (lines) => lines.map((line) => line.kind)

test('the row hover tip stacks branch over absolute root, one per line', () => {
  const wt = repoChoices([{ path: 'wts/a', name: 'a', kind: 'nested', role: 'linked', branch: 'feat/x', root: '/r/wts/a' }])[0]
  const lines = repoRowTip(wt, 'feat/x', { detached: 'HEAD is detached', disabled: null })
  assert.equal(tipText(lines), 'feat/x\n/r/wts/a')
  assert.deepEqual(tipKinds(lines), ['branch', 'path'], 'the path line is last so the renderer can rule above it')
})

test('the hover tip leads with the disabled reason when the row cannot be chosen', () => {
  const gone = repoChoices([{ path: 'gone', name: 'gone', kind: 'nested', root: '/r/gone', disabled: 'stale' }])[0]
  const lines = repoRowTip(gone, 'old', { detached: 'HEAD is detached', disabled: 'directory is gone' })
  assert.equal(tipText(lines), 'directory is gone\nold\n/r/gone', 'reason, then branch, then path')
  assert.deepEqual(tipKinds(lines), ['reason', 'branch', 'path'], 'the reason keeps its own kind: it earns no branch icon')
})

test('the hover tip states a detached HEAD as its own line and skips an unknown branch', () => {
  const entry = { path: 'site', name: 'site', kind: 'nested', root: '/r/site' }
  const detached = repoChoices([{ ...entry, branch: null }])[0]
  const lines = repoRowTip(detached, null, { detached: 'HEAD is detached', disabled: null })
  assert.equal(tipText(lines), 'HEAD is detached\n/r/site')
  assert.deepEqual(tipKinds(lines), ['branch', 'path'], 'a detached HEAD is still the branch line')
  const unsampled = repoChoices([entry])[0]
  assert.equal(tipText(repoRowTip(unsampled, undefined, { detached: 'HEAD is detached', disabled: null })), '/r/site', 'a foreign row nobody sampled claims no branch')
  assert.equal(tipText(repoRowTip(unsampled, '', { detached: 'HEAD is detached', disabled: null })), '/r/site', 'an empty branch is not a claim either')
})

test('the hover tip falls back to the label when the checkout reports no root', () => {
  const ws = { path: '', name: 'ws', root: '', kind: 'workspace' }
  const lines = repoRowTip(ws, 'main', { detached: 'HEAD is detached', disabled: null })
  assert.equal(tipText(lines), 'main\nws')
  assert.deepEqual(tipKinds(lines), ['branch', 'path'], 'the label sits on the path line')
})
