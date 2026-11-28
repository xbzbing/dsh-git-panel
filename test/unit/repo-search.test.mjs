/**
 * Repository search model (issue #161): which rows a query keeps, where the
 * highlight lands, and what the grey line says when the match came from a
 * path the row does not print.
 *
 * The load-bearing properties: the query is a plain AND of whitespace terms
 * over the row's whole identity (name, workspace label, relative selector,
 * absolute root) with no fuzzy guessing; filtering keeps list order and
 * disabled rows; a term can never match across a field boundary; and a row
 * matched only through its absolute root shows a fragment of that root rather
 * than a grey line that gives no clue why it survived.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repoChoices, repoSearchTokens, repoSearchMatch, filterRepoChoices, repoSearchHighlight, repoSearchDetail } from '../../lib/testkit.mjs'

/** A scan entry; only the fields the search reads. */
function entry(path, name, kind) {
  return { path, name, kind, root: `/w/${path}` }
}

const rows = () => repoChoices([
  entry('', 'fixture-repo', 'workspace'),
  entry('site', 'site', 'nested'),
  entry('apps/web', 'web', 'nested'),
  { path: '../service-a', name: 'service-a', kind: 'external', root: '/service-a', label: 'API' },
])

test('the query splits on whitespace into lowercase terms', () => {
  assert.deepEqual(repoSearchTokens('  API   login '), ['api', 'login'])
  assert.deepEqual(repoSearchTokens('   '), [], 'blank input means no filter')
  assert.deepEqual(repoSearchTokens(''), [])
  // A term keeps its punctuation: paths are full of dots and dashes.
  assert.deepEqual(repoSearchTokens('api-php-login'), ['api-php-login'])
})

test('every term must land somewhere in the row', () => {
  const list = rows()
  const [workspace, site, web, external] = list
  assert.equal(repoSearchMatch(site, repoSearchTokens('site')), true)
  assert.equal(repoSearchMatch(site, repoSearchTokens('SITE')), true, 'matching ignores case')
  assert.equal(repoSearchMatch(web, repoSearchTokens('apps/web')), true, 'the relative selector is searchable')
  assert.equal(repoSearchMatch(web, repoSearchTokens('web apps')), true, 'terms may land in different fields')
  assert.equal(repoSearchMatch(web, repoSearchTokens('web missing')), false, 'one missing term drops the row')
  assert.equal(repoSearchMatch(external, repoSearchTokens('api')), true, 'the workspace-file label is searchable')
  assert.equal(repoSearchMatch(external, repoSearchTokens('service-a')), true, 'the basename is searchable even when the label hides it')
  assert.equal(repoSearchMatch(workspace, repoSearchTokens('')), true, 'no terms match everything')
  // Fields join with newlines: `pe` + `site` must not fabricate `pesite`.
  const boundary = repoChoices([{ path: 'pe', name: 'site', kind: 'nested', root: '/x' }])[0]
  assert.equal(repoSearchMatch(boundary, repoSearchTokens('esit')), false, 'no matching across a field boundary')
})

test('the absolute root is searchable', () => {
  const hub = repoChoices([
    { path: '', name: 'passport', kind: 'workspace', root: '/Users/x/workspace/baidu/passport' },
    { path: 'login', name: 'login', kind: 'nested', root: '/Users/x/workspace/baidu/passport/login' },
  ])
  assert.equal(repoSearchMatch(hub[1], repoSearchTokens('passport')), true, 'a parent directory counts')
  assert.equal(repoSearchMatch(hub[1], repoSearchTokens('workspace baidu')), true)
})

test('filtering keeps list order and disabled rows', () => {
  const list = repoChoices([
    entry('', 'fixture-repo', 'workspace'),
    { ...entry('gone', 'gone', 'nested'), disabled: 'stale' },
    entry('site', 'site', 'nested'),
    entry('apps/web', 'web', 'nested'),
  ])
  const all = filterRepoChoices(list, [])
  assert.equal(all, list, 'no terms leaves the list untouched')
  const matched = filterRepoChoices(list, repoSearchTokens('e'))
  assert.deepEqual(matched.map((r) => r.path), ['', 'gone', 'site', 'apps/web'], 'order is the list\'s, and a disabled row stays visible')
  const narrow = filterRepoChoices(list, repoSearchTokens('site'))
  assert.deepEqual(narrow.map((r) => r.path), ['site'], 'a term only some rows carry narrows the list')
  assert.equal(filterRepoChoices(list, repoSearchTokens('nothing-here')).length, 0)
})

test('highlight marks every covered run and joins back to the line', () => {
  const segments = repoSearchHighlight('api-php-login', repoSearchTokens('api login'))
  assert.deepEqual(segments.map((s) => [s.text, s.hit]), [
    ['api', true], ['-php-', false], ['login', true],
  ])
  assert.equal(segments.map((s) => s.text).join(''), 'api-php-login', 'the runs reconstruct the line')
  // Overlapping terms merge into one run instead of splitting mid-word.
  const merged = repoSearchHighlight('login', repoSearchTokens('log login'))
  assert.deepEqual(merged, [{ text: 'login', hit: true }])
  assert.deepEqual(repoSearchHighlight('site', []), [{ text: 'site', hit: false }], 'no terms means no marks')
  assert.deepEqual(repoSearchHighlight('', repoSearchTokens('x')), [{ text: '', hit: false }])
  // A length-changing lowercase would shift the ranges; matching still works,
  // highlighting stands down rather than marking the wrong characters.
  assert.deepEqual(repoSearchHighlight('İstanbul', repoSearchTokens('stan')), [{ text: 'İstanbul', hit: false }])
})

test('a hidden term swaps the grey line for a root fragment', () => {
  const hub = repoChoices([
    { path: '', name: 'fixture-repo', kind: 'workspace', root: '/Users/x/workspace/baidu/passport' },
    { path: 'apps/web', name: 'web', kind: 'nested', root: '/Users/x/workspace/baidu/passport/apps/web' },
  ])
  // Terms already visible keep the row's own detail line.
  assert.equal(repoSearchDetail(hub[1], repoSearchTokens('apps/web')), 'apps/web')
  assert.equal(repoSearchDetail(hub[1], repoSearchTokens('web')), 'apps/web')
  // `passport` lives only in the absolute root: the line swaps to a fragment
  // that carries it, so the row says where the match came from.
  const fragment = repoSearchDetail(hub[1], repoSearchTokens('passport'))
  assert.ok(fragment.includes('passport'), 'the fragment names the matched directory: ' + fragment)
  assert.ok(fragment.startsWith('…') || fragment.startsWith('/'), 'a cut fragment is marked')
  assert.equal(repoSearchDetail(hub[1], []), 'apps/web', 'no terms means the ordinary detail')
  // The workspace row prints no path at all; a root-only match still speaks.
  const wsFragment = repoSearchDetail(hub[0], repoSearchTokens('passport'))
  assert.ok(wsFragment.includes('passport'), 'the workspace row shows its root fragment too: ' + wsFragment)
})

test('a root fragment keeps the matched term whole', () => {
  const row = repoChoices([
    { path: 'x', name: 'x', kind: 'nested', root: '/deep/nested/directory/with/a/very/long/name/that/keeps/going/x' },
  ])[0]
  const fragment = repoSearchDetail(row, repoSearchTokens('keeps'))
  assert.ok(fragment.includes('keeps'), 'the term survives the cut: ' + fragment)
  assert.ok(fragment.length < row.root.length, 'the fragment is shorter than the full root')
})
