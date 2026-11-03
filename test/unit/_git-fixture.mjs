/**
 * Shared git test scaffolding: a child_process-backed `subprocess` service
 * matching the host's `SubprocessLike` face, a `git` runner for building
 * fixture repositories, and the configured `GitRunner` the host would build
 * from the same face.
 *
 * Repositories are real (temporary directories); only the subprocess service is
 * a stand-in. Callers that create fixtures under a temp dir still import
 * `_tmp-ceiling.mjs` themselves — this module starts no git process on import.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { createGitRunner, DEFAULT_CONFIG } from '../../lib/host/index.js'

/** child_process-backed subprocess service matching SubprocessLike.
 * Mirrors the production collector's bounds: stdout/stderr past the spec's
 * `maxBytes` kill the child and are reported `lossy` (the spill-file half of
 * the production contract has no meaning here — the test runner reads only
 * the in-memory tail). */
export const subprocess = {
  spawn(spec) {
    const child = nodeSpawn(spec.argv[0], spec.argv.slice(1), {
      cwd: spec.cwd,
      env: { ...process.env, ...(spec.env ?? {}) },
    })
    if (typeof spec.stdio.stdin === 'object') child.stdin.end(spec.stdio.stdin.data)
    else child.stdin.end()
    const maxOut = spec.stdio.stdout?.collect?.maxBytes ?? Infinity
    const maxErr = spec.stdio.stderr?.collect?.maxBytes ?? Infinity
    let out = ''
    let err = ''
    let outLossy = false
    let errLossy = false
    const overflow = () => { child.kill('SIGKILL') }
    child.stdout.on('data', (d) => {
      if (out.length + d.length > maxOut) { outLossy = true; overflow(); return }
      out += d
    })
    child.stderr.on('data', (d) => {
      if (err.length + d.length > maxErr) { errLossy = true; overflow(); return }
      err += d
    })
    const done = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
    })
    return {
      done,
      collected: {
        stdout: { readFrom: () => ({ text: out, lossy: outLossy }) },
        stderr: { readFrom: () => ({ text: err, lossy: errLossy }) },
      },
    }
  },
}

/** Run one git command in `cwd`; rejects with its stderr on a non-zero exit. */
export function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const c = nodeSpawn('git', args, { cwd })
    let err = ''
    c.stderr.on('data', (d) => { err += d })
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error('git ' + args.join(' ') + ': ' + err))))
  })
}

/** The git runner the host builds: same subprocess face, same configured limits. */
export function gitRunner() {
  return createGitRunner(subprocess, DEFAULT_CONFIG.timeoutMs, DEFAULT_CONFIG.maxBytes)
}
