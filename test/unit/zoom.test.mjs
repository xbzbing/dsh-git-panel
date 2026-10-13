/**
 * Image-zoom math: wheel-delta normalization across browser delta modes, the
 * pinch→scale factor (including its round-trip symmetry), scale clamping, and
 * the cursor-anchored scroll correction.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWheel, wheelZoomFactor, clampScale, anchoredScroll, isDragGesture, panScroll, SCALE_MIN, SCALE_MAX, ZOOM_STEP, DELTA_CLAMP, DRAG_THRESHOLD } from '../../lib/testkit.mjs'

const wheel = (over = {}) => ({ deltaY: 0, deltaMode: 0, ...over })

test('normalizeWheel passes pixel deltas through and scales line/page modes', () => {
  assert.equal(normalizeWheel(wheel({ deltaY: -5 })), -5)
  assert.equal(normalizeWheel(wheel({ deltaY: 2, deltaMode: 1 })), 16)
  assert.equal(normalizeWheel(wheel({ deltaY: -1, deltaMode: 2 })), -24)
})

test('normalizeWheel clamps oversized pinch deltas', () => {
  assert.equal(normalizeWheel(wheel({ deltaY: -400 })), -DELTA_CLAMP)
  assert.equal(normalizeWheel(wheel({ deltaY: 500, deltaMode: 1 })), DELTA_CLAMP)
  assert.equal(normalizeWheel(wheel({ deltaY: 0 })), 0)
})

test('wheelZoomFactor: negative zooms in, positive zooms out, zero is neutral', () => {
  assert.equal(wheelZoomFactor(0), 1)
  // Pinned value: the e2e asserts a ctrl+wheel step lands on exactly 120%.
  assert.equal(wheelZoomFactor(-10), 1.2)
  assert.ok(wheelZoomFactor(10) < 1)
  assert.ok(wheelZoomFactor(-20) > wheelZoomFactor(-10))
})

test('wheelZoomFactor is round-trip symmetric: out-N undoes in-N', () => {
  for (const d of [1, 5, 10, DELTA_CLAMP]) {
    assert.ok(Math.abs(wheelZoomFactor(-d) * wheelZoomFactor(d) - 1) < 1e-12)
  }
})

test('wheelZoomFactor clamps huge deltas to the same bounded step', () => {
  assert.equal(wheelZoomFactor(-999), wheelZoomFactor(-DELTA_CLAMP))
})

test('clampScale keeps the zoom within the documented range', () => {
  // Bounds pinned to their literals so a constant change cannot move them silently.
  assert.equal(SCALE_MIN, 0.1)
  assert.equal(SCALE_MAX, 8)
  assert.equal(clampScale(0), 0.1)
  assert.equal(clampScale(-3), 0.1)
  assert.equal(clampScale(1e9), 8)
  assert.equal(clampScale(2.5), 2.5)
  assert.equal(clampScale(NaN), 1)
  assert.equal(clampScale(Infinity), 1)
})

test('anchoredScroll keeps the content point under the cursor fixed', () => {
  // Content point at scroll+cursor = 150; after ×2 it renders at 300, so the
  // scroll that re-places it under the same screen point is 250.
  assert.equal(anchoredScroll(100, 50, 2), 250)
  assert.equal(anchoredScroll(0, 0, 3), 0)
  // Zooming back out restores the original offset exactly.
  assert.equal(anchoredScroll(anchoredScroll(100, 50, 2), 50, 0.5), 100)
})

test('the toolbar step and the line-delta multiplier are pinned', () => {
  assert.equal(ZOOM_STEP, 1.25)
  // deltaMode line = one wheel tick, scaled to 8px before clamping.
  assert.equal(normalizeWheel(wheel({ deltaY: 1, deltaMode: 1 })), 8)
  assert.equal(DRAG_THRESHOLD, 3)
})

test('isDragGesture only turns a press into a drag past the threshold', () => {
  assert.equal(isDragGesture(0, 0), false)
  assert.equal(isDragGesture(DRAG_THRESHOLD - 1, 0), false)
  assert.equal(isDragGesture(DRAG_THRESHOLD - 1, 0.5), false)
  // Travel is measured as a distance, not per axis: a diagonal 2,2 is 2.83px.
  assert.equal(isDragGesture(DRAG_THRESHOLD - 1, DRAG_THRESHOLD - 1), false)
  assert.equal(isDragGesture(DRAG_THRESHOLD, 0), true)
  assert.equal(isDragGesture(2, 3), true)
  assert.equal(isDragGesture(-DRAG_THRESHOLD, 0), true)
})

test('panScroll moves the content with the pointer', () => {
  // Dragging right/down by (+40, +25) reveals the content at the left/top.
  assert.deepEqual(panScroll(200, 150, 40, 25), { left: 160, top: 125 })
  // Dragging left/up goes the other way; a zero drag changes nothing.
  assert.deepEqual(panScroll(0, 0, -60, -30), { left: 60, top: 30 })
  assert.deepEqual(panScroll(120, 90, 0, 0), { left: 120, top: 90 })
})
