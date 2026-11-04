/**
 * Menu path joins: the tree addresses entries relative to the browse root with
 * '/', the platform's file actions want an absolute path spelled the way the
 * root is.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { absPath, baseName, platformPathFor, revisionName } from '../../lib/testkit.mjs'

test('absPath joins a POSIX root and a relative path', () => {
  assert.equal(absPath('/work/repo', 'src/a.ts'), '/work/repo/src/a.ts')
  assert.equal(absPath('/work/repo', ''), '/work/repo')
})

test('absPath keeps the root separator style on Windows', () => {
  assert.equal(absPath('C:\\work\\repo', 'src/a.ts'), 'C:\\work\\repo\\src\\a.ts')
  assert.equal(absPath('C:\\work\\repo', 'src/a/b.ts'), 'C:\\work\\repo\\src\\a\\b.ts')
})

test('absPath does not double a trailing separator', () => {
  assert.equal(absPath('/work/repo/', 'src/a.ts'), '/work/repo/src/a.ts')
  assert.equal(absPath('C:\\work\\repo\\', 'src/a.ts'), 'C:\\work\\repo\\src\\a.ts')
})

test('absPath tolerates a leading ./ and repeated separators in the relative part', () => {
  assert.equal(absPath('/work', './src//a.ts'), '/work/src/a.ts')
  assert.equal(absPath('/work', '/src/a.ts'), '/work/src/a.ts')
})

test('absPath returns the relative path when no root is known', () => {
  assert.equal(absPath(null, 'src/a.ts'), 'src/a.ts')
  assert.equal(absPath('', 'src/a.ts'), 'src/a.ts')
})

test('absPath joins onto the filesystem root without doubling it', () => {
  assert.equal(absPath('/', 'src/a.ts'), '/src/a.ts')
})

test('baseName returns the last segment for both separator styles', () => {
  assert.equal(baseName('src/a.ts'), 'a.ts')
  assert.equal(baseName('C:\\work\\a.ts'), 'a.ts')
  assert.equal(baseName('a.ts'), 'a.ts')
  assert.equal(baseName('src/dir/'), '')
})

test('platformPathFor prefers the captured root over the panel browse root', () => {
  const value = { sessionId: 's', owner: 'o', repo: '', path: 'src/a.ts', root: '/nested/repo', ignored: false }
  assert.equal(platformPathFor(value, '/session/cwd'), '/nested/repo/src/a.ts')
  assert.equal(platformPathFor({ ...value, root: null }, '/session/cwd'), '/session/cwd/src/a.ts')
})

test('revisionName inserts the side label before the extension', () => {
  assert.equal(revisionName('src/logo.png', 'a1b2c3d'), 'logo@a1b2c3d.png')
  assert.equal(revisionName('C:\\art\\logo.svg', 'HEAD'), 'logo@HEAD.svg')
  // A dotfile has no extension to keep behind the suffix.
  assert.equal(revisionName('.env', 'HEAD'), '.env@HEAD')
  assert.equal(revisionName('src/Makefile', 'staged'), 'Makefile@staged')
})
