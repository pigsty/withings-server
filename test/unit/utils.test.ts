import assert from "node:assert/strict";
import test from "node:test";
import { measurementTypeLabel, normalizeValue, toScaleShortName } from "../../src/utils.ts";

test("measurementTypeLabel: known and unknown labels", () => {
  assert.equal(measurementTypeLabel(1), "weight");
  assert.equal(measurementTypeLabel(16), "re");
  assert.equal(measurementTypeLabel(999), "unknown");
});

test("normalizeValue: applies exponent scaling", () => {
  assert.equal(normalizeValue(7500, -2), 75);
  assert.equal(normalizeValue(123, 1), 1230);
  assert.equal(normalizeValue(1, 0), 1);
});

test("toScaleShortName: empty, single-word, and multi-word handling", () => {
  assert.equal(toScaleShortName("   "), "US");
  assert.equal(toScaleShortName("alex"), "AL");
  assert.equal(toScaleShortName("Test User"), "TU");
});
