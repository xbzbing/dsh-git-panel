/**
 * Hover-tip fitting: the bubble is portaled to the body, so its width and
 * anchor are clamped to the panel that owns the control. Pure math — the hook's
 * DOM wiring is covered by the browser suites.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fitTipWidth,
  fitTipLeft,
  TIP_MIN_WIDTH,
  TIP_MARGIN,
} from '../../lib/testkit.mjs'

test('fitTipWidth keeps the preferred width when the panel has room', () => {
  assert.equal(fitTipWidth(120, { left: 0, right: 400 }), 120)
})

test('fitTipWidth caps a long tip to the panel with both margins', () => {
  assert.equal(fitTipWidth(260, { left: 0, right: 273 }), 273 - TIP_MARGIN * 2)
  assert.equal(fitTipWidth(260, { left: 0, right: 200 }), 184)
})

test('fitTipWidth keeps the usable minimum on a very narrow panel', () => {
  assert.equal(fitTipWidth(260, { left: 0, right: 90 }), TIP_MIN_WIDTH)
})

test('fitTipLeft leaves a left-anchored tip at the panel padding', () => {
  assert.equal(fitTipLeft(8, 200, { left: 0, right: 300 }, false), 8)
  assert.equal(fitTipLeft(0, 100, { left: 0, right: 300 }, false), TIP_MARGIN)
})

test('fitTipLeft shifts a tip anchored near the right edge back inside', () => {
  assert.equal(fitTipLeft(250, 260, { left: 0, right: 300 }, false), 32)
})

test('fitTipLeft keeps a centred tip inside both edges', () => {
  assert.equal(fitTipLeft(150, 200, { left: 0, right: 300 }, true), 150)
  assert.equal(fitTipLeft(10, 200, { left: 0, right: 300 }, true), 108)
  assert.equal(fitTipLeft(290, 200, { left: 0, right: 300 }, true), 192)
})

test('the fitted width and anchor keep the whole bubble inside the panel', () => {
  const bounds = { left: 0, right: 273 }
  const width = fitTipWidth(260, bounds)
  const left = fitTipLeft(250, width, bounds, false)
  assert.ok(left >= bounds.left + TIP_MARGIN)
  assert.ok(left + width <= bounds.right - TIP_MARGIN)
})
