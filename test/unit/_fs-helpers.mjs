/**
 * Filesystem helpers shared by the unit suites.
 *
 * `linkOrSkip` lives here rather than in one test file: every suite that needs a
 * symlink must treat "this platform refuses symlinks" the same way, and a
 * hand-written `try { symlink } catch { skip }` silently turns a security
 * assertion into a skip on any error — including one that means the fixture
 * itself is wrong.
 */
import { symlinkSync } from 'node:fs'

/**
 * Create a symlink, or skip the calling test where the platform refuses one.
 * Windows only lets privileged tokens (admin, Developer Mode) create symlinks;
 * elsewhere the call fails with EPERM. `kind === 'dir'` becomes a junction
 * there, which needs no privilege and resolves the same way; `dangling-dir` (a
 * directory link whose target is missing) stays a symlink.
 *
 * @returns false when the test was skipped.
 */
export function linkOrSkip(t, target, path, kind = 'file') {
  const type = kind === 'dangling-dir' ? 'dir' : kind === 'dir' && process.platform === 'win32' ? 'junction' : kind
  try {
    symlinkSync(target, path, type)
    return true
  } catch (error) {
    // Only the platform refusing symlinks is a reason to skip; anything else
    // (EEXIST, a missing parent, …) means the fixture is broken and must fail.
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error
    t.skip('symlinks are unavailable here: ' + error.code)
    return false
  }
}
