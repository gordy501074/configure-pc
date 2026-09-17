// @group unit
// Unit tests for src/lib/compatibility.ts — the compatibility/validation engine.
// Uses real seeded parts from src/data/mock.ts.
import { test } from "node:test";
import assert from "node:assert";
import {
  configStats,
  checkPartCompatibility,
  validateConfig,
  isConfigComplete,
  isPartAvailable,
} from "../../src/lib/compatibility.ts";
import { components } from "../../src/data/mock.ts";
import type { ComponentCategory, Part } from "../../src/types/index.ts";

const cat = (id: string): Part => {
  const lists = Object.values(components) as Part[][];
  const found = lists.flat().find((p) => p.id === id);
  if (!found) throw new Error(`part not found: ${id}`);
  return found;
};

const empty: Record<ComponentCategory, Part | null> = {
  cpu: null,
  gpu: null,
  motherboard: null,
  ram: null,
  storage: null,
  case: null,
  psu: null,
  cooler: null,
};

function chosen(overrides: Partial<Record<ComponentCategory, Part>>) {
  return { ...empty, ...overrides };
}

test("configStats sums price and tdp", () => {
  const s = configStats({
    parts: [
      { category: "cpu", part: cat("cpu-r5-5600") },
      { category: "gpu", part: cat("gpu-rx-7600") },
    ],
  });
  assert.equal(s.totalPrice, 12900 + 27900);
  assert.equal(s.totalTdp, 65 + 165);
});

test("empty/stub parts yield zero stats", () => {
  const s = configStats({ parts: [] });
  assert.deepEqual(s, { totalPrice: 0, totalTdp: 0 });
});

test("CPU <-> motherboard socket mismatch is flagged", () => {
  const issues = checkPartCompatibility(cat("cpu-r5-7600"), {
    ...chosen({ motherboard: cat("mb-b550-am4") }),
  });
  assert.ok(issues.some((i) => i.includes("Сокет процессора")));
});

test("matching CPU/motherboard socket passes", () => {
  const issues = checkPartCompatibility(cat("cpu-r5-7600"), {
    ...chosen({ motherboard: cat("mb-b650-am5") }),
  });
  assert.equal(issues.some((i) => i.includes("Сокет процессора")), false);
});

test("CPU <-> cooler TDP: under-spec cooler flagged when cpu chosen", () => {
  // cpu-r5-5600 tdp 65 < cooler-air-budget coolTdp 150 -> no issue.
  const ok = checkPartCompatibility(cat("cooler-air-budget"), {
    ...chosen({ cpu: cat("cpu-r5-5600") }),
  });
  assert.equal(ok.some((i) => i.includes("Кулер рассчитан")), false);
  // cpu-r9-7950x tdp 170 > cooler-air-budget coolTdp 150 -> flagged.
  const bad = checkPartCompatibility(cat("cooler-air-budget"), {
    ...chosen({ cpu: cat("cpu-r9-7950x") }),
  });
  assert.ok(bad.some((i) => i.includes("Кулер рассчитан")));
});

test("motherboard <-> RAM type mismatch is flagged", () => {
  const issues = checkPartCompatibility(cat("ram-ddr4-16"), {
    ...chosen({ motherboard: cat("mb-b650-am5") }),
  });
  assert.ok(issues.some((i) => i.includes("Плата поддерживает")));
});

test("motherboard candidate with cpu+ram chosen passes through", () => {
  // The engine intentionally leaves the cpu/motherboard/ram cross-check to final
  // validation; checking a motherboard candidate with a cpu and ram already set
  // must not crash and uses the candidate as the motherboard.
  const issues = checkPartCompatibility(cat("mb-b650-am5"), {
    ...chosen({ cpu: cat("cpu-r5-7600"), ram: cat("ram-ddr5-32") }),
  });
  // No issue for the mb/ram pair (both DDR5).
  assert.equal(issues.some((i) => i.includes("Плата поддерживает")), false);
});

test("case <-> motherboard form factor: larger board in smaller case flagged", () => {
  // ITX case cannot fit ATX board.
  const issues = checkPartCompatibility(cat("mb-z790-intel"), {
    ...chosen({ case: cat("case-sfx-itx") }),
  });
  assert.ok(issues.some((i) => i.includes("Форм-фактор платы")));
  // ATX case fits mATX board.
  const ok = checkPartCompatibility(cat("mb-b650-am5"), {
    ...chosen({ case: cat("case-atx-tower") }),
  });
  assert.equal(ok.some((i) => i.includes("Форм-фактор платы")), false);
});

test("case <-> GPU length: too-long GPU flagged", () => {
  const issues = checkPartCompatibility(cat("gpu-rtx-4080-super"), {
    ...chosen({ case: cat("case-sfx-itx") }),
  });
  assert.ok(issues.some((i) => i.includes("Видеокарта длиной")));
});

test("case <-> cooler height: tower cooler taller than case flagged", () => {
  const issues = checkPartCompatibility(cat("cooler-air"), {
    ...chosen({ case: cat("case-sfx-itx") }),
  });
  // cooler-air sizeMm 165 > case-sfx-itx cpuCoolerMaxHeight 155.
  assert.ok(issues.some((i) => i.includes("Высота кулера")));
  // Short AIO (sizeMm 52), even with a small case, is not flagged.
  const ok = checkPartCompatibility(cat("cooler-aio-240"), {
    ...chosen({ case: cat("case-sfx-itx") }),
  });
  assert.equal(ok.some((i) => i.includes("Высота кулера")), false);
});

test("PSU power headroom: under-powered PSU flagged", () => {
  const issues = checkPartCompatibility(cat("psu-650"), {
    ...chosen({ cpu: cat("cpu-r9-7950x"), gpu: cat("gpu-rtx-4080-super") }),
  });
  assert.ok(issues.some((i) => i.includes("Мощности БП")));
});

test("PSU form factor: non-SFX PSU in ITX case flagged", () => {
  const issues = checkPartCompatibility(cat("psu-650"), {
    ...chosen({ case: cat("case-sfx-itx") }),
  });
  assert.ok(issues.some((i) => i.includes("SFX")));
  const ok = checkPartCompatibility(cat("psu-600-sfx"), {
    ...chosen({ case: cat("case-sfx-itx") }),
  });
  assert.equal(ok.some((i) => i.includes("SFX")), false);
});

test("a fully compatible config yields no issues", () => {
  const issues = checkPartCompatibility(cat("cpu-r7-7800x3d"), {
    ...chosen({
      cpu: cat("cpu-r7-7800x3d"),
      motherboard: cat("mb-b650-am5"),
      gpu: cat("gpu-rtx-4070-super"),
      ram: cat("ram-ddr5-32"),
      cooler: cat("cooler-air"),
      psu: cat("psu-750"),
    }),
  });
  // A single component check may still produce complaints depending on the
  // ordering, but a fully-compatible set must produce none for the CPU.
  assert.equal(issues.length, 0);
});

test("validateConfig keys issues by category/part", () => {
  // cpu-r5-7600 (AM5) vs mb-b550-am4 (AM4) -> socket mismatch on cpu.
  const issues = validateConfig(
    chosen({
      cpu: cat("cpu-r5-7600"),
      motherboard: cat("mb-b550-am4"),
      cooler: cat("cooler-air-budget"),
    }),
  );
  assert.ok(issues.length >= 1);
  const cpuSocket = issues.find((i) => i.category === "cpu");
  assert.ok(cpuSocket);
  assert.equal(cpuSocket?.partId, "cpu-r5-7600");
  assert.match(cpuSocket?.reason ?? "", /Сокет/);
});

test("isPartAvailable defaults true and respects the available flag", () => {
  const base = cat("cpu-r5-5600");
  assert.equal(isPartAvailable(base), true);
  assert.equal(isPartAvailable({ ...base, available: true }), true);
  assert.equal(isPartAvailable({ ...base, available: false }), false);
});

test("configStats counts only available parts", () => {
  const cpu = cat("cpu-r5-5600");
  const gpu = cat("gpu-rx-7600");
  const s = configStats({
    parts: [
      { category: "cpu", part: { ...cpu, available: false } },
      { category: "gpu", part: gpu },
    ],
  });
  assert.equal(s.totalPrice, gpu.price);
  assert.equal(s.totalTdp, gpu.tdp);
});

test("configStats skips null parts (missing/inaccessible slots)", () => {
  const cpu = cat("cpu-r5-5600");
  const s = configStats({
    parts: [
      { category: "cpu", part: cpu },
      { category: "gpu", part: null },
    ],
  });
  assert.equal(s.totalPrice, cpu.price);
  assert.equal(s.totalTdp, cpu.tdp);
});

test("isConfigComplete is false when a chosen part is unavailable", () => {
  const base = chosen({
    cpu: cat("cpu-r5-5600"),
    gpu: cat("gpu-rx-7600"),
    motherboard: cat("mb-b550-am4"),
    ram: cat("ram-ddr4-16"),
    storage: cat("ssd-1tb-nvme"),
    case: cat("case-matx"),
    psu: cat("psu-650"),
    cooler: cat("cooler-air"),
  });
  assert.equal(isConfigComplete(base), true);
  assert.equal(
    isConfigComplete({ ...base, cpu: { ...base.cpu!, available: false } }),
    false,
  );
});
  test("isConfigComplete requires all mandatory categories and clean validation", () => {
  assert.equal(isConfigComplete(chosen({})), false);
  assert.equal(isConfigComplete(chosen({ cpu: cat("cpu-r5-5600") })), false);
  // Full incompatible config (mismatched socket) is not complete.
  assert.equal(
    isConfigComplete(
      chosen({
        cpu: cat("cpu-r5-7600"),
        gpu: cat("gpu-rx-7600"),
        motherboard: cat("mb-b550-am4"),
        ram: cat("ram-ddr4-16"),
        storage: cat("ssd-1tb-nvme"),
        case: cat("case-matx"),
        psu: cat("psu-650"),
        cooler: cat("cooler-air"),
      }),
    ),
    false,
  );
  // Full, compatible config is complete.
  assert.equal(
    isConfigComplete(
      chosen({
        cpu: cat("cpu-r5-5600"),
        gpu: cat("gpu-rx-7600"),
        motherboard: cat("mb-b550-am4"),
        ram: cat("ram-ddr4-16"),
        storage: cat("ssd-1tb-nvme"),
        case: cat("case-matx"),
        psu: cat("psu-650"),
        cooler: cat("cooler-air"),
      }),
    ),
    true,
  );
});