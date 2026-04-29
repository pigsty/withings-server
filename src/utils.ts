export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function generateSessionId(): string {
  const prefix = Math.floor(Math.random() * 900 + 100);
  const a = Math.random().toString(16).slice(2, 10);
  const b = Math.random().toString(16).slice(2, 10);
  return `${prefix}-${a}-${b}`;
}

export function measurementTypeLabel(type: number): string {
  switch (type) {
    case 1:
      return "weight";
    case 16:
      return "re";
    default:
      return "unknown";
  }
}

export function normalizeValue(value: number, unit: number): number {
  return value * Math.pow(10, unit);
}

export function toScaleShortName(screenName: string): string {
  const words = screenName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "US";
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return words.map((word) => word[0]).join("").toUpperCase();
}
