/**
 * File-tree tests: flat paths → nested tree with single-child collapse.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFileTree } from '../lib/testkit.mjs'

test('nests files under directories, dirs before files, sorted', () => {
  const tree = buildFileTree([
    { path: 'src/z.ts', meta: 'modified' },
    { path: 'src/a.ts', meta: 'added' },
    { path: 'readme.md', meta: 'modified' },
  ])
  // top level: src (dir) before readme.md (file)
  assert.equal(tree[0].dir, true)
  assert.equal(tree[0].name, 'src')
  assert.equal(tree[1].name, 'readme.md')
  // src children sorted a before z
  assert.equal(tree[0].children[0].name, 'a.ts')
  assert.equal(tree[0].children[1].name, 'z.ts')
  // leaf carries meta passthrough
  assert.equal(tree[0].children[0].meta, 'added')
})

test('collapses a single-child directory chain into a/b', () => {
  const tree = buildFileTree([{ path: 'a/b/c/file.ts', meta: 'added' }])
  assert.equal(tree[0].dir, true)
  assert.equal(tree[0].name, 'a/b/c')
  assert.equal(tree[0].children[0].name, 'file.ts')
})
