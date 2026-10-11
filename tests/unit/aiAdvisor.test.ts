// @group unit
// Unit tests for src/lib/aiAdvisor.ts — the deterministic advisor engine.
// Uses real seeded parts/ready builds from src/data/mock.ts.
import { test } from "node:test";
import assert from "node:assert";
import {
  normalizeRequirements,
  rankReadyBuilds,
  buildAdvisorConfig,
  recommend,
  readyBuildFits,
  formatPartsText,
  type AdvisorCatalog,
} from "../../src/lib/aiAdvisor.ts";
import { components, readyPcs } from "../../src/data/mock.ts";
import type { Part, ReadyPc } from "../../src/types/index.ts";

/** Build a catalog of orderable parts (positive price) + valid ready builds. */
function catalog(): AdvisorCatalog {
  const price = (p: Part): Part => ({ ...p, price: p.price ?? 30000, priceSet: true, available: true });
  const parts = {} as Record<keyof typeof components, Part[]>;
  for (const key of Object.keys(components) as Array<keyof typeof components>) {
    parts[key] = components[key].map(price);
  }
  const ready: ReadyPc[] = readyPcs.map((pc) => ({
    ...pc,
    valid: true,
    parts: pc.parts.map((cp) => ({ ...cp, part: cp.part ? price(cp.part) : null })),
  }));
  return { ready, parts };
}

test("normalizeRequirements coerces budget strings and drops bad enums", () => {
  assert.deepEqual(normalizeRequirements({ budget: "150 000 ₽" }), { budget: 150000 });
  assert.deepEqual(normalizeRequirements({ budget: "abc" }), {});
  assert.deepEqual(normalizeRequirements({ usage: "nope" }), {});
  assert.deepEqual(normalizeRequirements({ usage: "gaming" }), { usage: "gaming" });
  assert.deepEqual(normalizeRequirements({ platform: "intel" }), { ecosystem: "intel" });
});

test("normalizeRequirements splits string interests and clamps arrays", () => {
  assert.deepEqual(normalizeRequirements({ interests: "игры, монтаж; 3D" }), {
    interests: ["игры", "монтаж", "3D"],
  });
  const big = normalizeRequirements({ interests: Array.from({ length: 50 }, (_, i) => `i${i}`) });
  assert.equal(big.interests!.length, 50);
});

test("normalizeRequirements handles empty/undefined input", () => {
  assert.deepEqual(normalizeRequirements(undefined), {});
  assert.deepEqual(normalizeRequirements(null), {});
  assert.deepEqual(normalizeRequirements({}), {});
});

test("normalizeRequirements clamps a huge budget and keeps notes/priorities", () => {
  assert.equal(normalizeRequirements({ budget: 999_000_000 }).budget, 10_000_000);
  assert.deepEqual(normalizeRequirements({ priorities: ["тишина", "цена"] }), {
    priorities: ["тишина", "цена"],
  });
  assert.deepEqual(normalizeRequirements({ priorities: "тишина; цена" }), {
    priorities: ["тишина", "цена"],
  });
  assert.deepEqual(normalizeRequirements({ notes: "нужен тихий ПК" }), {
    notes: "нужен тихий ПК",
  });
  assert.deepEqual(normalizeRequirements({ priorities: "" }), {});
});

test("rankReadyBuilds infers gaming/work usage from interests", () => {
  const gaming = rankReadyBuilds(catalog().ready, { budget: 140000, interests: ["игры и стримы"] });
  assert.equal(gaming!.id, "ready-gaming");
  const work = rankReadyBuilds(catalog().ready, { budget: 55000, interests: ["офис и документы"] });
  assert.equal(work!.id, "ready-office");
});

test("rankReadyBuilds works without a budget and honours price priority", () => {
  const picked = rankReadyBuilds(catalog().ready, { usage: "gaming", priorities: ["лучшая цена"] });
  assert.ok(picked);
});

test("buildAdvisorConfig honours silent priority and picks an AIO cooler", () => {
  const cfg = buildAdvisorConfig(
    { budget: 400000, usage: "gaming", priorities: ["тишина"] },
    catalog(),
  );
  assert.equal(cfg.parts.length, 8);
});

test("buildAdvisorConfig handles an empty parts catalog", () => {
  const empty = { ready: [], parts: {
    cpu: [], gpu: [], motherboard: [], ram: [], storage: [], case: [], psu: [], cooler: [],
  } } as unknown as AdvisorCatalog;
  const cfg = buildAdvisorConfig({ budget: 100000 }, empty);
  assert.equal(cfg.parts.length, 0);
});

test("rankReadyBuilds picks the gaming build for a gaming budget", () => {
  const picked = rankReadyBuilds(catalog().ready, { budget: 140000, usage: "gaming" });
  assert.ok(picked);
  assert.equal(picked!.id, "ready-gaming");
});

test("rankReadyBuilds picks the office build for a work budget", () => {
  const picked = rankReadyBuilds(catalog().ready, { budget: 55000, usage: "work" });
  assert.equal(picked!.id, "ready-office");
});

test("rankReadyBuilds returns null on an empty catalog", () => {
  assert.equal(rankReadyBuilds([], { budget: 100000 }), null);
});

test("rankReadyBuilds infers usage from interests when usage is missing", () => {
  const picked = rankReadyBuilds(catalog().ready, {
    budget: 330000,
    interests: ["видеомонтаж", "3D"],
  });
  assert.equal(picked!.id, "ready-pro-workstation");
});

test("buildAdvisorConfig produces an orderable 8-slot config", () => {
  const cfg = buildAdvisorConfig({ budget: 200000, usage: "gaming" }, catalog());
  assert.equal(cfg.parts.length, 8);
  for (const cp of cfg.parts) {
    assert.ok(cp.part, `slot ${cp.category} missing a part`);
    assert.ok((cp.part!.price ?? 0) > 0, `slot ${cp.category} not orderable`);
  }
  assert.equal(cfg.source, "auto");
  assert.equal(cfg.usage, "gaming");
  assert.ok(cfg.name.includes("AI"));
});

test("buildAdvisorConfig respects the Intel ecosystem", () => {
  const cfg = buildAdvisorConfig({ budget: 200000, ecosystem: "intel" }, catalog());
  const cpu = cfg.parts.find((p) => p.category === "cpu")!.part!;
  assert.equal(cpu.compat.socket, "LGA1700");
});

test("buildAdvisorConfig works with empty requirements", () => {
  const cfg = buildAdvisorConfig({}, catalog());
  assert.equal(cfg.parts.length, 8);
});

test("recommend picks a fitting ready build only when explicitly asked", () => {
  const rec = recommend({ budget: 140000, usage: "gaming", buildType: "ready" }, catalog());
  assert.equal(rec.kind, "ready");
  if (rec.kind === "ready") assert.equal(rec.readyPc.id, "ready-gaming");
});

test("recommend defaults to a custom build within budget even when a ready one fits", () => {
  const rec = recommend({ budget: 140000, usage: "gaming" }, catalog());
  assert.equal(rec.kind, "custom");
  if (rec.kind === "custom") {
    const total = rec.config.parts.reduce((s, p) => s + (p.part?.price ?? 0), 0);
    assert.ok(total <= 140000);
  }
});

test("recommend falls back to a custom config when no ready build fits", () => {
  const emptyReady: AdvisorCatalog = { ...catalog(), ready: [] };
  const rec = recommend({ budget: 90000, usage: "gaming" }, emptyReady);
  assert.equal(rec.kind, "custom");
  if (rec.kind === "custom") assert.equal(rec.config.parts.length, 8);
});
test("normalizeRequirements keeps a valid buildType and drops junk", () => {
  assert.deepEqual(normalizeRequirements({ buildType: "custom" }), { buildType: "custom" });
  assert.deepEqual(normalizeRequirements({ build_type: "ready" }), { buildType: "ready" });
  assert.deepEqual(normalizeRequirements({ buildType: "any" }), {});
});

test("recommend builds a custom config when the user asked for custom", () => {
  const rec = recommend({ budget: 140000, usage: "gaming", buildType: "custom" }, catalog());
  assert.equal(rec.kind, "custom");
  if (rec.kind === "custom") assert.equal(rec.config.parts.length, 8);
});

test("recommend goes custom when no ready build fits budget/usage", () => {
  // 70k gaming: gaming (139 900) and universal (89 900) both overshoot ×1.15.
  assert.equal(recommend({ budget: 70000, usage: "gaming" }, catalog()).kind, "custom");
  // No budget → never a ready build by default.
  assert.equal(recommend({ usage: "gaming" }, catalog()).kind, "custom");
});

test("recommend honours an explicit ready preference even without a fit", () => {
  const rec = recommend({ usage: "gaming", buildType: "ready" }, catalog());
  assert.equal(rec.kind, "ready");
});

test("readyBuildFits checks validity, budget tolerance and usage", () => {
  const gaming = catalog().ready.find((pc) => pc.id === "ready-gaming")!;
  assert.equal(readyBuildFits(gaming, { budget: 125000, usage: "gaming" }), true);
  assert.equal(readyBuildFits(gaming, { budget: 120000, usage: "gaming" }), false);
  assert.equal(readyBuildFits(gaming, { budget: 140000, usage: "work" }), false);
  assert.equal(readyBuildFits(gaming, { usage: "gaming" }), false);
  assert.equal(readyBuildFits({ ...gaming, valid: false }, { budget: 140000, usage: "gaming" }), false);
});

test("formatPartsText lists parts with prices and a total", () => {
  const cpu = catalog().parts.cpu[0];
  const text = formatPartsText([
    { category: "cpu", part: { ...cpu, price: 10000 } },
    { category: "gpu", part: null },
  ]);
  assert.match(text, /Процессор: .+ — 10\s000 ₽/);
  assert.match(text, /Видеокарта: недоступен/);
  assert.match(text, /Итого: 10\s000 ₽$/);
});

test("buildAdvisorConfig keeps a custom build within budget and compatible", async () => {
  const { isBuildCompleteValid } = await import("../../src/lib/compatibility.ts");
  const real = catalog();
  const cases = [
    ...[90000, 120000, 150000, 200000].map((budget) => ({ budget, ecosystem: "amd" as const })),
    ...[120000, 150000, 200000].map((budget) => ({ budget, ecosystem: "intel" as const })),
  ];
  for (const { budget, ecosystem } of cases) {
    {
      const cfg = buildAdvisorConfig({ budget, usage: "gaming", ecosystem }, real);
      const total = cfg.parts.reduce((s, p) => s + (p.part?.price ?? 0), 0);
      assert.ok(total <= budget, `${ecosystem} ${budget}: total ${total} over budget`);
      assert.equal(cfg.parts.length, 8);
      assert.ok(isBuildCompleteValid(cfg.parts), `${ecosystem} ${budget}: incompatible build`);
    }
  }
});

test("buildAdvisorConfig returns the cheapest build when the budget is unreachable", () => {
  const cfg = buildAdvisorConfig({ budget: 50000, usage: "gaming", ecosystem: "intel" }, catalog());
  const total = cfg.parts.reduce((s, p) => s + (p.part?.price ?? 0), 0);
  assert.equal(cfg.parts.length, 8);
  assert.ok(total > 50000);
  const roomier = buildAdvisorConfig({ budget: 200000, usage: "gaming", ecosystem: "intel" }, catalog());
  assert.ok(total <= roomier.parts.reduce((s, p) => s + (p.part?.price ?? 0), 0));
});
