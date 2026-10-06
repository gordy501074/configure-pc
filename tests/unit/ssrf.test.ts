// @group unit
// Unit tests for the SSRF download guard: scheme/host policy and IP-range
// classification. No network access is required (literal IPs skip DNS).
import { test } from "node:test";
import assert from "node:assert";
import {
  assertUrlSafeForDownload,
  isBlockedHostname,
  isPrivateIp,
  isPrivateIpv4,
  isPrivateIpv6,
  validateImageUrl,
} from "../../src/server/ai/ssrf.ts";
import { extractOgImage } from "../../src/server/ai/component-ai.ts";
import { matchesMagic } from "../../src/server/image-magic.ts";

test("validateImageUrl accepts a public https URL", () => {
  assert.equal(validateImageUrl("https://images.example.com/a.png").hostname, "images.example.com");
});

test("validateImageUrl rejects non-https and malformed URLs", () => {
  assert.throws(() => validateImageUrl("http://example.com/a.png"), /insecure_url/);
  assert.throws(() => validateImageUrl("file:///etc/passwd"), /insecure_url/);
  assert.throws(() => validateImageUrl("data:image/png;base64,AAAA"), /insecure_url/);
  assert.throws(() => validateImageUrl("not a url"), /invalid_url/);
});

test("validateImageUrl rejects embedded credentials", () => {
  assert.throws(() => validateImageUrl("https://user:pass@example.com/a.png"), /invalid_url/);
});

test("validateImageUrl rejects internal hostnames", () => {
  assert.throws(() => validateImageUrl("https://localhost/a.png"), /blocked_host/);
  assert.throws(() => validateImageUrl("https://metadata.google.internal/a"), /blocked_host/);
  assert.throws(() => validateImageUrl("https://db.internal/a.png"), /blocked_host/);
});

test("validateImageUrl rejects literal private/loopback/metadata IPv4", () => {
  assert.throws(() => validateImageUrl("https://127.0.0.1/a.png"), /blocked_ip/);
  assert.throws(() => validateImageUrl("https://10.0.0.5/a.png"), /blocked_ip/);
  assert.throws(() => validateImageUrl("https://192.168.1.1/a.png"), /blocked_ip/);
  assert.throws(() => validateImageUrl("https://169.254.169.254/latest/meta-data"), /blocked_ip/);
});

test("isPrivateIpv4 classifies ranges", () => {
  for (const ip of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.168.0.1", "224.0.0.1", "255.255.255.255"]) {
    assert.equal(isPrivateIpv4(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1"]) {
    assert.equal(isPrivateIpv4(ip), false, ip);
  }
});

test("isPrivateIpv6 classifies ranges", () => {
  for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "2001:db8::1"]) {
    assert.equal(isPrivateIpv6(ip), true, ip);
  }
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateIpv6(ip), false, ip);
  }
});

test("isPrivateIp dispatches by family", () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("8.8.8.8"), false);
});

test("isBlockedHostname flags localhost and internal suffixes", () => {
  assert.equal(isBlockedHostname("localhost"), true);
  assert.equal(isBlockedHostname("api.localhost"), true);
  assert.equal(isBlockedHostname("printer.local"), true);
  assert.equal(isBlockedHostname("svc.internal"), true);
  assert.equal(isBlockedHostname("images.example.com"), false);
});

test("assertUrlSafeForDownload rejects literal private IP without DNS", async () => {
  await assert.rejects(() => assertUrlSafeForDownload("https://127.0.0.1/a.png"), /blocked_ip/);
  await assert.rejects(() => assertUrlSafeForDownload("https://[::1]/a.png"), /blocked_ip/);
});

test("assertUrlSafeForDownload rejects insecure scheme without DNS", async () => {
  await assert.rejects(() => assertUrlSafeForDownload("http://example.com/a.png"), /insecure_url/);
});

test("matchesMagic detects supported raster formats and rejects others", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(matchesMagic(png, "png"), true);
  assert.equal(matchesMagic(png, "jpg"), false);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(matchesMagic(jpg, "jpg"), true);
  const gif = Buffer.from("GIF89a______", "latin1");
  assert.equal(matchesMagic(gif, "gif"), true);
  const webp = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBP", "latin1")]);
  assert.equal(matchesMagic(webp, "webp"), true);
  assert.equal(matchesMagic(Buffer.from("hello world!"), "png"), false);
});

test("extractOgImage finds og:image and twitter:image", () => {
  assert.equal(
    extractOgImage('<html><meta property="og:image" content="https://cdn.example.com/a.jpg"></html>'),
    "https://cdn.example.com/a.jpg",
  );
  assert.equal(
    extractOgImage('<head><meta content="https://x.com/b.png" property="og:image" /></head>'),
    "https://x.com/b.png",
  );
  assert.equal(
    extractOgImage('<meta name="twitter:image" content="https://t.co/c.webp">'),
    "https://t.co/c.webp",
  );
  assert.equal(
    extractOgImage('<meta property="og:image:secure_url" content="https://s.example.com/d.jpg">'),
    "https://s.example.com/d.jpg",
  );
  assert.equal(extractOgImage("<html>no image here</html>"), null);
  assert.equal(extractOgImage('<meta property="og:image" content="http://insecure.example.com/e.jpg">'), null);
});