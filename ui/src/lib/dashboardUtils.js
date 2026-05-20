import { calculateBodyComposition } from "./bodyComposition";

export function createDateTimeFormatter(primaryOptions, fallbackOptions) {
  try {
    return new Intl.DateTimeFormat(undefined, primaryOptions);
  } catch {
    return new Intl.DateTimeFormat(undefined, fallbackOptions);
  }
}

export function getRangeWindow(date, mode) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

  if (mode === "month") {
    const start = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), 1));
    const end = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth() + 1, 1));
    return {
      start,
      end,
      startUnix: Math.floor(start.getTime() / 1000),
      endUnix: Math.floor(end.getTime() / 1000),
      label: start.toLocaleString(undefined, { month: "long", year: "numeric" })
    };
  }

  if (mode === "quarter") {
    const quarterMonth = Math.floor(utc.getUTCMonth() / 3) * 3;
    const start = new Date(Date.UTC(utc.getUTCFullYear(), quarterMonth, 1));
    const end = new Date(Date.UTC(utc.getUTCFullYear(), quarterMonth + 3, 1));
    const quarter = quarterMonth / 3 + 1;
    return {
      start,
      end,
      startUnix: Math.floor(start.getTime() / 1000),
      endUnix: Math.floor(end.getTime() / 1000),
      label: `Q${quarter} ${start.getUTCFullYear()}`
    };
  }

  const start = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const end = new Date(Date.UTC(utc.getUTCFullYear() + 1, 0, 1));
  return {
    start,
    end,
    startUnix: Math.floor(start.getTime() / 1000),
    endUnix: Math.floor(end.getTime() / 1000),
    label: String(start.getUTCFullYear())
  };
}

export function shiftAnchorDate(anchorDate, rangeMode, step) {
  const next = new Date(anchorDate);
  const monthDelta = rangeMode === "month" ? 1 : rangeMode === "quarter" ? 3 : 12;
  next.setUTCMonth(next.getUTCMonth() + step * monthDelta);
  return next;
}

export function getProfile(user, fallbacks) {
  return {
    heightM: user?.profileHeightM ?? fallbacks.heightM,
    ageYears: user?.profileAgeYears ?? fallbacks.ageYears,
    sex: user?.profileSex ?? fallbacks.sex
  };
}

export function enrichMeasurement(measurement, profile, dateFormatter) {
  const reValue = measurement.values.find((value) => value.type === 16)?.normalizedValue;
  const composition = calculateBodyComposition(measurement.weightKg, reValue, profile);

  return {
    ...measurement,
    reValue,
    composition,
    label: dateFormatter.format(new Date(measurement.measuredAt * 1000))
  };
}

export function buildMetricSeries(chartMeasurements, metric) {
  return chartMeasurements
    .map((measurement) => {
      const value =
        metric === "weight"
          ? measurement.weightKg
          : metric === "fatMass"
            ? measurement.composition?.fatMassKg
            : metric === "fatPct"
              ? measurement.composition?.fatPct
              : measurement.batteryLevel;

      if (!Number.isFinite(value)) {
        return null;
      }

      return {
        id: measurement.id,
        measuredAt: measurement.measuredAt,
        value,
        display:
          metric === "battery"
            ? `${value.toFixed(0)}%`
            : metric === "fatPct"
              ? `${value.toFixed(1)}%`
              : `${value.toFixed(1)} kg`
      };
    })
    .filter(Boolean);
}

export function formatNumber(value, unit = "") {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return `${value.toFixed(1)}${unit}`;
}

export function parseNullableNumber(value, fieldName, options = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a number`);
  }

  if (options.integer && !Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }

  if (typeof options.min === "number" && parsed < options.min) {
    throw new Error(`${fieldName} must be at least ${options.min}`);
  }

  if (typeof options.max === "number" && parsed > options.max) {
    throw new Error(`${fieldName} must be at most ${options.max}`);
  }

  return parsed;
}

export function buildProfileUpdatePayload(profileDraft, screenName) {
  return {
    screenName,
    externalUserId: parseNullableNumber(profileDraft.externalUserId, "External User ID", {
      integer: true,
      min: 1
    }),
    profileWeightKg: parseNullableNumber(profileDraft.profileWeightKg, "Weight", {
      min: 0.1
    }),
    profileHeightM: parseNullableNumber(profileDraft.profileHeightM, "Height", {
      min: 0.1
    }),
    profileAgeYears: parseNullableNumber(profileDraft.profileAgeYears, "Age", {
      min: 1
    }),
    profileSex: parseNullableNumber(profileDraft.profileSex, "Sex", {
      integer: true,
      min: 0,
      max: 1
    })
  };
}