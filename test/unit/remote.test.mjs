/**
 * Remote-URL parsing + primary-remote selection, plus the pull-ff plan and
 * not-ff failure classification.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRemote, classifyHost, parsePrimaryRemote, planAction, classifyActionFailure, isSafeRemoteName } from '../../lib/testkit.mjs'

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

test('push plans a plain git push (never --force)', () => {
  const plan = planAction({ kind: 'push' }, false)
  assert.deepEqual(plan, { argv: [['git', 'push']] })
  assert.ok(!JSON.stringify(plan).includes('force'))
})

test('publish plans push -u <remote> HEAD and revalidates the remote name', () => {
  assert.deepEqual(planAction({ kind: 'publish', remote: 'origin' }, false), { argv: [['git', 'push', '-u', 'origin', 'HEAD']] })
  // A hostile remote name never reaches the option position.
  assert.equal(planAction({ kind: 'publish', remote: '--upload-pack=evil' }, false).error, 'invalid-name')
})

test('isSafeRemoteName accepts git remote names and rejects option injection', () => {
  assert.equal(isSafeRemoteName('origin'), true)
  assert.equal(isSafeRemoteName('fork-2'), true)
  assert.equal(isSafeRemoteName('team/upstream'), true)
  assert.equal(isSafeRemoteName('-f'), false)
  assert.equal(isSafeRemoteName('--upload-pack=x'), false)
  assert.equal(isSafeRemoteName(''), false)
  assert.equal(isSafeRemoteName('a b'), false)
})

test('classifyActionFailure maps a rejected push to push-rejected', () => {
  const out = classifyActionFailure('', 'error: failed to push some refs to \'github.com:o/r.git\'\nhint: Updates were rejected because the tip of your current branch is behind', 1)
  assert.equal(out.code, 'push-rejected')
})

test('classifyActionFailure maps a credential failure (GIT_TERMINAL_PROMPT=0) to auth-failed', () => {
  assert.equal(classifyActionFailure('', "fatal: could not read Username for 'https://github.com': terminal prompts disabled", 128).code, 'auth-failed')
  assert.equal(classifyActionFailure('', 'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.', 128).code, 'auth-failed')
})
