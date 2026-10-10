/**
 * Remote-URL parsing + primary-remote selection, plus the pull-ff plan and
 * not-ff failure classification.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRemote, classifyHost, parsePrimaryRemote, planAction, classifyActionFailure } from '../../lib/testkit.mjs'

test('parseRemote collapses every URL shape to one https page link', () => {
  const cases = [
    ['git@github.com:owner/repo.git', 'https://github.com/owner/repo', 'github.com', 'github'],
    ['https://github.com/owner/repo.git', 'https://github.com/owner/repo', 'github.com', 'github'],
    ['ssh://git@github.com/owner/repo.git', 'https://github.com/owner/repo', 'github.com', 'github'],
    ['git://github.com/owner/repo', 'https://github.com/owner/repo', 'github.com', 'github'],
    ['https://gitlab.com/group/sub/repo.git', 'https://gitlab.com/group/sub/repo', 'gitlab.com', 'gitlab'],
    ['git@gitee.com:owner/repo.git', 'https://gitee.com/owner/repo', 'gitee.com', 'gitee'],
    ['https://bitbucket.org/owner/repo.git', 'https://bitbucket.org/owner/repo', 'bitbucket.org', 'bitbucket'],
    ['git@git.example.com:team/repo.git', 'https://git.example.com/team/repo', 'git.example.com', 'other'],
  ]
  for (const [url, webUrl, host, hostKind] of cases) {
    const r = parseRemote('origin', url)
    assert.equal(r.webUrl, webUrl, url)
    assert.equal(r.host, host, url)
    assert.equal(r.hostKind, hostKind, url)
    assert.equal(r.url, url)
    assert.equal(r.name, 'origin')
  }
})

test('parseRemote strips embedded credentials from the page link', () => {
  const r = parseRemote('origin', 'https://user:ghp_secrettoken@github.com/owner/repo.git')
  assert.equal(r.webUrl, 'https://github.com/owner/repo')
  assert.ok(!r.webUrl.includes('ghp_secrettoken'), 'token must not leak into the href')
})

test('parseRemote returns a null webUrl for a bare local path', () => {
  const r = parseRemote('origin', '/srv/git/repo.git')
  assert.equal(r.webUrl, null)
  assert.equal(r.host, null)
  assert.equal(r.hostKind, 'other')
})

test('classifyHost matches apex and subdomains, else other', () => {
  assert.equal(classifyHost('github.com'), 'github')
  assert.equal(classifyHost('GitHub.com'), 'github')
  assert.equal(classifyHost('ssh.github.com'), 'github')
  assert.equal(classifyHost('gitlab.example.com'), 'other')
})

test('parsePrimaryRemote prefers origin, else the first fetch remote', () => {
  const withOrigin = [
    'upstream\thttps://github.com/up/repo.git (fetch)',
    'upstream\thttps://github.com/up/repo.git (push)',
    'origin\tgit@github.com:me/repo.git (fetch)',
    'origin\tgit@github.com:me/repo.git (push)',
  ].join('\n')
  const r = parsePrimaryRemote(withOrigin)
  assert.equal(r.name, 'origin')
  assert.equal(r.webUrl, 'https://github.com/me/repo')

  const noOrigin = [
    'fork\thttps://gitee.com/me/repo.git (fetch)',
    'fork\thttps://gitee.com/me/repo.git (push)',
  ].join('\n')
  const f = parsePrimaryRemote(noOrigin)
  assert.equal(f.name, 'fork')
  assert.equal(f.hostKind, 'gitee')

  assert.equal(parsePrimaryRemote(''), null)
})

test('pull-ff plans a fast-forward-only pull', () => {
  const plan = planAction({ kind: 'pull-ff' }, false)
  assert.deepEqual(plan, { argv: [['git', 'pull', '--ff-only']] })
})

test('classifyActionFailure maps a diverged fast-forward refusal to not-ff', () => {
  const out = classifyActionFailure('', 'fatal: Not possible to fast-forward, aborting.', 128)
  assert.equal(out.code, 'not-ff')
})
