/**
 * Changes-view row model: flat vs tree flattening, directory counts and the
 * directory-level policies the tab drives. Every expectation is about the row
 * list the virtualized list mounts, so the tests cover ordering, collapse,
 * filtering and what a directory action would name — not the DOM.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildChangeRows, dirDiscardPaths, dirKey, dirStageAction, matchesFilter, normalizeViewMode } from '../../lib/testkit.mjs'

const change = (path, { status = 'modified', staged = false, ...rest } = {}) => ({
  path, status, staged, isDirectory: false, ...rest,
})

/** Row shape the tab renders: kind plus the display name and tree depth. */
const shape = (rows) => rows.map((row) => {
  if (row.kind === 'head') return `head:${row.group}:${row.count}`
  if (row.kind === 'dir') return `dir:${row.name}@${row.depth}`
  return `file:${row.change.path.split('/').pop()}@${row.depth}`
})

const build = (groups, overrides = {}) => buildChangeRows({
  groups,
  closedGroups: new Set(),
  mode: 'tree',
  collapsedDirs: new Set(),
  filter: '',
  ...overrides,
})

test('flat mode lists one row per change, no directories', () => {
  const rows = build([{ key: 'unstaged', count: 2, items: [change('src/a.ts'), change('src/b.ts')] }], { mode: 'flat' })
  assert.deepEqual(shape(rows), ['head:unstaged:2', 'file:a.ts@0', 'file:b.ts@0'])
})

test('tree mode nests changes under their directories and counts them', () => {
  const rows = build([{
    key: 'unstaged',
    count: 3,
    items: [change('src/client/a.ts'), change('src/client/b.ts'), change('readme.md')],
  }])
  assert.deepEqual(shape(rows), [
    'head:unstaged:3',
    'dir:src/client@0',
    'file:a.ts@1',
    'file:b.ts@1',
    'file:readme.md@0',
  ])
  const dir = rows.find((row) => row.kind === 'dir')
  assert.equal(dir.changes.length, 2)
})

test('tree mode collapses a single-child directory chain into one row', () => {
  const rows = build([{ key: 'staged', count: 1, items: [change('a/b/c/file.ts', { staged: true })] }])
  assert.deepEqual(shape(rows), ['head:staged:1', 'dir:a/b/c@0', 'file:file.ts@1'])
})

test('a collapsed directory hides its rows but keeps them as its target', () => {
  const rows = build([{ key: 'unstaged', count: 2, items: [change('src/a.ts'), change('src/b.ts')] }], {
    collapsedDirs: new Set([dirKey('unstaged', 'src')]),
  })
  assert.deepEqual(shape(rows), ['head:unstaged:2', 'dir:src@0'])
  assert.equal(rows[1].collapsed, true)
  assert.deepEqual(rows[1].changes.map((c) => c.path), ['src/a.ts', 'src/b.ts'])
})

test('collapse state is per group: the same directory folds independently', () => {
  const groups = [
    { key: 'staged', count: 1, items: [change('src/a.ts', { staged: true })] },
    { key: 'unstaged', count: 1, items: [change('src/a.ts')] },
  ]
  const rows = build(groups, { collapsedDirs: new Set([dirKey('staged', 'src')]) })
  assert.deepEqual(shape(rows), [
    'head:staged:1',
    'dir:src@0',
    'head:unstaged:1',
    'dir:src@0',
    'file:a.ts@1',
  ])
})

test('a closed group keeps its header and drops every row', () => {
  const groups = [{ key: 'unstaged', count: 1, items: [change('src/a.ts')] }]
  const collapsed = build(groups, { closedGroups: new Set(['unstaged']) })
  assert.deepEqual(shape(collapsed), ['head:unstaged:1'])
  assert.equal(collapsed[0].collapsed, true, 'the header reads as folded')
  assert.deepEqual(shape(build(groups, { mode: 'flat', closedGroups: new Set(['unstaged']) })), ['head:unstaged:1'])
})

test('a filter reopens a group the reader had folded', () => {
  const groups = [{ key: 'unstaged', count: 1, items: [change('src/a.ts')] }]
  const filtered = build(groups, { closedGroups: new Set(['unstaged']), filter: 'a.ts' })
  assert.deepEqual(shape(filtered), ['head:unstaged:1', 'dir:src@0', 'file:a.ts@1'])
  assert.equal(filtered[0].collapsed, false, 'a hit is always reachable')
  // The fold is remembered: clearing the query folds the group again.
  assert.deepEqual(shape(build(groups, { closedGroups: new Set(['unstaged']) })), ['head:unstaged:1'])
})

test('a group that fell past the list cap keeps its honest count', () => {
  // The host capped the list before this group's rows: header only, full total.
  const rows = build([{ key: 'unstaged', count: 9, items: [] }])
  assert.deepEqual(shape(rows), ['head:unstaged:9'])
  assert.equal(rows[0].collapsible, false)
})

test('the filter narrows to matching paths and counts the hits', () => {
  const rows = build([{
    key: 'unstaged',
    count: 3,
    items: [change('src/client/a.ts'), change('src/client/b.ts'), change('docs/readme.md')],
  }], { filter: 'client' })
  assert.deepEqual(shape(rows), ['head:unstaged:2', 'dir:src/client@0', 'file:a.ts@1', 'file:b.ts@1'])
})

test('a filter match inside a collapsed directory is still shown', () => {
  // The reader folded `src`, then searched for a file inside it: the hit — and
  // the directory that holds it — must appear.
  const rows = build([{ key: 'unstaged', count: 2, items: [change('src/a.ts'), change('other/b.ts')] }], {
    collapsedDirs: new Set([dirKey('unstaged', 'src')]),
    filter: 'a.ts',
  })
  assert.deepEqual(shape(rows), ['head:unstaged:1', 'dir:src@0', 'file:a.ts@1'])
  const dir = rows.find((row) => row.kind === 'dir')
  assert.equal(dir.collapsed, false)
})

test('a filter that matches nothing leaves no rows', () => {
  const groups = [
    { key: 'staged', count: 1, items: [change('src/a.ts', { staged: true })] },
    { key: 'unstaged', count: 1, items: [change('src/b.ts')] },
  ]
  assert.deepEqual(build(groups, { filter: 'nope' }), [])
  // A blank filter is not a filter: the whole list stays.
  assert.equal(build(groups, { filter: '   ' }).length, 6)
})

test('matching is case-insensitive and only looks at the path', () => {
  assert.equal(matchesFilter('src/Client/A.ts', 'client'), true)
  assert.equal(matchesFilter('src/client/a.ts', 'CLIENT'), true)
  assert.equal(matchesFilter('src/client/a.ts', '  client '), true)
  assert.equal(matchesFilter('src/client/a.ts', 'docs'), false)
  assert.equal(matchesFilter('src/client/a.ts', ''), true)
})

test('an untracked directory entry stays a leaf row', () => {
  // Nested repositories and the collapsed untracked fallback arrive as one
  // directory entry; the tree groups its row by path but never invents children
  // for it, so the path itself stays the action target.
  const rows = build([{ key: 'untracked', count: 1, items: [change('vendor/lib', { status: 'untracked', isDirectory: true })] }])
  assert.deepEqual(shape(rows), ['head:untracked:1', 'dir:vendor@0', 'file:lib@1'])
  const leaf = rows.find((row) => row.kind === 'file')
  assert.equal(leaf.change.path, 'vendor/lib')
  assert.deepEqual(dirDiscardPaths(rows.find((row) => row.kind === 'dir').changes), ['vendor/lib'])
})

test('the same path on both sides produces one row per group', () => {
  const groups = [
    { key: 'staged', count: 1, items: [change('a.txt', { staged: true })] },
    { key: 'unstaged', count: 1, items: [change('a.txt')] },
  ]
  const rows = build(groups, { mode: 'flat' })
  assert.deepEqual(shape(rows), ['head:staged:1', 'file:a.txt@0', 'head:unstaged:1', 'file:a.txt@0'])
})

test('the staged side stages nothing and unstages its rows', () => {
  const staged = [change('src/a.ts', { staged: true }), change('src/b.ts', { staged: true })]
  assert.deepEqual(dirStageAction('staged', staged), { kind: 'unstage', paths: ['src/a.ts', 'src/b.ts'] })
  // Nothing to unstage on a working-tree list.
  assert.equal(dirStageAction('staged', [change('src/a.ts')]), null)
})

test('a work-tree directory stages its own rows, sorted and deduped', () => {
  const changes = [change('src/b.ts'), change('src/a.ts'), change('src/a.ts')]
  assert.deepEqual(dirStageAction('unstaged', changes), { kind: 'stage', paths: ['src/a.ts', 'src/b.ts'] })
  assert.deepEqual(dirStageAction('untracked', [change('docs/x.md', { status: 'untracked' })]), {
    kind: 'stage', paths: ['docs/x.md'],
  })
})

test('discard names the working-tree rows only', () => {
  assert.deepEqual(dirDiscardPaths([change('src/a.ts'), change('src/b.ts', { staged: true })]), ['src/a.ts'])
  // An index-only directory has nothing to discard.
  assert.deepEqual(dirDiscardPaths([change('src/a.ts', { staged: true })]), [])
  // A nested repository entry is passed as itself: the host's own guard decides.
  assert.deepEqual(dirDiscardPaths([change('vendor/lib', { status: 'untracked', isDirectory: true })]), ['vendor/lib'])
})

test('collapse keys separate the groups and the view mode defaults to flat', () => {
  assert.notEqual(dirKey('staged', 'src'), dirKey('unstaged', 'src'))
  assert.equal(normalizeViewMode('tree'), 'tree')
  assert.equal(normalizeViewMode('flat'), 'flat')
  assert.equal(normalizeViewMode(null), 'flat')
  assert.equal(normalizeViewMode('nonsense'), 'flat')
})
