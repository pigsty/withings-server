import Database from "better-sqlite3";

export type NormalizedMeasure = {
  value: number;
  type: number;
  unit: number;
  normalizedValue: number;
  label: string;
};

export type ExtractedScaleData = {
  weightKg: number;
  re?: number;
  ri?: number;
  fatRatio?: number;
  fatMassKg?: number;
  muscleMassKg?: number;
  hydration?: number;
  bodyTemperatureC?: number;
  pulse?: number;
  type16Raw?: number;
};

export type UserAssignment = {
  userId: number | null;
  strategy: string;
  deltaKg?: number;
};

export type PersistMeasurementInput = {
  sessionId: string;
  macAddress?: string;
  scaleUserId?: number;
  batteryLevel?: number;
  measuredAt: number;
  receivedAt: number;
  devType?: number;
  attribStatus?: number;
  rawMeasuresJson: string;
  normalizedMeasures: NormalizedMeasure[];
  extracted: ExtractedScaleData;
};

export type ScaleUserProfile = {
  screenName: string;
  weightKg: number;
  heightM: number;
  ageYears: number;
  sex: number;
};

export type UserSummary = {
  userId: number;
  externalUserId?: number;
  screenName: string;
  profileWeightKg?: number;
  profileHeightM?: number;
  profileAgeYears?: number;
  profileSex?: number;
  measurementCount: number;
  lastMeasuredAt?: number;
};

export type UserProfileUpdate = {
  screenName: string;
  externalUserId: number | null;
  profileWeightKg: number | null;
  profileHeightM: number | null;
  profileAgeYears: number | null;
  profileSex: number | null;
};

export type MeasurementValueRecord = {
  type: number;
  label: string;
  rawValue: number;
  unit: number;
  normalizedValue: number;
};

export type MeasurementRecord = {
  id: number;
  userId: number;
  sessionId: string;
  macAddress?: string;
  scaleUserId?: number;
  batteryLevel?: number;
  measuredAt: number;
  receivedAt: number;
  devType?: number;
  attribStatus?: number;
  weightKg: number;
  extracted: ExtractedScaleData;
  values: MeasurementValueRecord[];
};

export class WithingsDataAccess {
  private readonly db: Database.Database;
  private readonly nowUnix: () => number;

  constructor(dbPath: string, nowUnix: () => number = () => Math.floor(Date.now() / 1000)) {
    this.db = new Database(dbPath);
    this.nowUnix = nowUnix;
  }

  initialize(): void {
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_user_id INTEGER UNIQUE,
        screen_name TEXT,
        profile_weight_kg REAL,
        profile_height_m REAL,
        profile_age_years REAL,
        profile_sex INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS measurements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        session_id TEXT NOT NULL,
        mac_address TEXT,
        scale_user_id INTEGER,
        battery_level INTEGER,
        measured_at INTEGER NOT NULL,
        received_at INTEGER NOT NULL,
        dev_type INTEGER,
        attrib_status INTEGER,
        weight_kg REAL NOT NULL,
        raw_measures_json TEXT NOT NULL,
        extracted_json TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS measurement_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        measurement_id INTEGER NOT NULL,
        measure_type INTEGER NOT NULL,
        measure_label TEXT NOT NULL,
        raw_value REAL NOT NULL,
        unit INTEGER NOT NULL,
        normalized_value REAL NOT NULL,
        FOREIGN KEY(measurement_id) REFERENCES measurements(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_measurements_user_time
        ON measurements(user_id, measured_at DESC, id DESC);

      CREATE INDEX IF NOT EXISTS idx_measurements_measured_at
        ON measurements(measured_at DESC, id DESC);
    `);

    if (!this.columnExists("measurements", "battery_level")) {
      this.db.exec("ALTER TABLE measurements ADD COLUMN battery_level INTEGER");
    }

    this.ensureMeasurementsUserNullable();
    this.cleanupLegacyAnonymousUsers();

    this.ensureColumn("users", "profile_weight_kg", "REAL");
    this.ensureColumn("users", "profile_height_m", "REAL");
    this.ensureColumn("users", "profile_age_years", "REAL");
    this.ensureColumn("users", "profile_sex", "INTEGER");
  }

  ensureUserByExternalId(externalUserId: number, screenName?: string): number {
    const now = this.nowUnix();

    this.db
      .prepare(
        `
          INSERT INTO users (external_user_id, screen_name, created_at)
          VALUES (?, ?, ?)
          ON CONFLICT(external_user_id)
          DO UPDATE SET screen_name = COALESCE(excluded.screen_name, users.screen_name)
        `
      )
      .run(externalUserId, screenName ?? null, now);

    const row = this.db
      .prepare("SELECT id FROM users WHERE external_user_id = ?")
      .get(externalUserId) as { id: number } | undefined;

    if (!row) {
      throw new Error("failed to resolve user by external ID");
    }

    return row.id;
  }

  assignUserIdByWeight(weightKg: number): UserAssignment {
    const rows = this.db.prepare(
      `
        WITH ranked AS (
          SELECT
            user_id,
            weight_kg,
            measured_at,
            ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY measured_at DESC, id DESC) AS rn
          FROM measurements
          WHERE user_id IS NOT NULL
        ),
        recent AS (
          SELECT user_id, weight_kg, measured_at
          FROM ranked
          WHERE rn <= 5
        ),
        averaged AS (
          SELECT
            user_id,
            AVG(weight_kg) AS avg_weight_kg,
            MAX(measured_at) AS last_measured_at
          FROM recent
          GROUP BY user_id
        )
        SELECT user_id, avg_weight_kg, last_measured_at
        FROM averaged
      `
    ).all() as Array<{ user_id: number; avg_weight_kg: number; last_measured_at: number }>;

    let bestMatch: { userId: number; deltaKg: number; measuredAt: number } | undefined;

    for (const row of rows) {
      const deltaKg = Math.abs(weightKg - row.avg_weight_kg);
      if (deltaKg > 2) {
        continue;
      }

      const isBetter =
        !bestMatch ||
        deltaKg < bestMatch.deltaKg ||
        (deltaKg === bestMatch.deltaKg && row.last_measured_at > bestMatch.measuredAt);

      if (isBetter) {
        bestMatch = {
          userId: row.user_id,
          deltaKg,
          measuredAt: row.last_measured_at
        };
      }
    }

    if (bestMatch) {
      return {
        userId: bestMatch.userId,
        strategy: "recent_5_within_2kg",
        deltaKg: bestMatch.deltaKg
      };
    }

    return {
      userId: null,
      strategy: "unallocated"
    };
  }

  createUiUser(screenName: string): number {
    const trimmed = screenName.trim();
    if (!trimmed) {
      throw new Error("screen name is required");
    }

    const result = this.db
      .prepare("INSERT INTO users (external_user_id, screen_name, created_at) VALUES (NULL, ?, ?)")
      .run(trimmed, this.nowUnix());

    return Number(result.lastInsertRowid);
  }

  extractScaleData(measures: NormalizedMeasure[]): ExtractedScaleData {
    const byType = new Map<number, NormalizedMeasure>();

    for (const measure of measures) {
      byType.set(measure.type, measure);
    }

    const weight = byType.get(1)?.normalizedValue;
    if (typeof weight !== "number") {
      throw new Error("measurement payload missing weight (type=1)");
    }

    return {
      weightKg: weight,
      re: byType.get(2)?.normalizedValue,
      ri: byType.get(3)?.normalizedValue,
      fatRatio: byType.get(5)?.normalizedValue,
      fatMassKg: byType.get(6)?.normalizedValue,
      muscleMassKg: byType.get(54)?.normalizedValue,
      hydration: byType.get(76)?.normalizedValue,
      bodyTemperatureC: byType.get(71)?.normalizedValue,
      pulse: byType.get(91)?.normalizedValue,
      type16Raw: byType.get(16)?.normalizedValue
    };
  }

  persistMeasurement(input: PersistMeasurementInput): { measurementId: number; userAssignment: UserAssignment } {
    const userAssignment = this.assignUserIdByWeight(input.extracted.weightKg);

    const persist = this.db.transaction(() => {
      const insertMeasurement = this.db.prepare(
        `
          INSERT INTO measurements (
            user_id,
            session_id,
            mac_address,
            scale_user_id,
            battery_level,
            measured_at,
            received_at,
            dev_type,
            attrib_status,
            weight_kg,
            raw_measures_json,
            extracted_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      );

      const measurementResult = insertMeasurement.run(
        userAssignment.userId,
        input.sessionId,
        input.macAddress,
        input.scaleUserId,
        input.batteryLevel,
        input.measuredAt,
        input.receivedAt,
        input.devType,
        input.attribStatus,
        input.extracted.weightKg,
        input.rawMeasuresJson,
        JSON.stringify(input.extracted)
      );

      const measurementId = Number(measurementResult.lastInsertRowid);
      const insertValue = this.db.prepare(
        `
          INSERT INTO measurement_values (
            measurement_id,
            measure_type,
            measure_label,
            raw_value,
            unit,
            normalized_value
          ) VALUES (?, ?, ?, ?, ?, ?)
        `
      );

      for (const measure of input.normalizedMeasures) {
        insertValue.run(
          measurementId,
          measure.type,
          measure.label,
          measure.value,
          measure.unit,
          measure.normalizedValue
        );
      }

      return measurementId;
    });

    return {
      measurementId: persist(),
      userAssignment
    };
  }

  getCounts(): { users: number; measurements: number } {
    return this.db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM measurements) AS measurements"
      )
      .get() as { users: number; measurements: number };
  }

  getFirstRegisteredUser(): { userId: number } | undefined {
    const row = this.db
      .prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1")
      .get() as { id: number } | undefined;

    return row ? { userId: row.id } : undefined;
  }

  getScaleProfileByRowId(userId: number): ScaleUserProfile {
    const row = this.db
      .prepare(
        `
          SELECT
            COALESCE(screen_name, 'USR') AS screen_name,
            profile_weight_kg,
            profile_height_m,
            profile_age_years,
            profile_sex
          FROM users
          WHERE id = ?
        `
      )
      .get(userId) as
      | {
          screen_name: string;
          profile_weight_kg: number | null;
          profile_height_m: number | null;
          profile_age_years: number | null;
          profile_sex: number | null;
        }
      | undefined;

    return {
      screenName: row?.screen_name ?? "USR",
      weightKg: row?.profile_weight_kg ?? 70,
      heightM: row?.profile_height_m ?? 1.8,
      ageYears: row?.profile_age_years ?? 40,
      sex: row?.profile_sex ?? 1
    };
  }

  getRecentMeasurementStats(userId: number, count: number): {
    avgWeightKg: number;
    avgRe: number | null;
    avgRi: number | null;
  } {
    // avg weight from last N measurement rows for this user
    const weightRow = this.db
      .prepare(
        `
          SELECT AVG(weight_kg) AS avg_weight
          FROM (
            SELECT weight_kg FROM measurements
            WHERE user_id = ?
            ORDER BY measured_at DESC, id DESC
            LIMIT ?
          )
        `
      )
      .get(userId, count) as { avg_weight: number | null };

    // avg re (type 2 or type 16) from measurement_values for those same measurements
    const reRow = this.db
      .prepare(
        `
          SELECT AVG(mv.normalized_value) AS avg_re
          FROM measurement_values mv
          INNER JOIN (
            SELECT id FROM measurements
            WHERE user_id = ?
            ORDER BY measured_at DESC, id DESC
            LIMIT ?
          ) recent ON mv.measurement_id = recent.id
          WHERE mv.measure_type IN (2, 16)
        `
      )
      .get(userId, count) as { avg_re: number | null };

    // avg ri (type 3) from those same measurements
    const riRow = this.db
      .prepare(
        `
          SELECT AVG(mv.normalized_value) AS avg_ri
          FROM measurement_values mv
          INNER JOIN (
            SELECT id FROM measurements
            WHERE user_id = ?
            ORDER BY measured_at DESC, id DESC
            LIMIT ?
          ) recent ON mv.measurement_id = recent.id
          WHERE mv.measure_type = 3
        `
      )
      .get(userId, count) as { avg_ri: number | null };

    return {
      avgWeightKg: weightRow.avg_weight ?? 0,
      avgRe: reRow.avg_re,
      avgRi: riRow.avg_ri
    };
  }

  getScaleProfileByExternalId(externalUserId: number, fallbackScreenName: string): ScaleUserProfile {
    this.ensureUserByExternalId(externalUserId, fallbackScreenName);

    const row = this.db
      .prepare(
        `
          SELECT
            screen_name,
            profile_weight_kg,
            profile_height_m,
            profile_age_years,
            profile_sex
          FROM users
          WHERE external_user_id = ?
        `
      )
      .get(externalUserId) as
      | {
          screen_name: string | null;
          profile_weight_kg: number | null;
          profile_height_m: number | null;
          profile_age_years: number | null;
          profile_sex: number | null;
        }
      | undefined;

    return {
      screenName: row?.screen_name ?? fallbackScreenName,
      weightKg: row?.profile_weight_kg ?? 70,
      heightM: row?.profile_height_m ?? 1.8,
      ageYears: row?.profile_age_years ?? 40,
      sex: row?.profile_sex ?? 1
    };
  }

  listUnlinkedMeasurements(): Array<{
    id: number;
    sessionId: string;
    macAddress: string | null;
    measuredAt: number;
    weightKg: number;
  }> {
    return this.db
      .prepare(
        `
          SELECT
            m.id,
            m.session_id AS sessionId,
            m.mac_address AS macAddress,
            m.measured_at AS measuredAt,
            m.weight_kg AS weightKg
          FROM measurements m
          WHERE m.user_id IS NULL
          ORDER BY m.measured_at DESC, m.id DESC
        `
      )
      .all() as Array<{
      id: number;
      sessionId: string;
      macAddress: string | null;
      measuredAt: number;
      weightKg: number;
    }>;
  }

  countUnlinkedMeasurements(): number {
    const row = this.db
      .prepare(
        `
          SELECT COUNT(*) AS n
          FROM measurements m
          WHERE m.user_id IS NULL
        `
      )
      .get() as { n: number };

    return row.n;
  }

  reassignMeasurement(measurementId: number, toUserId: number): boolean {
    const userExists = this.db
      .prepare("SELECT 1 FROM users WHERE id = ?")
      .get(toUserId);

    if (!userExists) {
      return false;
    }

    const result = this.db
      .prepare("UPDATE measurements SET user_id = ? WHERE id = ? AND user_id IS NULL")
      .run(toUserId, measurementId);

    return result.changes > 0;
  }

  unlinkMeasurement(measurementId: number): boolean {
    const result = this.db
      .prepare("UPDATE measurements SET user_id = NULL WHERE id = ? AND user_id IS NOT NULL")
      .run(measurementId);

    return result.changes > 0;
  }

  updateUserProfile(userId: number, update: UserProfileUpdate): boolean {
    const result = this.db
      .prepare(
        `
          UPDATE users
          SET
            external_user_id = ?,
            screen_name = ?,
            profile_weight_kg = ?,
            profile_height_m = ?,
            profile_age_years = ?,
            profile_sex = ?
          WHERE id = ?
        `
      )
      .run(
        update.externalUserId,
        update.screenName,
        update.profileWeightKg,
        update.profileHeightM,
        update.profileAgeYears,
        update.profileSex,
        userId
      );

    return result.changes > 0;
  }

  listUsers(): UserSummary[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            u.id,
            u.external_user_id,
            COALESCE(u.screen_name, 'USR') AS screen_name,
            u.profile_weight_kg,
            u.profile_height_m,
            u.profile_age_years,
            u.profile_sex,
            COUNT(m.id) AS measurement_count,
            MAX(m.measured_at) AS last_measured_at
          FROM users u
          LEFT JOIN measurements m ON m.user_id = u.id
          GROUP BY u.id
          ORDER BY COALESCE(last_measured_at, 0) DESC, u.id ASC
        `
      )
      .all() as Array<{
      id: number;
      external_user_id: number | null;
      screen_name: string;
      profile_weight_kg: number | null;
      profile_height_m: number | null;
      profile_age_years: number | null;
      profile_sex: number | null;
      measurement_count: number;
      last_measured_at: number | null;
    }>;

    return rows.map((row) => ({
      userId: row.id,
      externalUserId: row.external_user_id ?? undefined,
      screenName: row.screen_name,
      profileWeightKg: row.profile_weight_kg ?? undefined,
      profileHeightM: row.profile_height_m ?? undefined,
      profileAgeYears: row.profile_age_years ?? undefined,
      profileSex: row.profile_sex ?? undefined,
      measurementCount: row.measurement_count,
      lastMeasuredAt: row.last_measured_at ?? undefined
    }));
  }

  listMeasurementsForUser(
    userId: number,
    startMeasuredAt: number,
    endMeasuredAt: number,
    granularity: "raw" | "daily" | "weekly" = "raw"
  ): MeasurementRecord[] {
    const bucketFormat =
      granularity === "weekly"
        ? "%Y-%W"
        : granularity === "daily"
          ? "%Y-%j"
          : null;

    const query =
      bucketFormat !== null
        ? `
          WITH stats AS (
            SELECT
              strftime('${bucketFormat}', datetime(measured_at, 'unixepoch')) AS bucket,
              AVG(weight_kg) AS mean_weight
            FROM measurements
            WHERE user_id = ?
              AND measured_at >= ?
              AND measured_at < ?
            GROUP BY bucket
          ),
          ranked AS (
            SELECT
              m.id,
              ROW_NUMBER() OVER (
                PARTITION BY s.bucket
                ORDER BY ABS(m.weight_kg - s.mean_weight), m.id
              ) AS rn
            FROM measurements m
            JOIN stats s
              ON strftime('${bucketFormat}', datetime(m.measured_at, 'unixepoch')) = s.bucket
            WHERE m.user_id = ?
              AND m.measured_at >= ?
              AND m.measured_at < ?
          )
          SELECT
            id,
            user_id,
            session_id,
            mac_address,
            scale_user_id,
            battery_level,
            measured_at,
            received_at,
            dev_type,
            attrib_status,
            weight_kg,
            extracted_json
          FROM measurements
          WHERE id IN (SELECT id FROM ranked WHERE rn = 1)
          ORDER BY measured_at ASC, id ASC
        `
        : `
          SELECT
            id,
            user_id,
            session_id,
            mac_address,
            scale_user_id,
            battery_level,
            measured_at,
            received_at,
            dev_type,
            attrib_status,
            weight_kg,
            extracted_json
          FROM measurements
          WHERE user_id = ?
            AND measured_at >= ?
            AND measured_at < ?
          ORDER BY measured_at ASC, id ASC
        `;

    const params =
      bucketFormat !== null
        ? [userId, startMeasuredAt, endMeasuredAt, userId, startMeasuredAt, endMeasuredAt]
        : [userId, startMeasuredAt, endMeasuredAt];

    const measurements = this.db
      .prepare(query)
      .all(...params) as Array<{
      id: number;
      user_id: number;
      session_id: string;
      mac_address: string | null;
      scale_user_id: number | null;
      battery_level: number | null;
      measured_at: number;
      received_at: number;
      dev_type: number | null;
      attrib_status: number | null;
      weight_kg: number;
      extracted_json: string;
    }>;

    if (measurements.length === 0) {
      return [];
    }

    const valuesByMeasurementId = new Map<number, MeasurementValueRecord[]>();
    const placeholders = measurements.map(() => "?").join(", ");
    const valueRows = this.db
      .prepare(
        `
          SELECT
            measurement_id,
            measure_type,
            measure_label,
            raw_value,
            unit,
            normalized_value
          FROM measurement_values
          WHERE measurement_id IN (${placeholders})
          ORDER BY measurement_id ASC, id ASC
        `
      )
      .all(...measurements.map((measurement) => measurement.id)) as Array<{
      measurement_id: number;
      measure_type: number;
      measure_label: string;
      raw_value: number;
      unit: number;
      normalized_value: number;
    }>;

    for (const row of valueRows) {
      const existing = valuesByMeasurementId.get(row.measurement_id) ?? [];
      existing.push({
        type: row.measure_type,
        label: row.measure_label,
        rawValue: row.raw_value,
        unit: row.unit,
        normalizedValue: row.normalized_value
      });
      valuesByMeasurementId.set(row.measurement_id, existing);
    }

    return measurements.map((measurement) => ({
      id: measurement.id,
      userId: measurement.user_id,
      sessionId: measurement.session_id,
      macAddress: measurement.mac_address ?? undefined,
      scaleUserId: measurement.scale_user_id ?? undefined,
      batteryLevel: measurement.battery_level ?? undefined,
      measuredAt: measurement.measured_at,
      receivedAt: measurement.received_at,
      devType: measurement.dev_type ?? undefined,
      attribStatus: measurement.attrib_status ?? undefined,
      weightKg: measurement.weight_kg,
      extracted: JSON.parse(measurement.extracted_json) as ExtractedScaleData,
      values: valuesByMeasurementId.get(measurement.id) ?? []
    }));
  }

  private ensureMeasurementsUserNullable(): void {
    const userColumn = this.db
      .prepare("PRAGMA table_info(measurements)")
      .all() as Array<{ name: string; notnull: number }>;

    const userIdColumn = userColumn.find((column) => column.name === "user_id");
    if (!userIdColumn || userIdColumn.notnull === 0) {
      return;
    }

    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE measurements_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          session_id TEXT NOT NULL,
          mac_address TEXT,
          scale_user_id INTEGER,
          battery_level INTEGER,
          measured_at INTEGER NOT NULL,
          received_at INTEGER NOT NULL,
          dev_type INTEGER,
          attrib_status INTEGER,
          weight_kg REAL NOT NULL,
          raw_measures_json TEXT NOT NULL,
          extracted_json TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id)
        );

        INSERT INTO measurements_new (
          id,
          user_id,
          session_id,
          mac_address,
          scale_user_id,
          battery_level,
          measured_at,
          received_at,
          dev_type,
          attrib_status,
          weight_kg,
          raw_measures_json,
          extracted_json
        )
        SELECT
          id,
          user_id,
          session_id,
          mac_address,
          scale_user_id,
          battery_level,
          measured_at,
          received_at,
          dev_type,
          attrib_status,
          weight_kg,
          raw_measures_json,
          extracted_json
        FROM measurements;

        DROP TABLE measurements;
        ALTER TABLE measurements_new RENAME TO measurements;

        CREATE INDEX IF NOT EXISTS idx_measurements_user_time
          ON measurements(user_id, measured_at DESC, id DESC);

        CREATE INDEX IF NOT EXISTS idx_measurements_measured_at
          ON measurements(measured_at DESC, id DESC);
      `);
    })();
  }

  private cleanupLegacyAnonymousUsers(): void {
    this.db.transaction(() => {
      this.db.exec(`
        UPDATE measurements
        SET user_id = NULL
        WHERE user_id IN (
          SELECT id
          FROM users
          WHERE external_user_id IS NULL
            AND COALESCE(screen_name, '') = 'auto'
        );

        DELETE FROM users
        WHERE external_user_id IS NULL
          AND COALESCE(screen_name, '') = 'auto';
      `);
    })();
  }

  private columnExists(tableName: string, columnName: string): boolean {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
      name: string;
    }>;

    return columns.some((column) => column.name === columnName);
  }

  private ensureColumn(tableName: string, columnName: string, columnType: string): void {
    if (this.columnExists(tableName, columnName)) {
      return;
    }

    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}