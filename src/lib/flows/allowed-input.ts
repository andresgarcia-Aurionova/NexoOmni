function normalize(value: string): string {
  return value.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export function isValidAllowedValues(values: unknown): values is string[] {
  if (!Array.isArray(values) || !values.length ||
      values.some((value) => typeof value !== "string" || !value.trim())) return false;
  return new Set(values.map(normalize)).size === values.length;
}

export function matchAllowedInput(value: string, allowed: unknown): string | null {
  if (allowed === undefined) return value;
  if (!isValidAllowedValues(allowed)) return null;
  const match = allowed.find((item) => normalize(item) === normalize(value));
  return match?.trim() ?? null;
}
