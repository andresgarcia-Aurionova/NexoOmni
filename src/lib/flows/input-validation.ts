export type FlowCaptureFormat =
  | "date_ddmmyyyy"
  | "email"
  | "mx_rfc"
  | "mx_postal_code"
  | "positive_amount";

function isCalendarDate(value: string): boolean {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 100 && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function normalizeFlowCapture(
  value: string,
  format: FlowCaptureFormat | undefined,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  switch (format) {
    case undefined:
      return trimmed;
    case "date_ddmmyyyy":
      return isCalendarDate(trimmed) ? trimmed : null;
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
    case "mx_rfc": {
      const normalized = trimmed.toLocaleUpperCase("es-MX").replace(/\s/g, "");
      return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(normalized) ? normalized : null;
    }
    case "mx_postal_code":
      return /^\d{5}$/.test(trimmed) ? trimmed : null;
    case "positive_amount": {
      if (!/^\d{1,12}(?:[.,]\d{1,2})?$/.test(trimmed)) return null;
      const amount = Number(trimmed.replace(",", "."));
      return Number.isFinite(amount) && amount > 0 ? trimmed.replace(",", ".") : null;
    }
  }
}
