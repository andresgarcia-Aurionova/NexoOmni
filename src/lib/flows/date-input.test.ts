import { describe, expect, it } from "vitest";
import { isCurrentOrFutureDate } from "./date-input";

describe("date input", () => {
  const now = new Date("2026-11-20T05:30:00Z");

  it("uses the configured local date at midnight boundaries", () => {
    expect(isCurrentOrFutureDate("19/11/2026", "America/Mexico_City", now)).toBe(true);
    expect(isCurrentOrFutureDate("18/11/2026", "America/Mexico_City", now)).toBe(false);
    expect(isCurrentOrFutureDate("19/11/2026", "UTC", now)).toBe(false);
    expect(isCurrentOrFutureDate("20/11/2026", "UTC", now)).toBe(true);
  });

  it("rejects invalid dates, ambiguous formats and invalid time zones", () => {
    expect(isCurrentOrFutureDate("31/02/2027", "UTC", now)).toBe(false);
    expect(isCurrentOrFutureDate("29/02/2028", "UTC", now)).toBe(true);
    expect(isCurrentOrFutureDate("2026-11-21", "UTC", now)).toBe(false);
    expect(isCurrentOrFutureDate("21/11/2026", "not-a-zone", now)).toBe(false);
  });
});
