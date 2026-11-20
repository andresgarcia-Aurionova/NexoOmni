import { describe, expect, it } from "vitest";
import { normalizeFlowCapture } from "./input-validation";

describe("flow capture formats", () => {
  it("accepts only real DD/MM/YYYY calendar dates", () => {
    expect(normalizeFlowCapture("20/11/2026", "date_ddmmyyyy")).toBe("20/11/2026");
    expect(normalizeFlowCapture("31/02/2026", "date_ddmmyyyy")).toBeNull();
    expect(normalizeFlowCapture("2026-11-20", "date_ddmmyyyy")).toBeNull();
  });

  it("normalizes RFCs and validates their Mexican format shape", () => {
    expect(normalizeFlowCapture("abc 010101abc", "mx_rfc")).toBe("ABC010101ABC");
    expect(normalizeFlowCapture("ABC0101", "mx_rfc")).toBeNull();
  });

  it("validates email and postal-code formats", () => {
    expect(normalizeFlowCapture("cliente@example.com", "email")).toBe("cliente@example.com");
    expect(normalizeFlowCapture("cliente@", "email")).toBeNull();
    expect(normalizeFlowCapture("01234", "mx_postal_code")).toBe("01234");
    expect(normalizeFlowCapture("1234", "mx_postal_code")).toBeNull();
  });

  it("accepts positive amounts with at most two decimals and stores a decimal point", () => {
    expect(normalizeFlowCapture("125,50", "positive_amount")).toBe("125.50");
    expect(normalizeFlowCapture("0", "positive_amount")).toBeNull();
    expect(normalizeFlowCapture("1,234.50", "positive_amount")).toBeNull();
  });
});
