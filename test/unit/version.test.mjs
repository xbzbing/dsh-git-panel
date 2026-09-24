/**
 * Version-check unit tests: semver comparison, repository URL parsing, and the
 * GitHub-release check with a mocked fetch (no network).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareVersions, parseRepository, readVersionInfo, checkLatestVersion } from '../../lib/host/index.js'

test('compareVersions orders core and prerelease correctly', () => {
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1)
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1)
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('v0.2.0', '0.2.0'), 0)
  // a release outranks a prerelease sharing the same core
  assert.equal(compareVersions('0.2.0', '0.2.0-beta.1'), 1)
  assert.equal(compareVersions('0.2.0-beta.1', '0.2.0'), -1)
})

test('parseRepository extracts owner/repo from the common forms', () => {
  assert.deepEqual(parseRepository('git+https://github.com/xbzbing/dsh-git-panel.git'), { owner: 'xbzbing', repo: 'dsh-git-panel' })
  assert.deepEqual(parseRepository({ url: 'git@github.com:foo/bar.git' }), { owner: 'foo', repo: 'bar' })
  assert.deepEqual(parseRepository('github:foo/bar'), { owner: 'foo', repo: 'bar' })
  assert.deepEqual(parseRepository('foo/bar'), { owner: 'foo', repo: 'bar' })
  assert.equal(parseRepository(undefined), undefined)
})

function writeManifest(version, repository) {
  const dir = mkdtempSync(join(tmpdir(), 'gp-ver-'))
  const path = join(dir, 'package.json')
  writeFileSync(path, JSON.stringify({ version, ...(repository ? { repository } : {}) }))
  return { dir, path }
}

test('readVersionInfo reads the local version + repository URL, no network', async () => {
  const { dir, path } = writeManifest('0.1.0', 'git+https://github.com/xbzbing/dsh-git-panel.git')
  try {
    const info = await readVersionInfo({ manifestPath: path })
    assert.equal(info.current, '0.1.0')
    assert.equal(info.repositoryUrl, 'https://github.com/xbzbing/dsh-git-panel')
    assert.equal(info.checkedRemote, false)
    assert.equal(info.updateAvailable, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('checkLatestVersion flags a newer remote release via mocked fetch', async () => {
  const { dir, path } = writeManifest('0.1.0', 'git+https://github.com/xbzbing/dsh-git-panel.git')
  try {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v0.2.0', html_url: 'https://github.com/xbzbing/dsh-git-panel/releases/tag/v0.2.0' }),
    })
    const info = await checkLatestVersion({ manifestPath: path, fetchFn })
    assert.equal(info.checkedRemote, true)
    assert.equal(info.latest, '0.2.0')
    assert.equal(info.updateAvailable, true)
    assert.equal(info.releaseUrl, 'https://github.com/xbzbing/dsh-git-panel/releases/tag/v0.2.0')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('checkLatestVersion reports up-to-date when tags match', async () => {
  const { dir, path } = writeManifest('0.2.0', 'git+https://github.com/xbzbing/dsh-git-panel.git')
  try {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v0.2.0' }) })
    const info = await checkLatestVersion({ manifestPath: path, fetchFn })
    assert.equal(info.updateAvailable, false)
    assert.equal(info.latest, '0.2.0')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('checkLatestVersion surfaces a network failure through error', async () => {
  const { dir, path } = writeManifest('0.1.0', 'git+https://github.com/xbzbing/dsh-git-panel.git')
  try {
    const fetchFn = async () => { throw new Error('offline') }
    const info = await checkLatestVersion({ manifestPath: path, fetchFn })
    assert.equal(info.checkedRemote, true)
    assert.equal(info.error, 'offline')
    assert.equal(info.current, '0.1.0')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('checkLatestVersion reports missing repository config', async () => {
  const { dir, path } = writeManifest('0.1.0')
  try {
    const info = await checkLatestVersion({ manifestPath: path, fetchFn: async () => { throw new Error('should not be called') } })
    assert.equal(info.checkedRemote, false)
    assert.equal(info.error, 'repository is not configured')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
