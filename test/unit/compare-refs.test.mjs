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
import { compareApplies, compareCandidates, compareRows, filterCandidates, revisionCandidates, revisionLabel, COMPARE_GROUPS } from '../../lib/testkit.mjs'

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

test('a multi-group list headings each group once', () => {
  const refs = compareCandidates(branches([b('main'), b('dev')], [b('origin/main')]), tagList([b('v1')]))
  const rows = compareRows(refs)
  assert.deepEqual(rows.map((r) => r.heading), ['overview.local', null, 'overview.remote', 'overview.tags'])
  assert.deepEqual(rows.map((r) => r.ref.group), ['local', 'local', 'remote', 'tag'])
})

test('a single-group list carries no heading', () => {
  // The revisions picker is the case: every row is grouped `local`, and a lone
  //「本地」above a list of commits names nothing.
  const rows = compareRows(revisionCandidates([
    { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'one' },
    { hash: 'b'.repeat(40), shortHash: 'bbbbbbb', subject: 'two' },
  ]))
  assert.deepEqual(rows.map((r) => r.heading), [null, null])
  const one = compareCandidates(branches([b('main')]), tagList([]))
  assert.deepEqual(compareRows(one).map((r) => r.heading), [null], 'even a single row')
})

test('an empty list has no rows and no groups to draw', () => {
  assert.deepEqual(compareRows([]), [])
  assert.deepEqual(COMPARE_GROUPS, ['local', 'remote', 'tag'], 'the display order is pinned')
})

test('a revision row names the commit by hash and short hash', () => {
  const [row] = revisionCandidates([{ hash: 'f'.repeat(40), shortHash: 'fffffff', subject: 'fix: x' }])
  assert.equal(row.rev, 'f'.repeat(40))
  assert.equal(row.label, 'fffffff  fix: x')
  assert.equal(revisionLabel({ shortHash: 'fffffff' }), 'fffffff')
})
