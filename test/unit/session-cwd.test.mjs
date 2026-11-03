/**
 * The session's effective working directory (issue #98): `working_directory`
 * appends a projection event and never rewrites `header.cwd`, so the panel must
 * read the `workingDirectory` projection. Pure cases cover the read face; the
 * last group runs a real repository + worktree to prove the root the panel
 * resolves — and the `cwd` its sample reports — actually follow the switch.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import './_tmp-ceiling.mjs'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFsDeps } from '../../lib/host/fs-deps.js'
import { listSessionRepos, resolveWorkspace, sessionLiveCwd } from '../../lib/host/core.js'
import { DEFAULT_CONFIG, sessionFaces, snapshotForSession } from '../../lib/host/index.js'
import { gitRunner, runGit } from './_git-fixture.mjs'

const SESSION = { header: { cwd: '/project/main' } }


/** The projection's read face for one value (null = no directory recorded). */
const projection = (value) => ({ snapshot: () => ({ values: { workingDirectory: value } }) })

test('the projection is the effective directory, not the header', () => {
  assert.equal(sessionLiveCwd(SESSION, projection('/project/worktrees/feat')), '/project/worktrees/feat')
})

test('a host without the service falls back to the header', () => {
  assert.equal(sessionLiveCwd(SESSION, undefined), '/project/main')
})

test('a session that recorded no directory is unreadable', () => {
  // The projection's null is "no directory", not "ask the host for a default":
  // resolving it to the deployment directory would point the panel at a tree
  // no session ever chose.
  assert.equal(sessionLiveCwd({ header: {} }, projection(null)), undefined)
  assert.equal(sessionLiveCwd({ header: { cwd: '' } }, projection(null)), undefined)
  assert.equal(sessionLiveCwd(undefined, projection('/project/main')), undefined)
})

test('a switch recorded without a header directory still resolves', () => {
  // `working_directory` does not require the session to have started in one:
  // the projection owns the directory, so the header is not consulted.
  assert.equal(sessionLiveCwd({ header: {} }, projection('/project/moved')), '/project/moved')
})

test('a service that activates after the plugin is still picked up', () => {
  const services = { sessions: { get: (id) => (id === 'test-session' ? SESSION : undefined) } }
  const faces = sessionFaces((name) => services[name])
  assert.equal(faces.liveCwd('test-session'), '/project/main', 'before activation the header answers')
  services.sessionProjections = projection('/project/worktrees/feat')
  assert.equal(faces.liveCwd('test-session'), '/project/worktrees/feat', 'the next read follows it')
})

test('the host wiring reads the projection, not the header', () => {
  // This is the wiring the panel actually runs: the sessions face the service
  // hands to every endpoint. Reading the header here is exactly the issue.
  const faces = sessionFaces((name) => ({
    sessions: { get: (id) => (id === 'test-session' ? SESSION : undefined) },
    sessionProjections: projection('/project/worktrees/feat'),
  })[name])
  assert.equal(faces.liveCwd('test-session'), '/project/worktrees/feat')
})

test('persistedMeta still answers for a session without a live one', async () => {
  const faces = sessionFaces((name) => ({
    sessionPersistence: { stat: async () => ({ header: { cwd: '/project/persisted' } }) },
  })[name])
  assert.equal(faces.liveCwd('cold'), undefined)
  assert.deepEqual(await faces.persistedMeta('cold'), { cwd: '/project/persisted' })
})

let tmp
let main
let worktree

before(async () => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'gp-session-cwd-')))
  main = join(tmp, 'main')
  worktree = join(main, '.agents', 'worktrees', 'feat-a')
  mkdirSync(join(main, '.agents', 'worktrees'), { recursive: true })
  await runGit(main, ['init', '-q', '-b', 'main'])
  await runGit(main, ['config', 'user.email', 't@t.co'])
  await runGit(main, ['config', 'user.name', 'Tester'])
  await runGit(main, ['commit', '--allow-empty', '-qm', 'init'])
  await runGit(main, ['worktree', 'add', '-q', '-b', 'feat-a', worktree])
})

after(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function deps(session, projections) {
  return {
    run: gitRunner(),
    fs: createFsDeps(),
    sessions: {
      liveCwd: () => sessionLiveCwd(session, projections),
      persistedMeta: async () => undefined,
    },
  }
}

test('resolveWorkspace follows a session that moved into a worktree', async () => {
  const session = { header: { cwd: main } }
  const moved = await resolveWorkspace(deps(session, projection(worktree)), 'test-session')
  assert.equal(moved.ok, true)
  assert.equal(moved.root, realpathSync.native(worktree), 'the panel acts on the worktree the session is in')
  assert.equal(moved.cwd, worktree, 'and reports the directory it resolved from')

  // The same session on a host without the service keeps the original root:
  // the fallback is the header, never a failure.
  const pinned = await resolveWorkspace(deps(session, undefined), 'test-session')
  assert.equal(pinned.ok, true)
  assert.equal(pinned.root, realpathSync.native(main))
})

test('the repository list reports the moved directory as the workspace root', async () => {
  const listed = await listSessionRepos(deps({ header: { cwd: main } }, projection(worktree)), 'test-session', true)
  assert.equal(listed.ok, true)
  assert.equal(listed.value.cwd, realpathSync.native(worktree))
  assert.equal(listed.value.repos[0].path, '')
  assert.equal(listed.value.repos[0].root, realpathSync.native(worktree))
})

test('the sample carries the directory the repository list answers about', async () => {
  // The client keys its re-scan on this field: without it a cwd move inside one
  // workspace leaves the switcher describing the previous directory.
  const sampled = await snapshotForSession(deps({ header: { cwd: main } }, projection(worktree)), DEFAULT_CONFIG, 'test-session')
  assert.equal(sampled.ok, true)
  const snapshot = sampled.value
  assert.equal(snapshot.root, realpathSync.native(worktree))
  assert.equal(snapshot.cwd, realpathSync.native(worktree))
  assert.equal(snapshot.stateFingerprint === undefined, false, 'the fingerprint covers the new field')
})
