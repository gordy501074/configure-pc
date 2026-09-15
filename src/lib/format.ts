/** Formatting utilities — currency, watts, benches. */

const rubFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

/** Format a number as Russian currency, e.g. "139 900 ₽". */
export function formatPrice(value: number): string {
  return rubFormatter.format(value);
}

/** Format a wattage value, e.g. "650 Вт". */
export function formatWatts(value: number): string {
  return `${value} Вт`;
}

/** Compact number formatting for bench scores. */
export function formatScore(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} к`;
  }
  return String(value);
}

/** Format a millisecond timestamp as a local date, e.g. "14 мар 2026". */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Format humansible "x дней назад". */
export function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} дн назад`;
  return formatDate(ts);
}

/** Map a component category to its human label. */
export const CATEGORY_LABELS: Record<string, string> = {
  cpu: "Процессор",
  gpu: "Видеокарта",
  motherboard: "Материнская плата",
  ram: "Оперативная память",
  storage: "Накопитель",
  case: "Корпус",
  psu: "Блок питания",
  cooler: "Охлаждение",
};

/** Usage labels. */
export const USAGE_LABELS: Record<string, string> = {
  gaming: "Игры",
  work: "Работа / офис",
  video: "Видеомонтаж",
  universal: "Универсальный",
};

/** Strip non-digits from a phone number. */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

/** Accept common RU formats and return digits: 7XXXXXXXXXX. Returns null if invalid. */
export function parseRuPhone(value: string): string | null {
  const digits = normalizePhone(value);
  if (digits.length === 10 && digits.startsWith("9")) return `7${digits}`;
  if (digits.length === 11) {
    if (digits.startsWith("7") || digits.startsWith("8")) return `7${digits.slice(1)}`;
  }
  return null;
}

/** Format a normalized RU phone (7XXXXXXXXXX) into a readable "+7 (XXX) XXX-XX-XX". */
export function formatPhone(digits: string): string {
  const d = normalizePhone(digits).replace(/^8/, "7");
  if (d.length !== 11 || !d.startsWith("7")) return digits;
  return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}