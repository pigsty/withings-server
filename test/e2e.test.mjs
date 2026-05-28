/**
 * E2E test for withings-server.
 *
 * Prerequisites:
 *   - Docker available on PATH
 *   - Image already built (default): docker build -t withings-server:latest .
 *   - Optional: set WITHINGS_E2E_IMAGE to override image tag/name.
 *
 * Run with:
 *   node --test test/e2e.test.mjs
 */

import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const IMAGE = process.env.WITHINGS_E2E_IMAGE || "withings-server:latest";
const CONTAINER = "withings-e2e";
const HOST_PORT = 18080;
const BASE = `http://localhost:${HOST_PORT}`;

const ONCE_TOKEN = "test-once-token";
const USER_ID = "101010";
const SCREEN_NAME = "Test User";

// A realistic WBS06 / Body+ scale measures payload: weight (type 1) 75 kg,
// impedance re (type 16) 450.
const MEASURES_JSON = JSON.stringify({
  measures: [
    { value: 7500, type: 1, unit: -2 },  // 75.00 kg
    { value: 450,  type: 16, unit: 0  }  // re 450
  ]
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(retries = 20, delayMs = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(delayMs);
  }
  throw new Error("Server did not become healthy in time");
}

async function scalePost(path, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(`${BASE}/cgi-bin/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  // Scale endpoints return text/plain JSON
  const text = await res.text();
  return JSON.parse(text);
}

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`);
  assert.equal(res.status, 200, `GET ${path} returned ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

async function apiPut(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Container lifecycle
// ---------------------------------------------------------------------------

function startContainer() {
  // Remove any leftover container from a previous run
  spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });

  const result = spawnSync(
    "docker",
    [
      "run", "-d",
      "--name", CONTAINER,
      "-p", `${HOST_PORT}:80`,
      "-e", `WITHINGS_ONCE_TOKEN=${ONCE_TOKEN}`,
      "-e", `WITHINGS_USER_ID=${USER_ID}`,
      "-e", `WITHINGS_SCREEN_NAME=${SCREEN_NAME}`,
      "-e", "SQLITE_PATH=/tmp/withings.sqlite",
      "-e", "LOG_LEVEL=warn",
      IMAGE
    ],
    { stdio: "pipe" }
  );

  if (result.status !== 0) {
    throw new Error(
      `docker run failed (exit ${result.status}): ${result.stderr?.toString().trim()}`
    );
  }
}

function stopContainer() {
  spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("withings-server e2e", async (t) => {
  startContainer();
  await waitForHealth();

  try {
    // -----------------------------------------------------------------------
    // 1. Health check / empty state
    // -----------------------------------------------------------------------
    await t.test("healthz reports zero measurements on fresh db", async () => {
      const health = await apiGet("/healthz");
      assert.equal(health.ok, true);
      assert.equal(health.measurements, 0);
      assert.equal(health.unlinkedMeasurements, 0);
      assert.equal(health.users, 0);
    });

    // -----------------------------------------------------------------------
    // 2. Scale handshake: /once  →  returns the configured once token
    // -----------------------------------------------------------------------
    await t.test("scale /once returns configured once token", async () => {
      const data = await scalePost("once", { action: "getonce" });
      assert.equal(data.status, 0);
      assert.equal(data.body.once, ONCE_TOKEN);
    });

    // -----------------------------------------------------------------------
    // 3. Scale /session new  →  returns user profile with correct fields
    // -----------------------------------------------------------------------
    let sessionId;

    await t.test("scale /session new returns user profile with name, height, sex", async () => {
      const data = await scalePost("session", {
        action: "new",
        macaddress: "00:11:22:33:44:55",
        auth: "00:11:22:33:44:55",
        mfgid: "0x0476",
        hash: "abc123",
        currentfw: "1234",
        batterylvl: "100",
        duration: "30",
        zreboot: "0"
      });

      assert.equal(data.status, 0, "session status should be 0");
      assert.ok(data.body.sessionid, "should return a sessionid");
      sessionId = data.body.sessionid;

      const sp = data.body.sp;
      assert.ok(sp, "response should include sp (scale profile)");
      assert.ok(Array.isArray(sp.users) && sp.users.length > 0, "sp.users should be non-empty");

      const user = sp.users[0];

      // id / screen-name short code derived from SCREEN_NAME ("Test User" → "TU")
      assert.equal(user.id, Number(USER_ID), "user id should match WITHINGS_USER_ID");
      assert.equal(user.sn, "TU", "short name should be initials of SCREEN_NAME");

      // height field
      assert.ok(typeof user.ht === "number", "height (ht) should be a number");

      // sex field (0 or 1)
      assert.ok(user.sx === 0 || user.sx === 1, "sex (sx) should be 0 or 1");

      // weight field present
      assert.ok(typeof user.wt === "number", "weight (wt) should be a number");

      // language / ind block
      assert.ok(data.body.ind, "response should include ind block");
      assert.ok(data.body.syp, "response should include syp block");
      assert.ok(data.body.ctp, "response should include ctp block");
    });

    // -----------------------------------------------------------------------
    // 4. Submit a measurement
    // -----------------------------------------------------------------------
    await t.test("scale /measure store accepts and stores measurement", async () => {
      const now = Math.floor(Date.now() / 1000);
      const data = await scalePost("measure", {
        action: "store",
        sessionid: sessionId,
        macaddress: "00:11:22:33:44:55",
        userid: USER_ID,
        meastime: String(now),
        devtype: "1",
        attribstatus: "0",
        measures: MEASURES_JSON
      });

      assert.equal(data.status, 0, "measure store should return status 0");
    });

    // -----------------------------------------------------------------------
    // 5. Measurement appears in unlinked list (no profile created yet)
    // -----------------------------------------------------------------------
    await t.test("measurement appears as unlinked", async () => {
      const data = await apiGet("/api/ui/unlinked");
      assert.ok(Array.isArray(data.measurements), "should return measurements array");
      assert.equal(data.measurements.length, 1, "should have exactly 1 unlinked measurement");

      const m = data.measurements[0];
      assert.ok(m.id, "measurement should have an id");
      assert.ok(m.weightKg != null || m.extracted != null, "measurement should contain weight data");
    });

    // -----------------------------------------------------------------------
    // 6. Create a profile
    // -----------------------------------------------------------------------
    let userId;
    let secondUserId;

    await t.test("can create a user profile", async () => {
      const { status, body } = await apiPost("/api/ui/users", { screenName: "Alice" });
      assert.equal(status, 201);
      assert.ok(body.userId, "should return userId");
      userId = body.userId;
    });

    await t.test("can create a second user profile", async () => {
      const { status, body } = await apiPost("/api/ui/users", { screenName: "Bob" });
      assert.equal(status, 201);
      assert.ok(body.userId, "should return userId");
      secondUserId = body.userId;
    });

    await t.test("scale /session new returns all registered users in sp.users", async () => {
      const data = await scalePost("session", {
        action: "new",
        macaddress: "00:11:22:33:44:55",
        auth: "00:11:22:33:44:55",
        mfgid: "0x0476",
        hash: "abc123",
        currentfw: "1234",
        batterylvl: "100",
        duration: "30",
        zreboot: "0"
      });

      assert.equal(data.status, 0, "session status should be 0");
      assert.ok(data.body.sessionid, "should return a sessionid");

      const users = data.body.sp?.users;
      assert.ok(Array.isArray(users), "sp.users should be an array");
      assert.equal(users.length, 2, "sp.users should include all registered users");

      const userIds = new Set(users.map((u) => u.id));
      assert.ok(userIds.has(userId), "sp.users should include Alice user id");
      assert.ok(userIds.has(secondUserId), "sp.users should include Bob user id");

      await scalePost("session", {
        action: "delete",
        sessionid: data.body.sessionid
      });
    });

    // -----------------------------------------------------------------------
    // 7. Update profile with height / sex (optional metadata)
    // -----------------------------------------------------------------------
    await t.test("can update profile with height and sex", async () => {
      const { status, body } = await apiPut(`/api/ui/users/${userId}`, {
        screenName: "Alice",
        externalUserId: null,
        profileWeightKg: 75,
        profileHeightM: 1.68,
        profileAgeYears: 30,
        profileSex: 0
      });
      assert.equal(status, 200);
      assert.equal(body.ok, true);
    });

    // -----------------------------------------------------------------------
    // 8. Claim / reassign the unlinked measurement to the new profile
    // -----------------------------------------------------------------------
    await t.test("can assign unlinked measurement to the new user", async () => {
      const unlinked = await apiGet("/api/ui/unlinked");
      const measurementId = unlinked.measurements[0].id;

      const { status, body } = await apiPost(
        `/api/ui/unlinked/${measurementId}/assign`,
        { userId }
      );
      assert.equal(status, 200);
      assert.equal(body.ok, true);
    });

    // -----------------------------------------------------------------------
    // 9. Unlinked list is now empty
    // -----------------------------------------------------------------------
    await t.test("unlinked list is empty after assignment", async () => {
      const data = await apiGet("/api/ui/unlinked");
      assert.equal(data.measurements.length, 0, "unlinked list should now be empty");
    });

    // -----------------------------------------------------------------------
    // 10. Measurement appears under the profile
    // -----------------------------------------------------------------------
    await t.test("measurement is visible under user profile", async () => {
      const start = 0;
      const end = Math.floor(Date.now() / 1000) + 60;
      const data = await apiGet(
        `/api/ui/users/${userId}/measurements?start=${start}&end=${end}&granularity=raw`
      );
      assert.ok(Array.isArray(data.measurements), "should return measurements array");
      assert.equal(data.measurements.length, 1, "user should have exactly 1 measurement");

      const m = data.measurements[0];
      // Weight was stored as 75.00 kg (7500 * 10^-2)
      assert.ok(
        Math.abs(m.weightKg - 75) < 0.01,
        `weightKg should be ~75, got ${m.weightKg}`
      );
    });

    // -----------------------------------------------------------------------
    // 11. Close the session
    // -----------------------------------------------------------------------
    await t.test("scale /session delete closes session cleanly", async () => {
      const data = await scalePost("session", {
        action: "delete",
        sessionid: sessionId
      });
      assert.equal(data.status, 0, "delete session should return status 0");
    });

    // -----------------------------------------------------------------------
    // 12. healthz confirms final counts
    // -----------------------------------------------------------------------
    await t.test("healthz reflects final state: 2 users, 1 measurement, 0 unlinked", async () => {
      const health = await apiGet("/healthz");
      assert.equal(health.ok, true);
      assert.equal(health.users, 2);
      assert.equal(health.measurements, 1);
      assert.equal(health.unlinkedMeasurements, 0);
    });

  } finally {
    stopContainer();
  }
});
