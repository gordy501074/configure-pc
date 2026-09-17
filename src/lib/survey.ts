import type {
  ComponentCategory,
  Config,
  ConfigPart,
  Part,
  SurveyAnswers,
} from "../types";
import { uid } from "./session";

type Priority = SurveyAnswers["priority"];

const CATEGORY_ORDER: Record<ComponentCategory, number> = {
  cpu: 0,
  gpu: 1,
  motherboard: 2,
  ram: 3,
  storage: 4,
  case: 5,
  psu: 6,
  cooler: 7,
};

const EMPTY: Record<ComponentCategory, Part | null> = {
  cpu: null,
  gpu: null,
  motherboard: null,
  ram: null,
  storage: null,
  case: null,
  psu: null,
  cooler: null,
};

/** Pick the best part in a category by score (optionally filtered). */
function pick(
  category: ComponentCategory,
  components: Record<ComponentCategory, Part[]>,
  score: (p: Part) => number,
): Part | null {
  let best: Part | null = null;
  let bestScore = -Infinity;
  for (const p of components[category]) {
    const s = score(p);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

/** Score a part against budget & priority. */
function budgetScore(p: Part, budget: number, priority: Priority): number {
  if (p.price > budget) return -Infinity;
  const fit = 1 - Math.abs(budget - p.price) / Math.max(budget, 1);
  const perf = p.compat.benches?.[0]?.score ?? 0;
  if (priority === "price") return fit * 100;
  if (priority === "perf") return perf / 100;
  return fit * 100 + perf / 10000;
}

function parseRamGb(p: Part): number {
  const m = p.name.match(/(\d+)\s*ГБ/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Auto-build a configuration from survey answers.
 * Returns a full Config (source "auto") based on budget, usage, ecosystem, priority.
 */
export function buildRecommendation(
  answers: SurveyAnswers,
  components: Record<ComponentCategory, Part[]>,
): Config {
  const chosen: Record<ComponentCategory, Part | null> = { ...EMPTY };
  const { budget, usage, ecosystem: eco, priority } = answers;

  const cpuPool = components.cpu.filter(
    (p) =>
      eco === "intel"
        ? p.compat.socket === "LGA1700"
        : p.compat.socket !== "LGA1700",
  );
  chosen.cpu =
    pick(
      "cpu",
      components,
      (p) => (cpuPool.includes(p) ? budgetScore(p, budget * 0.28, priority) : -Infinity),
    ) ?? cpuPool[0] ?? components.cpu[0];

  if (chosen.cpu) {
    chosen.motherboard =
      components.motherboard.find((m) => m.compat.socket === chosen.cpu!.compat.socket) ?? null;
  }

  const ramTarget = budget >= 200000 && usage !== "work" ? 32 : 16;
  const ramPool = chosen.motherboard
    ? components.ram.filter(
        (r) =>
          r.compat.ramType === chosen.motherboard!.compat.ramType &&
          parseRamGb(r) >= ramTarget,
      )
    : components.ram;
  chosen.ram = pick("ram", components, (p) =>
    ramPool.includes(p) ? parseRamGb(p) : -Infinity,
  );

  const baseCost =
    (chosen.cpu?.price ?? 0) +
    (chosen.motherboard?.price ?? 0) +
    (chosen.ram?.price ?? 0);
  const gpuBudget = Math.max(0, budget - baseCost - 25000);
  chosen.gpu =
    pick(
      "gpu",
      components,
      (p) =>
        p.price <= gpuBudget
          ? (p.compat.benches?.[0]?.score ?? 0) * (priority === "price" ? 0.4 : 1)
          : -Infinity,
    ) ?? components.gpu[0];

  const storage = budget >= 150000 ? "ssd-2tb-nvme" : "ssd-1tb-nvme";
  chosen.storage =
    components.storage.find((p) => p.id === storage) ??
    components.storage.find((p) => p.id === "ssd-500gb-nvme") ??
    null;

  chosen.case =
    components.case.find(
      (c) => c.compat.formFactor === (chosen.motherboard?.compat.formFactor ?? "ATX"),
    ) ?? components.case[0];

  const partsPower = [chosen.cpu, chosen.gpu, chosen.motherboard, chosen.ram, chosen.storage]
    .filter((p): p is Part => !!p)
    .reduce((s, p) => s + p.tdp, 0);
  const need = partsPower * 1.6;
  const psuPool = components.psu; // include both ATX/SFX; pick by power below
  chosen.psu =
    psuPool.find((p) => (p.compat.power ?? 0) >= need) ?? psuPool[psuPool.length - 1] ?? null;

  if (chosen.cpu) {
    const tdp = chosen.cpu.tdp;
    const capable = components.cooler
      .filter((c) => (c.compat.coolTdp ?? 0) >= tdp)
      .sort((a, b) => a.price - b.price);
    if (priority === "silent") {
      const aio = capable.find((c) =>
        c.specs?.some((s) => s.label === "Тип" && s.value.includes("СЖО")),
      );
      chosen.cooler = aio ?? capable[0] ?? components.cooler[0];
    } else {
      chosen.cooler = capable[0] ?? components.cooler[0];
    }
  } else {
    chosen.cooler = components.cooler[0];
  }

  const parts: ConfigPart[] = (Object.keys(chosen) as ComponentCategory[])
    .filter((c) => chosen[c] !== null)
    .map((c) => ({ category: c, part: chosen[c]! }))
    .sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]);

  return {
    id: uid("cfg"),
    name: recommendationTitle(answers),
    parts,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: "auto",
    usage,
  };
}

/** Human title for the recommendation. */
export function recommendationTitle(answers: SurveyAnswers): string {
  const usageLabel: Record<string, string> = {
    gaming: "Игровой",
    work: "Офисный",
    video: "Монтажный",
    universal: "Универсальный",
  };
  const eco = answers.ecosystem === "intel" ? "Intel" : "AMD";
  return `${usageLabel[answers.usage] ?? "Сборка"} на ${eco}`;
}

/** Budget presets for the survey. */
export const BUDGET_PRESETS = [70000, 120000, 180000, 250000, 400000];

/** Return the recommended budget tier label. */
export function budgetTier(budget: number): string {
  if (budget <= 100000) return "Начальный";
  if (budget <= 180000) return "Оптимальный";
  if (budget <= 300000) return "Производительный";
  return "Премиум";
}

export { EMPTY };