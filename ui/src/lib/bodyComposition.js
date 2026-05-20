function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function calculateBodyComposition(weightKg, resistance, profile) {
  if (!Number.isFinite(weightKg) || !Number.isFinite(resistance) || resistance <= 0) {
    return null;
  }

  const heightCm = profile.heightM * 100;
  const ageYears = profile.ageYears;
  const fatFreeMassKg =
    -9.529 +
    0.696 * ((heightCm * heightCm) / resistance) +
    0.168 * weightKg +
    0.016 * ageYears;
  const tbw = fatFreeMassKg * 0.73;
  const rawFatMassKg = weightKg - fatFreeMassKg;
  const fatMassKg = clamp(rawFatMassKg, 0, weightKg);
  const fatPct = weightKg > 0 ? clamp((fatMassKg / weightKg) * 100, 0, 100) : 0;

  return {
    tbw,
    fatFreeMassKg,
    fatMassKg,
    fatPct
  };
}