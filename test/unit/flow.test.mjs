/**
 * Git Flow's pure decisions: which flow a branch belongs to, which long-lived
 * branch it starts on and lands in, which menu entries are offered, and the
 * default tag a finished release / hotfix proposes. No renderer involved.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectFlowBranch, flowBranchName, defaultTagName, flowBases, flowMainlines, finishTarget, finishTargets, startBase,
  flowMenuItems, nextFlowVersion, parseFlowVersion,
} from '../../lib/testkit.mjs'

const BRANCHES = ['main', 'develop', 'feature/login', 'release/1.2.0']

test('a branch belongs to a flow by its prefix', () => {
  assert.deepEqual(detectFlowBranch('feature/login'), { kind: 'feature', name: 'login' })
  assert.deepEqual(detectFlowBranch('hotfix/1.2.1'), { kind: 'hotfix', name: '1.2.1' })
  assert.deepEqual(detectFlowBranch('release/1.2.0'), { kind: 'release', name: '1.2.0' })
})

test('plain and prefix-only names belong to no flow', () => {
  assert.equal(detectFlowBranch(null), null)
  assert.equal(detectFlowBranch('main'), null)
  assert.equal(detectFlowBranch('feature/'), null)
  assert.equal(detectFlowBranch('feat/login'), null)
})

test('a flow name is folded into its full branch', () => {
  assert.equal(flowBranchName('feature', 'login'), 'feature/login')
  assert.equal(flowBranchName('hotfix', ' 1.2.1 '), 'hotfix/1.2.1')
})

test('unsafe names are refused before they reach the wire', () => {
  for (const bad of ['', '   ', 'a b', 'a..b', '-x', '/x', 'x/', 'x.lock', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'a@{b']) {
    assert.equal(flowBranchName('feature', bad), null, `must refuse ${JSON.stringify(bad)}`)
  }
  assert.equal(flowBranchName('feature', '修复/登录'), 'feature/修复/登录')
})

test('bases resolve main, master and develop', () => {
  assert.deepEqual(flowBases(['main', 'develop'], null), { develop: 'develop', main: 'main' })
  assert.deepEqual(flowBases(['master', 'develop'], null), { develop: 'develop', main: 'master' })
  assert.deepEqual(flowBases(['trunk'], 'trunk'), { develop: null, main: 'trunk' })
  assert.deepEqual(flowBases(['main'], null), { develop: null, main: 'main' })
  assert.deepEqual(flowBases([], null), { develop: null, main: null })
})

test('the host default decides between main and master when both exist', () => {
  assert.deepEqual(flowBases(['main', 'master'], 'master'), { develop: null, main: 'master' })
  assert.deepEqual(flowBases(['main', 'master'], 'main'), { develop: null, main: 'main' })
  assert.deepEqual(flowBases(['main', 'master'], null), { develop: null, main: 'main' }, 'main first without a default')
})

test('every main-line branch present can start a hotfix', () => {
  assert.deepEqual(flowMainlines(['main', 'master', 'develop'], 'main'), ['main', 'master'])
  assert.deepEqual(flowMainlines(['master', 'develop'], 'master'), ['master'])
  assert.deepEqual(flowMainlines(['trunk', 'develop'], 'trunk'), ['trunk'], 'a non-standard default is a main line too')
  assert.deepEqual(flowMainlines(['develop'], null), [])
})

test('a feature starts on develop, or on main when develop is not created yet', () => {
  assert.equal(startBase('feature', { develop: 'develop', main: 'main' }), 'develop')
  assert.equal(startBase('feature', { develop: null, main: 'main' }), 'main')
  assert.equal(startBase('feature', { develop: null, main: null }), null)
  assert.equal(startBase('release', { develop: null, main: 'main' }), null)
  assert.equal(startBase('hotfix', { develop: 'develop', main: 'main' }), 'main')
})

test('a release and a hotfix land on the main line, a feature on develop', () => {
  assert.equal(finishTarget('hotfix', { develop: 'develop', main: 'main' }), 'main')
  assert.equal(finishTarget('feature', { develop: 'develop', main: 'main' }), 'develop')
  assert.equal(finishTarget('release', { develop: 'develop', main: 'main' }), 'main')
  assert.equal(finishTarget('feature', { develop: null, main: 'main' }), null)
})

test('only a hotfix chooses its target among the main lines', () => {
  const both = ['main', 'master']
  assert.deepEqual(finishTargets('feature', { develop: 'develop', main: 'main' }, both), {
    options: ['develop'], selected: 'develop', editable: false, backMerge: [],
  })
  assert.deepEqual(finishTargets('release', { develop: 'develop', main: 'main' }, both), {
    options: ['main'], selected: 'main', editable: false, backMerge: ['develop'],
  })
  // The remote's default line is preselected, and both stay selectable.
  assert.deepEqual(finishTargets('hotfix', { develop: 'develop', main: 'master' }, both), {
    options: ['main', 'master'], selected: 'master', editable: true, backMerge: ['develop'],
  })
  assert.deepEqual(finishTargets('hotfix', { develop: 'develop', main: 'main' }, both), {
    options: ['main', 'master'], selected: 'main', editable: true, backMerge: ['develop'],
  })
})

test('a lone main line is still shown for a hotfix, but it is no choice', () => {
  assert.deepEqual(finishTargets('hotfix', { develop: 'develop', main: 'main' }, ['main']), {
    options: ['main'], selected: 'main', editable: false, backMerge: ['develop'],
  })
  assert.equal(finishTargets('hotfix', { develop: 'develop', main: null }, []), null)
  assert.equal(finishTargets('release', { develop: null, main: 'main' }, ['main']), null, 'a release needs develop to merge back into')
})

test('finish entries exist only on the matching current branch', () => {
  const onFeature = flowMenuItems({ current: 'feature/login', local: BRANCHES, defaultBranch: 'main' })
  const byId = Object.fromEntries(onFeature.map((item) => [item.id, item.disabled]))
  assert.equal(byId['finish-feature'], false)
  assert.equal(byId['finish-hotfix'], true)
  assert.equal(byId['finish-release'], true)
  assert.equal(byId['start-feature'], false)
  assert.equal(byId['integrate-develop'], false)

  const onHotfix = Object.fromEntries(flowMenuItems({ current: 'hotfix/1.2.1', local: [...BRANCHES, 'hotfix/1.2.1'], defaultBranch: 'main' }).map((item) => [item.id, item.disabled]))
  assert.equal(onHotfix['finish-hotfix'], false)
  assert.equal(onHotfix['finish-feature'], true)

  const onRelease = Object.fromEntries(flowMenuItems({ current: 'release/1.2.0', local: BRANCHES, defaultBranch: 'main' }).map((item) => [item.id, item.disabled]))
  assert.equal(onRelease['finish-release'], false)
})

test('the menu groups the three flows and separates them', () => {
  const items = flowMenuItems({ current: 'main', local: BRANCHES, defaultBranch: 'main' })
  assert.deepEqual(items.map((item) => item.id), [
    'start-feature', 'integrate-develop', 'finish-feature',
    'start-hotfix', 'finish-hotfix',
    'start-release', 'finish-release',
  ])
  assert.deepEqual(items.map((item) => item.group), [0, 0, 0, 1, 1, 2, 2])
})

test('integrate is offered only while a feature branch is checked out', () => {
  for (const current of ['main', 'develop', 'release/1.2.0', 'hotfix/1.2.1', null]) {
    const items = Object.fromEntries(flowMenuItems({ current, local: BRANCHES, defaultBranch: 'main' }).map((item) => [item.id, item.disabled]))
    assert.equal(items['integrate-develop'], true, `current=${current}`)
  }
  const onFeature = Object.fromEntries(flowMenuItems({ current: 'feature/login', local: BRANCHES, defaultBranch: 'main' }).map((item) => [item.id, item.disabled]))
  assert.equal(onFeature['integrate-develop'], false)
})

test('busy disables every entry', () => {
  const items = flowMenuItems({ current: 'feature/login', local: BRANCHES, defaultBranch: 'main', busy: true })
  assert.ok(items.every((item) => item.disabled))
})

test('without develop, feature start still works but release and integrate do not', () => {
  const items = Object.fromEntries(flowMenuItems({ current: 'main', local: ['main'], defaultBranch: 'main' }).map((item) => [item.id, item.disabled]))
  assert.equal(items['start-feature'], false)
  assert.equal(items['start-release'], true)
  assert.equal(items['integrate-develop'], true)
})

test('release and hotfix propose their branch suffix as the tag', () => {
  assert.equal(defaultTagName('release/1.2.0'), '1.2.0')
  assert.equal(defaultTagName('hotfix/1.2.1'), '1.2.1')
  assert.equal(defaultTagName('feature/login'), 'login')
})

test('a version tag is parsed with its v and padded parts', () => {
  assert.deepEqual(parseFlowVersion('v1.4.2'), { prefix: 'v', major: 1, minor: 4, patch: 2 })
  assert.deepEqual(parseFlowVersion('2'), { prefix: '', major: 2, minor: 0, patch: 0 })
  assert.deepEqual(parseFlowVersion('v2.1'), { prefix: 'v', major: 2, minor: 1, patch: 0 })
  assert.deepEqual(parseFlowVersion('v1.2.3-rc.1'), { prefix: 'v', major: 1, minor: 2, patch: 3 })
  assert.equal(parseFlowVersion('latest'), null)
  assert.equal(parseFlowVersion('release-1.2.3'), null)
})

test('a release bumps the minor and zeroes the patch, keeping the v', () => {
  assert.equal(nextFlowVersion('release', ['v1.4.2']), 'v1.5.0')
  assert.equal(nextFlowVersion('release', ['1.4.2']), '1.5.0')
  assert.equal(nextFlowVersion('release', ['V0.9.9', 'V1.0.0']), 'V1.1.0')
})

test('a hotfix bumps the patch', () => {
  assert.equal(nextFlowVersion('hotfix', ['v1.4.2']), 'v1.4.3')
  assert.equal(nextFlowVersion('hotfix', ['V2']), 'V2.0.1')
})

test('the highest version wins numerically, not by tag order', () => {
  assert.equal(nextFlowVersion('hotfix', ['v1.2.9', 'v1.2.10']), 'v1.2.11')
  assert.equal(nextFlowVersion('release', ['v1.0.0', 'v0.9.9']), 'v1.1.0')
})

test('no version tag means no suggestion', () => {
  assert.equal(nextFlowVersion('release', []), null)
  assert.equal(nextFlowVersion('release', ['latest', 'build-7']), null)
  assert.equal(nextFlowVersion('hotfix', ['v1.2.3-rc.1']), 'v1.2.4')
})
