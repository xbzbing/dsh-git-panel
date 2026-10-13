/**
 * Image-zoom math: wheel-delta normalization across browser delta modes, the
 * pinch→scale factor (including its round-trip symmetry), scale clamping, and
 * the cursor-anchored scroll correction.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWheel, wheelZoomFactor, clampScale, anchoredScroll, SCALE_MIN, SCALE_MAX, ZOOM_STEP, DELTA_CLAMP } from '../../lib/testkit.mjs'

const wheel = (over = {}) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, ...over })

test('normalizeWheel passes pixel deltas through and scales line/page modes', () => {
  assert.deepEqual(normalizeWheel(wheel({ deltaY: -5 })), [0, -5])
  assert.deepEqual(normalizeWheel(wheel({ deltaY: 2, deltaMode: 1 })), [0, 16])
  assert.deepEqual(normalizeWheel(wheel({ deltaY: -1, deltaMode: 2 })), [0, -24])
})

test('normalizeWheel swaps a shift-only vertical delta to the horizontal axis', () => {
  assert.deepEqual(normalizeWheel(wheel({ deltaY: 7, shiftKey: true })), [7, 0])
  // With a real horizontal delta the swap must not fire.
  assert.deepEqual(normalizeWheel(wheel({ deltaX: 3, deltaY: 7, shiftKey: true })), [3, 7])
})

test('normalizeWheel clamps oversized pinch deltas', () => {
  assert.deepEqual(normalizeWheel(wheel({ deltaY: -400 }))[1], -DELTA_CLAMP)
  assert.deepEqual(normalizeWheel(wheel({ deltaY: 500, deltaMode: 1 }))[1], DELTA_CLAMP)
})

test('wheelZoomFactor: negative zooms in, positive zooms out, zero is neutral', () => {
  assert.equal(wheelZoomFactor(0), 1)
  assert.ok(wheelZoomFactor(-10) > 1)
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
  assert.equal(clampScale(0), SCALE_MIN)
  assert.equal(clampScale(-3), SCALE_MIN)
  assert.equal(clampScale(1e9), SCALE_MAX)
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

test('ZOOM_STEP is a multiplicative toolbar step above 1', () => {
  assert.ok(ZOOM_STEP > 1)
  assert.ok(SCALE_MIN < 1 && SCALE_MAX > 1)
})
