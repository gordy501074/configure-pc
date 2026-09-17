// @group unit
// Unit tests for src/lib/format.ts — pure formatting/parsing helpers.
// Run: node --experimental-strip-types --test tests/unit
import { test } from "node:test";
import assert from "node:assert";
import {
  formatPrice,
  formatWatts,
  formatScore,
  formatDate,
  formatAgo,
  CATEGORY_LABELS,
  USAGE_LABELS,
  normalizePhone,
  parseRuPhone,
  formatPhone,
} from "../../src/lib/format.ts";

test("formatPrice formats rubles with ru-RU grouping", () => {
  // ru-RU uses a non-breaking space (U+00A0) as the grouping separator.
  const p = formatPrice(139900);
  assert.ok(p.includes("₽"));
  assert.match(p, /139/);
  assert.match(p, /900/);
  const digits = p.replace(/\D/g, "");
  assert.equal(digits, "139900");
  assert.ok(p.includes("\u00A0"), "should contain non-breaking space grouping");
  assert.equal(formatPrice(0), `0${"\u00A0"}₽`);
});

test("formatWatts appends unit", () => {
  assert.equal(formatWatts(650), "650 Вт");
  assert.equal(formatWatts(0), "0 Вт");
});

test("formatScore compacts thousand+, keeps plain values", () => {
  assert.equal(formatScore(550), "550");
  assert.equal(formatScore(2512), "2.5 к");
  assert.equal(formatScore(12000), "12 к");
  assert.equal(formatScore(1000), "1.0 к");
});

test("formatDate produces a short ru-RU date", () => {
  const d = formatDate(new Date("2026-03-14T12:00:00Z").getTime());
  assert.match(d, /\d{1,2} мар/);
});

test("formatAgo returns humanized relative labels", () => {
  assert.equal(formatAgo(Date.now() - 30_000), "1 мин назад");
  assert.equal(formatAgo(Date.now() - 5 * 60_000), "5 мин назад");
  assert.equal(formatAgo(Date.now() - 3 * 3600_000), "3 ч назад");
  assert.equal(formatAgo(Date.now() - 5 * 24 * 3600_000), "5 дн назад");
  // Old timestamps fall back to an absolute date.
  const old = formatAgo(Date.now() - 60 * 24 * 3600_000);
  assert.match(old, /\d{1,2} (?:янв|фев|мар|[а-я]+)/);
});

test("CATEGORY_LABELS maps every category", () => {
  assert.equal(CATEGORY_LABELS.cpu, "Процессор");
  assert.equal(CATEGORY_LABELS.gpu, "Видеокарта");
  assert.equal(CATEGORY_LABELS.storage, "Накопитель");
  assert.equal(CATEGORY_LABELS.cooler, "Охлаждение");
});

test("USAGE_LABELS maps usages", () => {
  assert.equal(USAGE_LABELS.gaming, "Игры");
  assert.equal(USAGE_LABELS.universal, "Универсальный");
});

test("normalizePhone strips non-digits", () => {
  assert.equal(normalizePhone("+7 (900) 123-45-67"), "79001234567");
  assert.equal(normalizePhone("abc"), "");
});

test("parseRuPhone accepts 10-digit 9xx, 11-digit 7/8 prefixes", () => {
  assert.equal(parseRuPhone("900 123 45 67"), "79001234567");
  assert.equal(parseRuPhone("+7 900 123 45 67"), "79001234567");
  assert.equal(parseRuPhone("8 900 123 45 67"), "79001234567");
  assert.equal(parseRuPhone("7 900 123 45 67"), "79001234567");
  // Invalid inputs return null.
  assert.equal(parseRuPhone("123"), null);
  assert.equal(parseRuPhone("+375 29 123 45 67"), null);
  assert.equal(parseRuPhone(""), null);
});

test("formatPhone pretty-prints a normalized RU phone", () => {
  assert.equal(formatPhone("79001234567"), "+7 (900) 123-45-67");
  // Leading 8 is normalized to 7.
  assert.equal(formatPhone("89001234567"), "+7 (900) 123-45-67");
  // Non-normalized lengths are returned as-is.
  assert.equal(formatPhone("123"), "123");
  assert.equal(formatPhone("abc"), "abc");
});