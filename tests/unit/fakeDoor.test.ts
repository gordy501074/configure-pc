// @group unit
// Unit tests for fake-door pure logic: installment A/B assignment and the
// compare-selection toggle.
// Run: node --experimental-strip-types --test tests/unit
import { test } from "node:test";
import assert from "node:assert";
import {
  fnv1a,
  pickInstallmentScheme,
  INSTALLMENT_SCHEMES,
} from "../../src/lib/installmentAb.ts";
import { toggleCompare, MAX_COMPARE } from "../../src/lib/useCompare.ts";
import { FAKE_DOORS, isFakeDoorId } from "../../src/lib/analytics/fakeDoors.ts";

test("fnv1a is deterministic and 32-bit", () => {
  assert.equal(fnv1a("session-a"), fnv1a("session-a"));
  assert.notEqual(fnv1a("session-a"), fnv1a("session-b"));
  assert.ok(fnv1a("x") >= 0 && fnv1a("x") <= 0xffffffff);
});

test("pickInstallmentScheme is deterministic", () => {
  assert.equal(pickInstallmentScheme("abc"), pickInstallmentScheme("abc"));
});

test("pickInstallmentScheme yields both buckets across keys", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) seen.add(pickInstallmentScheme(`visitor-${i}`));
  assert.ok(seen.has("20-6"), "expected at least one 20-6 assignment");
  assert.ok(seen.has("50-12"), "expected at least one 50-12 assignment");
});

test("installment schemes map to registered fake door ids", () => {
  assert.ok(isFakeDoorId(INSTALLMENT_SCHEMES["20-6"].fakeDoorId));
  assert.ok(isFakeDoorId(INSTALLMENT_SCHEMES["50-12"].fakeDoorId));
  assert.equal(FAKE_DOORS.length, 3);
});

test("toggleCompare adds and removes ids", () => {
  assert.deepEqual(toggleCompare([], "a"), ["a"]);
  assert.deepEqual(toggleCompare(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleCompare(["a", "b"], "a"), ["b"]);
});

test("toggleCompare is idempotent for add/remove", () => {
  const once = toggleCompare(["a"], "b");
  // Adding an already-present id removes it (toggle semantics).
  assert.deepEqual(toggleCompare(once, "b"), ["a"]);
});

test("toggleCompare respects the max limit", () => {
  const full = ["a", "b", "c"];
  assert.equal(full.length, MAX_COMPARE);
  assert.deepEqual(toggleCompare(full, "d"), full);
  // Removing from a full list always works.
  assert.deepEqual(toggleCompare(full, "b"), ["a", "c"]);
});