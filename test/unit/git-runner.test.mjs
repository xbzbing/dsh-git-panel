/**
 * Unit: the GitRunner env contract — GIT_LITERAL_PATHSPECS is injected only for
 * the whitelisted subcommands that receive a work-tree path list after `--`.
 * A glob metacharacter in a work-tree name (`app/[id].tsx`) must stay literal
 * for those commands, while pathspec consumers (`check-ignore`, `stash push`)
 * must never see the flag: it makes them go fatal.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGitRunner } from '../../lib/host/index.js'

/** Recording fake subprocess: captures each spawn spec, answers empty output. */
function recordingSubprocess() {
  const specs = []
  return {
    specs,
    spawn(spec) {
      specs.push(spec)
      const output = { readFrom: () => ({ text: '', lossy: false }) }
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: { stdout: output, stderr: output },
      }
    },
  }
}

const runner = (subprocess) => createGitRunner(subprocess, 5000, 1024)

async function envFor(argv) {
  const subprocess = recordingSubprocess()
  await runner(subprocess).run(argv, { cwd: '/repo' })
  assert.equal(subprocess.specs.length, 1, `one spawn for ${argv.join(' ')}`)
  return subprocess.specs[0].env
}

test('a whitelisted subcommand with a -- path list runs literal', async () => {
  const env = await envFor(['git', 'diff', '--', 'app/[id].tsx'])
  assert.equal(env.GIT_LITERAL_PATHSPECS, '1')
})

test('mutating whitelisted subcommands run literal too', async () => {
  for (const argv of [
    ['git', 'restore', '--', 'app/[id].tsx'],
    ['git', 'rm', '--cached', '--', 'app/[id].tsx'],
    ['git', 'update-index', '--add', '--', 'app/[id].tsx'],
  ]) {
    assert.equal((await envFor(argv)).GIT_LITERAL_PATHSPECS, '1', argv.join(' '))
  }
})

test('pathspec consumers keep expansion even after a --', async () => {
  for (const argv of [
    ['git', 'check-ignore', '--', 'app/[id].tsx'],
    ['git', 'stash', 'push', '-u', '--', 'app/[id].tsx'],
  ]) {
    assert.equal((await envFor(argv)).GIT_LITERAL_PATHSPECS, undefined, argv.join(' '))
  }
})

test('pattern-composing subcommands pin the default expansion on', async () => {
  // The history search builds `:(top,icase)*<escaped>*`, whose meaning depends on
  // git's default wildmatch. Leaving these unset would inherit a GIT_*PATHSPECS
  // setting from the shell and turn a correct pattern into an empty result.
  for (const argv of [
    ['git', 'log', '--oneline', '--'],
    ['git', 'rev-list', 'HEAD', '--'],
    ['git', 'log', '--format=%H'],
  ]) {
    const env = await envFor(argv)
    assert.equal(env.GIT_LITERAL_PATHSPECS, '0', argv.join(' '))
    assert.equal(env.GIT_NOGLOB_PATHSPECS, '0', argv.join(' '))
    assert.equal(env.GIT_GLOB_PATHSPECS, '0', argv.join(' '))
  }
})

test('a whitelisted subcommand without -- keeps the default expansion', async () => {
  const env = await envFor(['git', 'diff', 'HEAD'])
  assert.equal(env.GIT_LITERAL_PATHSPECS, undefined)
})

test('the prompt and optional-locks env is always on', async () => {
  const env = await envFor(['git', 'status', '--porcelain=v1', '-z'])
  assert.equal(env.GIT_TERMINAL_PROMPT, '0')
  assert.equal(env.GIT_OPTIONAL_LOCKS, '0')
})
