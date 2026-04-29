import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { WithingsDataAccess, type NormalizedMeasure } from "../../src/data/withingsDataAccess.ts";

function createDataAccess(): WithingsDataAccess {
  const dbPath = join(tmpdir(), `withings-unit-${randomUUID()}.sqlite`);
  const da = new WithingsDataAccess(dbPath, () => Math.floor(Date.now() / 1000));
  da.initialize();
  return da;
}

function makeMeasures(weightKg: number): NormalizedMeasure[] {
  return [
    {
      type: 1,
      label: "weight",
      value: Math.round(weightKg * 100),
      unit: -2,
      normalizedValue: weightKg
    }
  ];
}

function persistForUser(
  da: WithingsDataAccess,
  userId: number,
  weightKg: number,
  measuredAt: number
): number {
  const normalizedMeasures = makeMeasures(weightKg);
  const extracted = da.extractScaleData(normalizedMeasures);
  const { measurementId } = da.persistMeasurement({
    sessionId: `s-${randomUUID()}`,
    measuredAt,
    receivedAt: measuredAt,
    rawMeasuresJson: JSON.stringify({ measures: [{ value: Math.round(weightKg * 100), type: 1, unit: -2 }] }),
    normalizedMeasures,
    extracted
  });

  const reassigned = da.reassignMeasurement(measurementId, userId);
  if (!reassigned) {
    // The record may already be assigned by heuristic; force deterministic ownership for tests.
    da.unlinkMeasurement(measurementId);
    assert.equal(da.reassignMeasurement(measurementId, userId), true);
  }

  return measurementId;
}

test("assignUserIdByWeight: selects nearest within 2kg and breaks ties by recency", () => {
  const da = createDataAccess();
  const userA = da.createUiUser("Alice");
  const userB = da.createUiUser("Bob");

  persistForUser(da, userA, 70, 1_700_000_000);
  persistForUser(da, userB, 74, 1_700_000_100);

  const tied = da.assignUserIdByWeight(72);
  assert.equal(tied.userId, userB);
  assert.equal(tied.strategy, "recent_5_within_2kg");

  const unallocated = da.assignUserIdByWeight(80);
  assert.equal(unallocated.userId, null);
  assert.equal(unallocated.strategy, "unallocated");
});

test("extractScaleData: throws without weight and maps expected fields", () => {
  const da = createDataAccess();

  assert.throws(
    () =>
      da.extractScaleData([
        { type: 16, label: "re", value: 450, unit: 0, normalizedValue: 450 }
      ]),
    /missing weight/
  );

  const extracted = da.extractScaleData([
    { type: 1, label: "weight", value: 7500, unit: -2, normalizedValue: 75 },
    { type: 16, label: "re", value: 450, unit: 0, normalizedValue: 450 },
    { type: 3, label: "ri", value: 2000, unit: 0, normalizedValue: 2000 },
    { type: 76, label: "hydration", value: 56, unit: 0, normalizedValue: 56 },
    { type: 91, label: "pulse", value: 64, unit: 0, normalizedValue: 64 }
  ]);

  assert.equal(extracted.weightKg, 75);
  assert.equal(extracted.type16Raw, 450);
  assert.equal(extracted.ri, 2000);
  assert.equal(extracted.hydration, 56);
  assert.equal(extracted.pulse, 64);
});

test("persistMeasurement: transaction rolls back on value insert failure", () => {
  const da = createDataAccess();

  const badMeasures = [
    { type: 1, label: "weight", value: 7000, unit: -2, normalizedValue: 70 },
    // Intentionally invalid: measure_label is NOT NULL in schema.
    { type: 16, label: undefined, value: 450, unit: 0, normalizedValue: 450 }
  ] as unknown as NormalizedMeasure[];

  assert.throws(() => {
    da.persistMeasurement({
      sessionId: "tx-fail",
      measuredAt: 1_700_000_000,
      receivedAt: 1_700_000_000,
      rawMeasuresJson: JSON.stringify({ measures: [] }),
      normalizedMeasures: badMeasures,
      extracted: { weightKg: 70, type16Raw: 450 }
    });
  });

  const counts = da.getCounts();
  assert.equal(counts.measurements, 0);
});

test("listMeasurementsForUser: raw and daily aggregation produce expected rows", () => {
  const da = createDataAccess();
  const userId = da.createUiUser("Daily User");

  const dayStart = 1_700_000_000;
  persistForUser(da, userId, 70, dayStart + 10);
  persistForUser(da, userId, 72, dayStart + 20);
  persistForUser(da, userId, 80, dayStart + 30);

  const raw = da.listMeasurementsForUser(userId, dayStart, dayStart + 86_400, "raw");
  assert.equal(raw.length, 3);
  assert.deepEqual(
    raw.map((m) => m.weightKg),
    [70, 72, 80]
  );

  const daily = da.listMeasurementsForUser(userId, dayStart, dayStart + 86_400, "daily");
  assert.equal(daily.length, 1);
  assert.equal(daily[0].weightKg, 72);
});
