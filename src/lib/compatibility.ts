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

/** Sum price and power draw of a config. */
export function configStats(config: Pick<Config, "parts">): ConfigStats {
  let totalPrice = 0;
  let totalTdp = 0;
  for (const { part } of config.parts) {
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
  if (cpu && motherboard && cpu.socket !== motherboard.socket) {
    issues.push(
      `Сокет процессора ${cpu.socket} не подходит к плате ${motherboard.socket}.`,
    );
  }

  // --- CPU <-> cooler TDP ---
  if (cpu && cooler && (cooler.coolTdp ?? 0) > 0 && cpu.tdp > (cooler.coolTdp ?? 0)) {
    issues.push(
      `Кулер рассчитан на TDP ${cooler.coolTdp} Вт, а процессор потребляет до ${cpu.tdp} Вт.`,
    );
  }

  // --- Motherboard <-> RAM type ---
  if (motherboard && ram && motherboard.ramType !== ram.ramType) {
    issues.push(
      `Плата поддерживает ${motherboard.ramType}, а память — ${ram.ramType}.`,
    );
  }

  // --- Case <-> motherboard form factor (case supports up to its own) ---
  if (pcCase && motherboard && pcCase.formFactor) {
    const rank: Record<string, number> = { ITX: 1, mATX: 2, ATX: 3 };
    if (rank[motherboard.formFactor ?? "ATX"] > rank[pcCase.formFactor]) {
      issues.push(
        `Форм-фактор платы ${motherboard.formFactor} не влезает в корпус ${pcCase.formFactor}.`,
      );
    }
  }

  // --- Case <-> GPU length ---
  if (pcCase && gpu && gpu.gpuLength && pcCase.gpuLength) {
    if (gpu.gpuLength > pcCase.gpuLength) {
      issues.push(
        `Видеокарта длиной ${gpu.gpuLength} мм не влезает в корпус (до ${pcCase.gpuLength} мм).`,
      );
    }
  }

  // --- Case <-> cooler height (tower air coolers only) ---
  if (
    pcCase &&
    cooler &&
    cooler.sizeMm &&
    pcCase.cpuCoolerMaxHeight &&
    cooler.sizeMm > 100
  ) {
    if (cooler.sizeMm > pcCase.cpuCoolerMaxHeight) {
      issues.push(
        `Высота кулера ${cooler.sizeMm} мм не влезает в корпус (до ${pcCase.cpuCoolerMaxHeight} мм).`,
      );
    }
  }

  // --- PSU power headroom ---
  const othersTdp = [cpu, gpu, motherboard, ram, cooler]
    .filter((p): p is Part => !!p)
    .filter((p) => p.id !== psu?.id)
    .reduce((sum, p) => sum + p.tdp, 0);
  if (psu && psu.power) {
    if (psu.power < othersTdp * 1.6) {
      issues.push(
        `Мощности БП ${psu.power} Вт недостаточно для остальных компонентов (потребление ~${Math.round(othersTdp * 1.6)} Вт с запасом).`,
      );
    }
  }

  // --- PSU form factor vs case ---
  if (psu && pcCase && pcCase.formFactor === "ITX") {
    if (psu.psuForm !== "SFX") {
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

/** True if all mandatory categories are filled and no issues. */
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
    if (!chosen[c]) return false;
  }
  return validateConfig(chosen).length === 0;
}