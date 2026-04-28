import { test, expect } from "vitest";
import { normaliseAuPhone } from "../../src/lib/sms";

test("normaliseAuPhone — 04xx mobile → +614xx", () => {
  expect(normaliseAuPhone("0412 345 678")).toBe("+61412345678");
});

test("normaliseAuPhone — already E.164 untouched", () => {
  expect(normaliseAuPhone("+61412345678")).toBe("+61412345678");
});

test("normaliseAuPhone — bare 4xx is expanded", () => {
  expect(normaliseAuPhone("412345678")).toBe("+61412345678");
});

test("normaliseAuPhone — 61xxx gets + prefix", () => {
  expect(normaliseAuPhone("61412345678")).toBe("+61412345678");
});

test("normaliseAuPhone — spaces and parentheses stripped", () => {
  expect(normaliseAuPhone("(04) 1234-5678")).toBe("+61412345678");
});
