import assert from "node:assert/strict";
import test from "node:test";
import { parseMeasures } from "../../src/scale-utils.ts";

test("parseMeasures: parses valid payload", () => {
  const parsed = parseMeasures(
    JSON.stringify({
      measures: [
        { value: 7500, type: 1, unit: -2 },
        { value: 450, type: 16, unit: 0 }
      ]
    })
  );

  assert.equal(parsed.measures.length, 2);
  assert.equal(parsed.measures[0].type, 1);
  assert.equal(parsed.measures[1].type, 16);
});

test("parseMeasures: rejects invalid JSON", () => {
  assert.throws(() => parseMeasures("{"));
});

test("parseMeasures: enforces schema", () => {
  assert.throws(
    () => parseMeasures(JSON.stringify({ measures: [{ value: 7500, type: 1 }] })),
    /Invalid|Required/
  );
});
