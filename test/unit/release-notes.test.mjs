/**
 * Release notes are a contract, not free prose. A stable release ships its body
 * in `docs/releases/<tag>.md`, written from `.github/RELEASE_TEMPLATE.md` and
 * read by the release workflow instead of retyped at publish time; a pre-release
 * ships the fixed notice in `.github/PRERELEASE_BODY.md` and keeps no change log
 * at all. This test keeps those files honest — a stable body missing the English
 * half, the verification section or the compare link, a pre-release file that
 * crept into `docs/releases/`, or a notice that records changes, is caught here
 * rather than on the release page.
 *
 * The template and the notice are checked too, so neither format source can
 * drift away from the shape the published pages are validated against.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../../', import.meta.url)
const TEMPLATE = fileURLToPath(new URL('.github/RELEASE_TEMPLATE.md', ROOT))
const NOTICE = fileURLToPath(new URL('.github/PRERELEASE_BODY.md', ROOT))
const NOTES_DIR = fileURLToPath(new URL('docs/releases/', ROOT))

/** Headings every stable body must carry, in both languages. */
const REQUIRED_HEADINGS = ['## 主要变更', '## 安装', '## 验证', '## English', '## Install', '## Verification']

/** The compare link that closes each language half. */
const COMPARE_URL = /https:\/\/github\.com\/xbzbing\/dsh-git-panel\/compare\/\S+/

/** The same link with real tags: the template shows placeholders, notes do not. */
const COMPARE_LINK = /https:\/\/github\.com\/xbzbing\/dsh-git-panel\/compare\/v[0-9.]+\S*v[0-9.]+/

/** `<PREV>...<TAG>` with both tags captured. */
const COMPARE_TAGS = /https:\/\/github\.com\/xbzbing\/dsh-git-panel\/compare\/(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.\.\.(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/

/** `docs/releases/` records stable versions only — no `-prerelease` suffix. */
const NOTES_FILE = /^v\d+\.\d+\.\d+\.md$/

/** A pre-release tag carries a `-`: those are never published to npm. */
const PRERELEASE_TAG = /^v\d+\.\d+\.\d+-/

/** `dsh plugin --profile web add @xbzbing/dsh-git-panel@latest`. */
const NPM_INSTALL = /dsh plugin --profile web add @xbzbing\/dsh-git-panel@/

/** A GitHub Release asset URL, capturing the tag it points at. */
const ASSET_INSTALL = /releases\/download\/(v\S+?)\/xbzbing-dsh-git-panel-\S+\.tgz/

/** A change entry: every bullet in `主要变更` / `English` ends with an issue link. */
const CHANGELOG_ENTRY = /（#\d+）|\(#\d+\)/

test('the release template carries the shape the notes are validated against', () => {
  assert.ok(existsSync(TEMPLATE), '.github/RELEASE_TEMPLATE.md is the format source')
  const template = readFileSync(TEMPLATE, 'utf8')
  for (const heading of REQUIRED_HEADINGS) {
    assert.ok(template.includes(heading), `the template must show ${heading}`)
  }
  assert.match(template, COMPARE_URL, 'the template must show the compare link')
  assert.match(template, NPM_INSTALL, 'the template must show the npm install')
  assert.match(template, /releases\/download\/<TAG>/, 'the template must show the asset install')
  // The template must send pre-releases to the fixed notice instead of a body.
  assert.match(template, /PRERELEASE_BODY\.md/, 'the template must point pre-releases at the notice')
  // A release page installs the version it documents, so the npm line takes a
  // version placeholder rather than `@latest` (which would drift to a later
  // tarball and contradict the tag and the asset on the same page).
  assert.doesNotMatch(template, /@xbzbing\/dsh-git-panel@latest/, 'the template must not install `@latest`')
  assert.match(template, /@xbzbing\/dsh-git-panel@<VERSION>/, 'the template must pin the npm install to the version')
})

test('the body of the shipped version pins that exact version on npm', () => {
  const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', ROOT)), 'utf8'))
  const body = new URL(`docs/releases/v${version}.md`, ROOT)
  // A pre-release has no body: its page is the notice, and its install is the
  // asset alone. A *stable* version without one would silently pass this check
  // (and only the release workflow would notice, after the gate), so the file is
  // required for it.
  if (/-/.test(version)) {
    assert.equal(existsSync(body), false, `docs/releases/v${version}.md must not exist for a prerelease`)
    return
  }
  assert.equal(existsSync(body), true, `docs/releases/v${version}.md is missing for the stable version ${version}`)
  const text = readFileSync(body, 'utf8')
  assert.ok(
    text.includes(`@xbzbing/dsh-git-panel@${version}`),
    `docs/releases/v${version}.md must install @xbzbing/dsh-git-panel@${version}, not a floating tag`,
  )
  assert.doesNotMatch(text, /@xbzbing\/dsh-git-panel@latest/, `docs/releases/v${version}.md must not install @latest`)
})

test('every committed release body follows the template', () => {
  const files = existsSync(NOTES_DIR) ? readdirSync(NOTES_DIR).filter((name) => name.endsWith('.md')) : []
  for (const name of files) {
    // A pre-release keeps no body: its page is the fixed notice, and its
    // changes are recorded once in the stable release that follows.
    assert.match(name, NOTES_FILE, `docs/releases/${name} must be a stable version (pre-release bodies are not kept)`)
    const body = readFileSync(new URL(`docs/releases/${name}`, ROOT), 'utf8')
    for (const heading of REQUIRED_HEADINGS) {
      assert.ok(body.includes(heading), `docs/releases/${name} is missing ${heading}`)
    }
    assert.match(body, COMPARE_LINK, `docs/releases/${name} must link the previous tag`)
    const separator = body.indexOf('\n---\n')
    assert.ok(separator > 0, `docs/releases/${name} must separate the Chinese and English halves with ---`)
    assert.ok(body.indexOf('## English') > separator, `docs/releases/${name} must put English after the separator`)

    // The tag this body documents is its file name.
    const tag = name.replace(/\.md$/, '')

    // A stable release is on npm, and its asset URL points at its own tag.
    assert.match(body, NPM_INSTALL, `docs/releases/${name} must offer the npm install`)
    const assets = [...body.matchAll(new RegExp(ASSET_INSTALL, 'g'))].map((m) => m[1])
    assert.ok(assets.length > 0, `docs/releases/${name} must offer the GitHub Release asset`)
    assert.deepEqual([...new Set(assets)], [tag], `docs/releases/${name} must link its own tag's asset`)
    assert.match(body, /^- \*\*/m, `docs/releases/${name} must record its changes`)

    // Changelog baseline: compare against the previous *stable* tag, so the
    // notes cover everything since users' last stable version — never just the
    // delta from an rc / alpha of the same version.
    for (const match of body.matchAll(new RegExp(COMPARE_TAGS, 'g'))) {
      const [, prev, target] = match
      assert.equal(target, tag, `docs/releases/${name} must compare up to ${tag}`)
      assert.notEqual(prev, tag, `docs/releases/${name} must compare against an earlier tag`)
      assert.doesNotMatch(prev, PRERELEASE_TAG, `docs/releases/${name} is stable and must compare against the previous stable tag, not ${prev}`)
    }
  }
})

test('the pre-release notice is bilingual, records no changes, and never advertises npm', () => {
  assert.ok(existsSync(NOTICE), '.github/PRERELEASE_BODY.md is the pre-release body')
  const notice = readFileSync(NOTICE, 'utf8')
  assert.ok(notice.includes('## 预发布'), 'the notice must open with the Chinese pre-release section')
  assert.ok(notice.includes('## Pre-release'), 'the notice must carry the English pre-release section')
  assert.ok(notice.indexOf('\n---\n') > 0, 'the notice must separate the Chinese and English halves with ---')
  // The workflow fills these in, so the page installs the asset of this tag.
  assert.ok(notice.includes('<TAG>') && notice.includes('<VERSION>'), 'the notice must keep the <TAG> / <VERSION> placeholders')
  assert.match(notice, /releases\/download\/<TAG>/, 'the notice must install from the GitHub Release asset')
  assert.doesNotMatch(notice, NPM_INSTALL, 'a pre-release is never on npm and must not advertise it')
  assert.doesNotMatch(notice, CHANGELOG_ENTRY, 'a pre-release records no changes; they belong to the following stable release')
})
