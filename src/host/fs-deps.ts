/**
 * Filesystem face of `SnapshotDeps`, built in one place so the host service and
 * the unit-test harness consume the same wiring: a mirrored copy can silently
 * drift from production, and a drifted harness then asserts the wrong behavior.
 */
import { lstat, readdir, readFile, readlink, realpath, rm, stat } from 'node:fs/promises'
import type { SnapshotDeps } from './core.js'

export function createFsDeps(): SnapshotDeps['fs'] {
  return {
    realpath, stat: async (p) => stat(p), lstat: async (p) => lstat(p), readFile,
    symlinkTarget: async (p) => {
      // A missing path or a non-link is `null`, not an error: the caller falls
      // back to reading the file itself.
      try { return (await lstat(p)).isSymbolicLink() ? await readlink(p) : null } catch { return null }
    },
    readdir: async (p) => (await readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
    // Untracked entries include whole directories (porcelain collapses `?? dir/`
    // into one entry) and a plain `rm` fails EISDIR on them; the caller
    // realpath-contains every target inside the repo root before removing.
    remove: async (p) => { await rm(p, { recursive: true, force: true }) },
  }
}
