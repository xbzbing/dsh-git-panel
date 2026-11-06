/**
 * The ref candidates behind the comparison picker.
 *
 * Two wiring mistakes this pins: the rev handed to the host must be the ref the
 * repository actually has (a short name cannot be prefixed back — a branch and
 * a tag that share a name spell as `heads/foo` / `tags/foo`, and a
 * remote-tracking HEAD spells as its remote), and a single-group list must not
 * carry a heading.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareApplies, compareCandidates, compareRowHeight, compareRows, filterCandidates, moveCursor, pickedLabel,
  revealOffset, revisionCandidates, COMPARE_GROUPS, COMPARE_ROW_HEIGHTS,
} from '../../lib/testkit.mjs'

const branches = (local, remote = []) => ({ local, remote })
const tagList = (tags) => ({ tags })
const b = (name, ref) => (ref === undefined ? { name, shortHash: null } : { name, shortHash: null, ref })

test('the candidates carry the full ref the host reported', () => {
  const refs = compareCandidates(
    branches([b('main', 'refs/heads/main'), b('heads/same-name', 'refs/heads/same-name')], [b('origin/main', 'refs/remotes/origin/main')]),
    tagList([b('tags/same-name', 'refs/tags/same-name'), b('v1', 'refs/tags/v1')]),
  )
  assert.deepEqual(refs.map((r) => r.rev), [
    'refs/heads/main',
    'refs/heads/same-name',
    'refs/remotes/origin/main',
    'refs/tags/same-name',
    'refs/tags/v1',
  ], 'a disambiguated short name is never prefixed a second time')
  assert.deepEqual(refs.map((r) => r.label), ['main', 'heads/same-name', 'origin/main', 'tags/same-name', 'v1'])
  assert.deepEqual(refs.map((r) => r.group), ['local', 'local', 'remote', 'tag', 'tag'])
})

test('a host without the ref field falls back to the prefixed name', () => {
  const refs = compareCandidates(branches([b('main')], [b('origin/main')]), tagList([b('v1')]))
  assert.deepEqual(refs.map((r) => r.rev), ['refs/heads/main', 'refs/remotes/origin/main', 'refs/tags/v1'])
})

test('a remote-tracking HEAD is not a comparison target, but a branch called …/HEAD is', () => {
  // `origin` is how git spells refs/remotes/origin/HEAD; it is not a ref. New
  // hosts drop that row themselves; this pins the client's own defence and the
  // case a `/HEAD` name suffix would have broken.
  const refs = compareCandidates(branches([], [
    b('origin'),
    b('origin/HEAD', 'refs/remotes/origin/HEAD'),
    b('origin/feature/HEAD', 'refs/remotes/origin/feature/HEAD'),
    b('origin/main', 'refs/remotes/origin/main'),
  ]), tagList([]))
  assert.deepEqual(refs.map((r) => r.rev), ['refs/remotes/origin/feature/HEAD', 'refs/remotes/origin/main'])
})

test('an old host without refs is still filtered by the name shape', () => {
  const refs = compareCandidates(branches([], [b('origin'), b('origin/main')]), tagList([]))
  assert.deepEqual(refs.map((r) => r.rev), ['refs/remotes/origin/main'])
})

test('a comparison applies only to the checkout that raised it', () => {
  const request = { sessionId: 's1', repo: '/w' }
  assert.equal(compareApplies(request, 's1', '/w'), true)
  assert.equal(compareApplies(request, 's1', '/other'), false, 'another checkout must not run it')
  assert.equal(compareApplies(request, 's2', '/w'), false, 'nor another session')
  assert.equal(compareApplies(null, 's1', '/w'), false)
  assert.equal(compareApplies(request, undefined, '/w'), false)
})

test('the filter is a case-insensitive substring over the label', () => {
  const refs = compareCandidates(branches([b('Feature/Login')], [b('origin/main')]), tagList([b('v1')]))
  assert.deepEqual(filterCandidates(refs, 'FEAT').map((r) => r.rev), ['refs/heads/Feature/Login'])
  assert.deepEqual(filterCandidates(refs, '  ').length, refs.length, 'a blank needle filters nothing')
  assert.deepEqual(filterCandidates(refs, 'zzz'), [])
})

test('a commit also matches on its short hash and author, a ref never on its hash', () => {
  const commits = revisionCandidates([
    { hash: 'a'.repeat(40), shortHash: 'abc1234', subject: 'fix: login', author: 'Alice', dateIso: '2026-01-01T00:00:00Z' },
    { hash: 'b'.repeat(40), shortHash: 'def5678', subject: 'feat: logout', author: 'Bob', dateIso: '2026-01-02T00:00:00Z' },
  ])
  assert.deepEqual(filterCandidates(commits, 'ABC1').map((r) => r.shortHash), ['abc1234'], 'by hash')
  assert.deepEqual(filterCandidates(commits, 'bob').map((r) => r.shortHash), ['def5678'], 'by author')
  assert.deepEqual(filterCandidates(commits, 'log').length, 2, 'by subject')
  // A ref's short hash is shown but not searched: typing a hash prefix into the
  // branch picker must not turn up every branch that happens to start with it.
  const refs = compareCandidates(branches([{ name: 'main', shortHash: 'abc1234' }]), tagList([]))
  assert.deepEqual(filterCandidates(refs, 'abc'), [])
})

test('a multi-group list puts one counted heading above each group', () => {
  const refs = compareCandidates(branches([b('main'), b('dev')], [b('origin/main')]), tagList([b('v1')]))
  const rows = compareRows(refs)
  assert.deepEqual(rows.map((r) => (r.kind === 'heading' ? `#${r.title}:${r.count}` : r.ref.label)), [
    '#overview.local:2', 'main', 'dev', '#overview.remote:1', 'origin/main', '#overview.tags:1', 'v1',
  ])
  // The cursor counts pickable rows only, so it can never sit on a heading.
  assert.deepEqual(rows.filter((r) => r.kind === 'ref').map((r) => r.index), [0, 1, 2, 3])
})

test('a single-group list carries no heading', () => {
  // The revisions picker is the case: every row is a commit, and a lone
  //「提交」above a list of commits names nothing the title does not.
  const rows = compareRows(revisionCandidates([
    { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'one', author: 'A', dateIso: '' },
    { hash: 'b'.repeat(40), shortHash: 'bbbbbbb', subject: 'two', author: 'A', dateIso: '' },
  ]))
  assert.deepEqual(rows.map((r) => r.kind), ['ref', 'ref'])
  const one = compareCandidates(branches([b('main')]), tagList([]))
  assert.deepEqual(compareRows(one).map((r) => r.kind), ['ref'], 'even a single row')
})

test('an empty list has no rows and no groups to draw', () => {
  assert.deepEqual(compareRows([]), [])
  assert.deepEqual(COMPARE_GROUPS, ['local', 'remote', 'tag'], 'the display order is pinned')
})

test('the checked-out branch is marked and every ref carries its short hash', () => {
  const refs = compareCandidates(
    { current: 'dev', local: [{ name: 'main', shortHash: '1111111' }, { name: 'dev', shortHash: '2222222' }], remote: [{ name: 'origin/main', shortHash: '3333333' }] },
    tagList([{ name: 'v1', shortHash: '4444444' }]),
  )
  assert.deepEqual(refs.map((r) => [r.label, r.current === true, r.shortHash]), [
    ['main', false, '1111111'], ['dev', true, '2222222'], ['origin/main', false, '3333333'], ['v1', false, '4444444'],
  ])
})

test('row heights follow the row kind', () => {
  const [ref] = compareRows(compareCandidates(branches([b('main')]), tagList([])))
  const [commit] = compareRows(revisionCandidates([{ hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 's', author: 'A', dateIso: '' }]))
  const heading = compareRows(compareCandidates(branches([b('main')]), tagList([b('v1')])))[0]
  assert.equal(compareRowHeight(heading), COMPARE_ROW_HEIGHTS.heading)
  assert.equal(compareRowHeight(ref), COMPARE_ROW_HEIGHTS.ref)
  assert.equal(compareRowHeight(commit), COMPARE_ROW_HEIGHTS.commit, 'a commit row has a second line')
  assert.ok(COMPARE_ROW_HEIGHTS.commit > COMPARE_ROW_HEIGHTS.ref)
})

test('the keyboard cursor clamps at both ends and has no position in an empty list', () => {
  assert.equal(moveCursor(0, 1, 3), 1)
  assert.equal(moveCursor(2, 1, 3), 2, 'stops at the last row')
  assert.equal(moveCursor(0, -1, 3), 0, 'stops at the first row')
  assert.equal(moveCursor(-1, 1, 3), 0, 'no cursor yet: down lands on the first row')
  assert.equal(moveCursor(-1, -1, 3), 2, 'no cursor yet: up lands on the last row')
  assert.equal(moveCursor(0, 1, 0), -1)
})

test('revealing a row scrolls only as far as needed, and not at all when visible', () => {
  const tops = [0, 30, 60, 90, 120]
  assert.equal(revealOffset(tops, 1, 0, 60), null, 'already in view')
  assert.equal(revealOffset(tops, 3, 0, 60), 60, 'below: its bottom meets the viewport bottom')
  assert.equal(revealOffset(tops, 0, 45, 60), 0, 'above: its top meets the viewport top')
  assert.equal(revealOffset(tops, 9, 0, 60), null, 'an unknown row is ignored')
  assert.equal(revealOffset(tops, 1, 0, 0), null, 'an unmeasured viewport is ignored')
})

test('a revision row is the commit; the overlay names it by short hash', () => {
  const [row] = revisionCandidates([{ hash: 'f'.repeat(40), shortHash: 'fffffff', subject: 'fix: x', author: 'Ann', dateIso: '2026-01-03T00:00:00Z' }])
  assert.equal(row.rev, 'f'.repeat(40))
  assert.equal(row.label, 'fix: x', 'the subject is the row title')
  assert.equal(row.group, 'commit')
  assert.equal(row.author, 'Ann')
  assert.equal(row.dateIso, '2026-01-03T00:00:00Z')
  assert.equal(pickedLabel(row), 'fffffff', 'the subject is too long for the overlay bar')
  const [ref] = compareCandidates(branches([b('main')]), tagList([]))
  assert.equal(pickedLabel(ref), 'main')
})
