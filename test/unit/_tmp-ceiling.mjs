/**
 * Side-effect import for suites that build git fixtures under the temp dir.
 *
 * The temp dir may itself sit inside a checkout (a sandbox whose only writable
 * temp dir is in the work tree). GIT_CEILING_DIRECTORIES stops git's repository
 * discovery at the temp dir, so a fixture that is meant to be no repository
 * never resolves to the enclosing one. Child git processes inherit it.
 */
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter } from 'node:path'

process.env.GIT_CEILING_DIRECTORIES = [...new Set([tmpdir(), realpathSync(tmpdir())])].join(delimiter)
