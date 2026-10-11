// Deterministic AI-advisor engine (server + unit-tested).
//
// The LLM merely extracts structured requirements from the chat; this module
// turns them into a concrete recommendation using ONLY real catalog data and
// prices from the seller's active price list. It is intentionally self-contained
// (no value imports from `survey.ts`, which pulls in DOM-bound helpers) so it can
// run and be covered under native `node:test`.

import type {
  AdvisorRequirements,
  ComponentCategory,
  Config,
  ConfigPart,
  Part,
  ReadyPc,
  Usage,
} from "../types/index.ts";
import { CATEGORY_LABELS } from "./format.ts";

export interface AdvisorCatalog {
  /** Already-valid ready builds, live-priced. */
  ready: ReadyPc[];
  /** Orderable components per category. */
  parts: Record<ComponentCategory, Part[]>;
}

type AdvisorRecommendation =
  | { kind: "ready"; readyPc: ReadyPc; summary: string }
  | { kind: "custom"; config: Config; summary: string };

/** Max budget overrun for a ready build to still count as a fit. */
const READY_BUDGET_TOLERANCE = 1.15;

const CATEGORY_ORDER: ComponentCategory[] = [
  "cpu",
  "gpu",
  "motherboard",
  "ram",
  "storage",
  "case",
  "psu",
  "cooler",
];

/** True when a part is orderable (active/available and has a positive price). */
function isOrderable(p?: Part | null): boolean {
  if (!p) return false;
  if (p.available === false) return false;
  if (p.priceSet === true && (p.price === undefined || p.price <= 0)) return false;
  return (p.price ?? 0) > 0;
}

/** Normalize an LLM-extracted requirements object (types / enums / ranges). */
export function normalizeRequirements(raw: unknown): AdvisorRequirements {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out: AdvisorRequirements = {};

  const budget = src.budget ?? src.budgetRubles;
  if (typeof budget === "number" && Number.isFinite(budget) && budget > 0) {
    out.budget = Math.min(Math.round(budget), 10_000_000);
  } else if (typeof budget === "string") {
    const n = parseInt((budget as string).replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(n) && n > 0) out.budget = Math.min(n, 10_000_000);
  }

  const usage = src.usage;
  if (
    typeof usage === "string" &&
    ["gaming", "work", "video", "universal"].includes(usage)
  ) {
    out.usage = usage as Usage;
  }

  const ecosystem = src.ecosystem ?? src.platform;
  if (ecosystem === "intel" || ecosystem === "amd") {
    out.ecosystem = ecosystem;
  }

  const interests = Array.isArray(src.interests)
    ? src.interests
        .filter((i): i is string => typeof i === "string" && i.trim().length > 0)
        .map((i) => i.trim().slice(0, 100))
    : typeof src.interests === "string"
      ? src.interests
          .split(/[\n,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 20)
      : undefined;
  if (interests && interests.length > 0) out.interests = interests;

  const priorities = Array.isArray(src.priorities)
    ? src.priorities
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .map((p) => p.trim().slice(0, 60))
    : typeof src.priorities === "string"
      ? src.priorities
          .split(/[\n,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  if (priorities && priorities.length > 0) out.priorities = priorities;

  const buildType = src.buildType ?? src.build_type;
  if (buildType === "ready" || buildType === "custom") {
    out.buildType = buildType;
  }

  if (typeof src.notes === "string" && src.notes.trim()) {
    out.notes = src.notes.slice(0, 1000);
  }

  return out;
}

/** Map free-text interests/hobbies/priorities to a primary `Usage`. */
function usageFromInterests(req: AdvisorRequirements): Usage {
  if (req.usage) return req.usage;
  const haystack = ` ${[...(req.interests ?? []), ...(req.priorities ?? []), req.notes ?? ""]
    .join(" ")
    .toLowerCase()} `;
  const has = (...words: string[]) => words.some((w) => haystack.includes(w));
  if (has("монтаж", "рендер", "3d", "видео", "моделирование", "дизайнер", "blender", "монтажу")) {
    return "video";
  }
  if (has("игр", "гейм", "стрим", "киберспорт", "fortnite", "dota", "cs2", "streamer")) {
    return "gaming";
  }
  if (has("офис", "работа", "документ", "браузер", "учёба", "учёб", "программист", "программир")) {
    return "work";
  }
  return "universal";
}

function hasPriority(req: AdvisorRequirements, needle: string): boolean {
  const haystack = (req.priorities ?? []).join(" ").toLowerCase();
  return haystack.includes(needle.toLowerCase());
}

function resolvePriority(req: AdvisorRequirements): string {
  if (hasPriority(req, "тиш") || hasPriority(req, "тихий")) return "silent";
  if (hasPriority(req, "цена") || hasPriority(req, "дешев")) return "price";
  return "perf";
}

function numRamGb(p: Part): number {
  const m = p.name.match(/(\d+)\s*ГБ/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Score a part against a budget (closer to budget => better, strict cap). */
function budgetScore(p: Part, budget: number, priority: string): number {
  if (!isOrderable(p) || (p.price ?? 0) > budget) return -Infinity;
  const price = p.price ?? 0;
  const fit = 1 - Math.abs(budget - price) / Math.max(budget, 1);
  const perf = p.compat.benches?.[0]?.score ?? 0;
  if (priority === "price") return fit * 100;
  if (priority === "perf") return perf / 100;
  return fit * 100 + perf / 10000;
}

/** Pick a ready build by budget fit, usage match and priorities. */
export function rankReadyBuilds(
  ready: ReadyPc[],
  req: AdvisorRequirements,
): ReadyPc | null {
  const valid = ready.filter((pc) => pc.valid !== false && pc.price > 0);
  if (valid.length === 0) return null;

  const priority = resolvePriority(req);
  const usage = usageFromInterests(req);
  const budget = req.budget;

  let best: ReadyPc | null = null;
  let bestScore = -Infinity;
  for (const pc of valid) {
    let score = 0;
    if (pc.usage === usage) score += 60;
    else if (pc.usage === "universal") score += 20;

    if (budget !== undefined) {
      const delta = Math.abs(pc.price - budget);
      score += 40 * (1 - Math.min(delta, budget * 2) / Math.max(budget * 2, 1));
      if (pc.price > budget * 1.2) score -= 30;
      else if (pc.price > budget) score -= (pc.price - budget) / budget * 15;
    } else {
      score += 20;
      score -= pc.price / 1_000_000;
    }

    if (priority === "price") score -= pc.price / 500_000;
    if (priority === "silent") score -= pc.tdp / 2000;

    if (score > bestScore) {
      bestScore = score;
      best = pc;
    }
  }
  return best;
}

type Chosen = Record<ComponentCategory, Part | null>;

const price = (p: Part | null | undefined): number => p?.price ?? 0;
const perf = (p: Part): number => p.compat.benches?.[0]?.score ?? 0;
const cheapest = (parts: Part[]): Part | null =>
  parts.filter(isOrderable).sort((a, b) => price(a) - price(b))[0] ?? null;

/**
 * Assemble a full build around one CPU: cheapest compatible platform parts,
 * then the strongest GPU (with a PSU sized for it) that keeps the total
 * within budget. Returns the build and its total price.
 */
function assembleAround(
  cpu: Part | null,
  req: AdvisorRequirements,
  catalog: AdvisorCatalog,
  budget: number,
  /** Tight budget: settle for the cheapest drive. */
  economy = false,
): { chosen: Chosen; total: number } {
  const usage = usageFromInterests(req);
  const priority = resolvePriority(req);
  const chosen: Chosen = {
    cpu,
    gpu: null,
    motherboard: null,
    ram: null,
    storage: null,
    case: null,
    psu: null,
    cooler: null,
  };

  if (cpu) {
    chosen.motherboard = cheapest(
      catalog.parts.motherboard.filter((m) => m.compat.socket === cpu.compat.socket),
    );
  }

  const ramTarget = budget >= 200000 || usage === "video" || usage === "work" ? 32 : 16;
  const ramCompatible = chosen.motherboard
    ? catalog.parts.ram.filter((r) => r.compat.ramType === chosen.motherboard!.compat.ramType)
    : catalog.parts.ram;
  chosen.ram =
    cheapest(ramCompatible.filter((r) => numRamGb(r) >= ramTarget)) ??
    cheapest(ramCompatible) ??
    cheapest(catalog.parts.ram);

  const storageId = budget >= 150000 ? "ssd-2tb-nvme" : "ssd-1tb-nvme";
  chosen.storage =
    (economy ? cheapest(catalog.parts.storage) : null) ??
    catalog.parts.storage.find((p) => p.id === storageId && isOrderable(p)) ??
    catalog.parts.storage.find((p) => p.id === "ssd-1tb-nvme" && isOrderable(p)) ??
    cheapest(catalog.parts.storage) ??
    catalog.parts.storage[0] ??
    null;

  chosen.case =
    cheapest(
      catalog.parts.case.filter(
        (c) => c.compat.formFactor === (chosen.motherboard?.compat.formFactor ?? "ATX"),
      ),
    ) ??
    cheapest(catalog.parts.case) ??
    catalog.parts.case[0] ??
    null;

  if (cpu) {
    const capable = catalog.parts.cooler
      .filter((c) => isOrderable(c) && (c.compat.coolTdp ?? 0) >= cpu.tdp)
      .sort((a, b) => price(a) - price(b));
    const aio =
      priority === "silent"
        ? capable.find((c) =>
            c.specs?.some((s: { label: string; value: string }) => s.label === "Тип" && s.value.includes("СЖО")),
          )
        : undefined;
    chosen.cooler = aio ?? capable[0] ?? catalog.parts.cooler[0] ?? null;
  } else {
    chosen.cooler = catalog.parts.cooler[0] ?? null;
  }

  const psuFor = (gpu: Part | null): Part | null => {
    const load = [cpu, gpu, chosen.motherboard, chosen.ram, chosen.storage]
      .filter((p): p is Part => !!p)
      .reduce((s, p) => s + p.tdp, 0);
    return (
      cheapest(catalog.parts.psu.filter((p) => (p.compat.power ?? 0) >= load * 1.6)) ??
      catalog.parts.psu[catalog.parts.psu.length - 1] ??
      null
    );
  };
  const baseCost = [cpu, chosen.motherboard, chosen.ram, chosen.storage, chosen.case, chosen.cooler]
    .reduce((s, p) => s + price(p), 0);

  // Strongest GPU first (cheapest first when price is the priority); the
  // first one whose build fits the budget wins, else the cheapest overall.
  const gpus = catalog.parts.gpu
    .filter(isOrderable)
    .sort((a, b) => (priority === "price" ? price(a) - price(b) : perf(b) - perf(a)));
  let best: { gpu: Part | null; psu: Part | null; total: number } | null = null;
  for (const gpu of gpus.length ? gpus : [null]) {
    const psu = psuFor(gpu);
    const total = baseCost + price(gpu) + price(psu);
    if (total <= budget) {
      best = { gpu, psu, total };
      break;
    }
    if (!best || total < best.total) best = { gpu, psu, total };
  }
  chosen.gpu = best?.gpu ?? null;
  chosen.psu = best?.psu ?? null;
  return { chosen, total: best?.total ?? baseCost };
}

/**
 * Build a custom config that fits the budget: tries CPUs from the best fit
 * for ~28% of the budget downwards, assembling a full build around each, and
 * takes the first one within budget (else the cheapest build found).
 */
export function buildAdvisorConfig(
  req: AdvisorRequirements,
  catalog: AdvisorCatalog,
): Config {
  const usage = usageFromInterests(req);
  const priority = resolvePriority(req);
  const budget = req.budget ?? 250_000;
  const ecosystem = req.ecosystem ?? "amd";

  const ecoPool = catalog.parts.cpu.filter((p) =>
    ecosystem === "intel" ? p.compat.socket === "LGA1700" : p.compat.socket !== "LGA1700",
  );
  const cpuPool = (ecoPool.length ? ecoPool : catalog.parts.cpu).filter(isOrderable);
  const score = (p: Part) => budgetScore(p, budget * 0.28, priority);
  // Best-scoring CPUs within the CPU share first; over-share ones cheapest first.
  const cpus = [...cpuPool].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa === -Infinity && sb === -Infinity) return price(a) - price(b);
    return sb - sa;
  });

  let build: { chosen: Chosen; total: number } | null = null;
  search: for (const economy of [false, true]) {
    for (const cpu of cpus.length ? cpus : [catalog.parts.cpu[0] ?? null]) {
      const candidate = assembleAround(cpu, req, catalog, budget, economy);
      if (candidate.total <= budget) {
        build = candidate;
        break search;
      }
      if (!build || candidate.total < build.total) build = candidate;
    }
  }
  const chosen = build!.chosen;

  const parts = CATEGORY_ORDER.filter((c) => chosen[c] !== null).map((c) => ({
    category: c,
    part: chosen[c] as Part,
  }));

  return {
    id: `cfg-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: advisorTitle(req, usage),
    parts,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: "auto",
    usage,
  };
}

/** Human title for an AI-advisor config. */
function advisorTitle(req: AdvisorRequirements, usage?: Usage): string {
  const usageLabel: Record<string, string> = {
    gaming: "Игровой",
    work: "Офисный",
    video: "Монтажный",
    universal: "Универсальный",
  };
  const u = usage ?? usageFromInterests(req);
  const eco = req.ecosystem;
  return `${usageLabel[u] ?? "Сборка"}${eco ? ` на ${eco === "intel" ? "Intel" : "AMD"}` : ""} (AI)`;
}

/** Build a human summary for a ready recommendation. */
function readySummary(pc: ReadyPc): string {
  return `${pc.name} — ${pc.summary} (≈${new Intl.NumberFormat("ru-RU").format(pc.price)} ₽ по активному прайсу).`;
}

/**
 * True when a ready build genuinely fits: valid, within budget (overrun up to
 * ×1.15) and matching the use-case (or universal). No budget → no fit.
 */
export function readyBuildFits(pc: ReadyPc, req: AdvisorRequirements): boolean {
  if (pc.valid === false || pc.price <= 0) return false;
  if (req.budget === undefined) return false;
  if (pc.price > req.budget * READY_BUDGET_TOLERANCE) return false;
  const usage = usageFromInterests(req);
  return pc.usage === usage || pc.usage === "universal";
}

/** Plain-text parts list with prices and a total (shown in the chat). */
export function formatPartsText(parts: ConfigPart[]): string {
  const fmt = (v: number) => `${new Intl.NumberFormat("ru-RU").format(v)} ₽`;
  const lines = parts.map(({ category, part }) => {
    const label = CATEGORY_LABELS[category] ?? category;
    return part ? `• ${label}: ${part.name} — ${fmt(part.price ?? 0)}` : `• ${label}: недоступен`;
  });
  const total = parts.reduce((s, p) => s + (p.part?.price ?? 0), 0);
  return `${lines.join("\n")}\nИтого: ${fmt(total)}`;
}

/**
 * Top-level entry point. By default builds a custom config from parts within
 * the budget. Only an explicit `buildType: "ready"` picks a ready build
 * (fitting ones first, else the best overall).
 */
export function recommend(
  req: AdvisorRequirements,
  catalog: AdvisorCatalog,
): AdvisorRecommendation {
  let ready: ReadyPc | null = null;
  if (req.buildType === "ready") {
    const fitting = catalog.ready.filter((pc) => readyBuildFits(pc, req));
    ready = rankReadyBuilds(fitting, req) ?? rankReadyBuilds(catalog.ready, req);
  }
  if (ready) {
    return { kind: "ready", readyPc: ready, summary: readySummary(ready) };
  }
  const config = buildAdvisorConfig(req, catalog);
  return { kind: "custom", config, summary: advisorTitle(req, config.usage) };
}