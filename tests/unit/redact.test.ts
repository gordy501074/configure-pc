// @group unit
// Unit tests for src/lib/analytics/redact.ts — PII/secret scrubbing.
import { test } from "node:test";
import assert from "node:assert";
import { redact, redactUrl } from "../../src/lib/analytics/redact.ts";

test("redact leaves null/undefined/numbers/booleans untouched", () => {
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
  assert.equal(redact(42), 42);
  assert.equal(redact(true), true);
  assert.equal(redact(false), false);
  // Other primitives (bigint) are returned as-is.
  assert.equal(String(redact(10n)), "10");
});

test("redact scrubs emails from strings", () => {
  const out = redact("contact avgordeev@alfabank.ru now");
  assert.ok(!out.includes("avgordeev@alfabank.ru"));
  assert.ok(out.includes("…@…"));
});

test("redact scrubs phone-like numbers from strings", () => {
  const out = redact("call +7 900 123 45 67 now");
  assert.ok(!out.includes("900"));
  assert.ok(out.includes("***"));
});

test("redact scrubs JWT/Bearer/api tokens from strings", () => {
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.some.payload";
  const out = redact(`token ${jwt}`);
  assert.ok(!out.includes(jwt));
  const bearer = redact("Bearer abcdefghijklmnopqrstuvwxyz123456");
  assert.ok(!bearer.includes("Bearer abc"));
});

test("redact replaces known PII keys with [REDACTED]", () => {
  const out = redact({
    email: "a@b.com",
    password: "secret",
    token: "xyz",
    phone: "79001234567",
    name: "Иван",
  }) as Record<string, string>;
  assert.equal(out.email, "[REDACTED]");
  assert.equal(out.password, "[REDACTED]");
  assert.equal(out.token, "[REDACTED]");
  assert.equal(out.phone, "[REDACTED]");
  assert.equal(out.name, "Иван");
});

test("redact handles case-insensitive + substring keys", () => {
  const out = redact({
    Authorization: "Bearer x",
    my_password_value: "pw",
    accessToken: "t",
    fine: "ok",
  }) as Record<string, string>;
  assert.equal(out.Authorization, "[REDACTED]");
  assert.equal(out.my_password_value, "[REDACTED]");
  assert.equal(out.accessToken, "[REDACTED]");
  assert.equal(out.fine, "ok");
});

test("redact recurses into nested objects and arrays", () => {
  const out = redact({
    nested: { email: "x@y.z", ok: 1 },
    list: ["safe", { password: "pw" }],
  }) as { nested: Record<string, unknown>; list: unknown[] };
  assert.equal(out.nested.email, "[REDACTED]");
  assert.equal(out.nested.ok, 1);
  assert.equal(out.list[0], "safe");
  assert.equal((out.list[1] as Record<string, string>).password, "[REDACTED]");
});

test("redactUrl strips PII query params and host, keeps path", () => {
  // access_token (contains "token") is removed; theme (safe) is kept.
  const out = redactUrl("https://example.com/config?userId=abc&theme=dark&access_token=s3cret");
  assert.ok(!out.includes("example.com"), "host removed");
  assert.ok(!out.includes("access_token"), "token param removed");
  assert.ok(out.startsWith("/config"), `path kept: ${out}`);
  assert.ok(out.includes("theme=dark"), `safe param kept: ${out}`);
});

test("redactUrl removes code/phone/email params, keeps path", () => {
  const out = redactUrl("https://example.com/login?code=1234&phone=79001234567&email=a@b.com&ok=1");
  assert.ok(out.startsWith("/login"), `path kept: ${out}`);
  assert.ok(!out.includes("code="), `code removed: ${out}`);
  assert.ok(!out.includes("phone="), `phone removed: ${out}`);
  assert.ok(!out.includes("email="), `email removed: ${out}`);
  assert.ok(out.includes("ok=1"), `safe param kept: ${out}`);
});

test("redactUrl falls back to path on non-parseable input", () => {
  // A relative input is re-parsed against a base host so the output is a clean path.
  const out = redactUrl("/settings?theme=dark");
  assert.ok(out.startsWith("/settings"), `path kept: ${out}`);
  assert.ok(out.includes("theme=dark"), `safe param kept: ${out}`);
  // Non-string-like input is stringified into a path segment token.
  const undef = redactUrl(undefined as unknown as string);
  assert.ok(undef.length > 0);
});

test("redactUrl returns path-only for a malformed URL", () => {
  const out = redactUrl("http://[::1?token=abc");
  // Malformed -> catch branch keeps only the leading path segment.
  assert.ok(!out.includes("token"));
});