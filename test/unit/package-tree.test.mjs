/**
 * Package-tree helpers: source-root recognition, the projection of a `src`
 * skeleton into source-root rows, and segment validation. Pure functions — the
 * host query's readdir/containment wiring is covered by host-integration.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sourceRootOf,
  isPackageSegment,
  projectSourceRoots,
  MAX_PROJECTED_ROOTS,
} from '../../lib/testkit.mjs'

test('sourceRootOf recognises conventional source roots at any depth', () => {
  assert.equal(sourceRootOf(''), null)
  assert.equal(sourceRootOf('src'), null)
  assert.equal(sourceRootOf('com/example'), null)
  assert.equal(sourceRootOf('src/main/java'), 'src/main/java')
  assert.equal(sourceRootOf('module-a/src/main/java'), 'module-a/src/main/java')
  assert.equal(sourceRootOf('module-a/src/main/kotlin/com/example'), 'module-a/src/main/kotlin')
  assert.equal(sourceRootOf('src/test/java/com/example/demo'), 'src/test/java')
  assert.equal(sourceRootOf('src/androidTest/kotlin/com/example'), 'src/androidTest/kotlin')
  assert.equal(sourceRootOf('src/main/resources'), null, 'resources is not a package root')
  assert.equal(sourceRootOf('src/resources/java'), null, 'the tail must match as a whole')
})

test('sourceRootOf picks the innermost root of a nested layout', () => {
  assert.equal(
    sourceRootOf('gen/src/main/java/com/x/src/main/java/com/y'),
    'gen/src/main/java/com/x/src/main/java',
  )
})

test('isPackageSegment accepts Java identifiers and rejects shell-ish names', () => {
  assert.equal(isPackageSegment('com'), true)
  assert.equal(isPackageSegment('$Proxy'), true)
  assert.equal(isPackageSegment('_impl'), true)
  assert.equal(isPackageSegment('中文包'), true)
  assert.equal(isPackageSegment('foo-bar'), false)
  assert.equal(isPackageSegment('1abc'), false)
  assert.equal(isPackageSegment(''), false)
  assert.equal(isPackageSegment('a/b'), false)
})

test('projectSourceRoots lifts main/test children out of src', () => {
  const roots = projectSourceRoots(
    ['main', 'test'],
    new Map([['main', ['java', 'resources']], ['test', ['java']]]),
  )
  assert.deepEqual(roots, ['src/main/java', 'src/main/resources', 'src/test/java'])
})

test('projectSourceRoots keeps a plain src child and an empty source set', () => {
  const roots = projectSourceRoots(['main', 'assets', 'test'], new Map([['main', []], ['test', ['java']]]))
  assert.deepEqual(roots, ['src/main', 'src/assets', 'src/test/java'])
})

test('projectSourceRoots refuses a lookalike layout with no real source root', () => {
  // `src/main/js` is a common web layout, not a JVM source set: hiding `src`
  // and `main` there would be wording the physical tree does not support.
  assert.equal(projectSourceRoots(['main'], new Map([['main', ['js']]])), null)
  assert.equal(projectSourceRoots(['assets'], new Map()), null)
  assert.equal(projectSourceRoots([], new Map()), null)
})

test('projectSourceRoots refuses a projection over the cap instead of truncating', () => {
  const wide = Array.from({ length: MAX_PROJECTED_ROOTS + 1 }, (_, index) => `p${index}`)
  assert.equal(projectSourceRoots(['main'], new Map([['main', wide]])), null)
})
