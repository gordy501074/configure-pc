import type {
  ComponentCategory,
  Config,
  Part,
  PartIssue,
} from "../types";

export interface ConfigStats {
  totalPrice: number;
  totalTdp: number;
}

/** True when a part is orderable (not deactivated / unavailable). */
export function isPartAvailable(part: Part): boolean {
  return part.available !== false;
}

/** Sum price and power draw of a config (over available parts only). */
export function configStats(config: Pick<Config, "parts">): ConfigStats {
  let totalPrice = 0;
  let totalTdp = 0;
  for (const { part } of config.parts) {
    if (!part || !isPartAvailable(part)) continue;
    totalPrice += part.price;
    totalTdp += part.tdp;
  }
  return { totalPrice, totalTdp };
}

/**
 * Check placing `candidate` into `category`, given the parts already chosen.
 * Returns a list of human-readable compatibility issues (empty => compatible).
 * `allCategories` is the full list the user will fill (unchosen = null).
 */
export function checkPartCompatibility(
  candidate: Part,
  chosen: Record<ComponentCategory, Part | null>,
): string[] {
  const issues: string[] = [];
  const cpu = chosen.cpu ?? (candidate.category === "cpu" ? candidate : null);
  const motherboard =
    chosen.motherboard ?? (candidate.category === "motherboard" ? candidate : null);
  const ram = chosen.ram ?? (candidate.category === "ram" ? candidate : null);
  const psu = chosen.psu ?? (candidate.category === "psu" ? candidate : null);
  const pcCase =
    chosen.case ?? (candidate.category === "case" ? candidate : null);
  const cooler = chosen.cooler ?? (candidate.category === "cooler" ? candidate : null);
  const gpu = chosen.gpu ?? (candidate.category === "gpu" ? candidate : null);

  // --- CPU <-> Motherboard socket ---
  if (cpu && motherboard && cpu.compat.socket !== motherboard.compat.socket) {
    issues.push(
      `Сокет процессора ${cpu.compat.socket} не подходит к плате ${motherboard.compat.socket}.`,
    );
  }

  // --- CPU <-> cooler TDP ---
  if (
    cpu &&
    cooler &&
    (cooler.compat.coolTdp ?? 0) > 0 &&
    cpu.tdp > (cooler.compat.coolTdp ?? 0)
  ) {
    issues.push(
      `Кулер рассчитан на TDP ${cooler.compat.coolTdp} Вт, а процессор потребляет до ${cpu.tdp} Вт.`,
    );
  }

  // --- Motherboard <-> RAM type ---
  if (motherboard && ram && motherboard.compat.ramType !== ram.compat.ramType) {
    issues.push(
      `Плата поддерживает ${motherboard.compat.ramType}, а память — ${ram.compat.ramType}.`,
    );
  }

  // --- Case <-> motherboard form factor (case supports up to its own) ---
  if (pcCase && motherboard && pcCase.compat.formFactor) {
    const rank: Record<string, number> = { ITX: 1, mATX: 2, ATX: 3 };
    if (rank[motherboard.compat.formFactor ?? "ATX"] > rank[pcCase.compat.formFactor]) {
      issues.push(
        `Форм-фактор платы ${motherboard.compat.formFactor} не влезает в корпус ${pcCase.compat.formFactor}.`,
      );
    }
  }

  // --- Case <-> GPU length ---
  if (pcCase && gpu && gpu.compat.gpuLength && pcCase.compat.gpuLength) {
    if (gpu.compat.gpuLength > pcCase.compat.gpuLength) {
      issues.push(
        `Видеокарта длиной ${gpu.compat.gpuLength} мм не влезает в корпус (до ${pcCase.compat.gpuLength} мм).`,
      );
    }
  }

  // --- Case <-> cooler height (tower air coolers only) ---
  if (
    pcCase &&
    cooler &&
    cooler.compat.sizeMm &&
    pcCase.compat.cpuCoolerMaxHeight &&
    cooler.compat.sizeMm > 100
  ) {
    if (cooler.compat.sizeMm > pcCase.compat.cpuCoolerMaxHeight) {
      issues.push(
        `Высота кулера ${cooler.compat.sizeMm} мм не влезает в корпус (до ${pcCase.compat.cpuCoolerMaxHeight} мм).`,
      );
    }
  }

  // --- PSU power headroom ---
  const othersTdp = [cpu, gpu, motherboard, ram, cooler]
    .filter((p): p is Part => !!p)
    .filter((p) => p.id !== psu?.id)
    .reduce((sum, p) => sum + p.tdp, 0);
  if (psu && psu.compat.power) {
    if (psu.compat.power < othersTdp * 1.6) {
      issues.push(
        `Мощности БП ${psu.compat.power} Вт недостаточно для остальных компонентов (потребление ~${Math.round(othersTdp * 1.6)} Вт с запасом).`,
      );
    }
  }

  // --- PSU form factor vs case ---
  if (psu && pcCase && pcCase.compat.formFactor === "ITX") {
    if (psu.compat.psuForm !== "SFX") {
      issues.push("Для корпуса ITX нужен блок питания SFX.");
    }
  }

  return issues;
}

/** Runs the full validation for the final assembled config and returns keyed issues. */
export function validateConfig(
  chosen: Record<ComponentCategory, Part | null>,
): PartIssue[] {
  const issues: PartIssue[] = [];
  const categoryOrder: ComponentCategory[] = [
    "cpu",
    "gpu",
    "motherboard",
    "ram",
    "storage",
    "case",
    "psu",
    "cooler",
  ];
  for (const category of categoryOrder) {
    const part = chosen[category];
    if (!part) continue;
    const reasonList = checkPartCompatibility(part, {
      ...chosen,
      [category]: part,
    });
    for (const reason of reasonList) {
      issues.push({ category, partId: part.id, reason });
    }
  }
  return issues;
}

/** True if all mandatory categories are filled, orderable, and no issues. */
export function isConfigComplete(
  chosen: Record<ComponentCategory, Part | null>,
): boolean {
  const mandatory: ComponentCategory[] = [
    "cpu",
    "gpu",
    "motherboard",
    "ram",
    "storage",
    "case",
    "psu",
    "cooler",
  ];
  for (const c of mandatory) {
    const part = chosen[c];
    if (!part) return false;
    if (!isPartAvailable(part)) return false;
  }
  return validateConfig(chosen).length === 0;
}