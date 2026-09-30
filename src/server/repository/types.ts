// Server-side domain types, mirroring src/types/index.ts but against the SQLite schema.

export type ComponentCategory =
  | "cpu"
  | "gpu"
  | "motherboard"
  | "ram"
  | "storage"
  | "case"
  | "psu"
  | "cooler";

export type Usage = "gaming" | "work" | "video" | "universal";
export type ConfigSource = "custom" | "auto" | "ready";
export type OrderStatus = "new" | "confirmed" | "delivery" | "done" | "alpha" | "alpha_rejected" | "cancelled";
export type UserRole = "customer" | "seller" | "admin";
export type SellerBrandDto = { brand: string; description?: string };

/** A vendor (trademark) dictionary entry. */
export interface VendorRow {
  vendor_id: string;
  name: string;
  created_at: string;
}

export interface VendorDto {
  id: string;
  name: string;
}

/** Why a part in a saved config can't be ordered. */
export type UnavailableReason = "deactivated" | "missing" | "no_price";

export type FormFactor = "ATX" | "mATX" | "ITX";
export type RamType = "DDR4" | "DDR5";
export type PsuForm = "ATX" | "SFX";

export interface SpecItem {
  label: string;
  value: string;
}

/** Compat markers and bench scores, reconstructed from compat_json. */
export interface PartCompat {
  socket?: string;
  chipset?: string;
  ramType?: RamType;
  psuForm?: PsuForm;
  power?: number;
  formFactor?: FormFactor;
  gpuLength?: number;
  cpuCoolerMaxHeight?: number;
  coolTdp?: number;
  sizeMm?: number;
  benches?: { label: string; score: number }[];
}

export interface PartRow {
  part_id: string;
  category: ComponentCategory;
  name: string;
  brand: string;
  vendor_id: string | null;
  tdp_watt: number;
  compat_json: string;
  specs_json: string;
  image_url: string | null;
  is_active: number;
  is_available: number;
  created_at: string;
}

/** API-facing part (rubles, parsed jsons). `price`/`priceSet` are present only when
 *  resolved from a seller's active price list (see `attachPrices`). */
export interface PartDto {
  id: string;
  category: ComponentCategory;
  name: string;
  brand: string;
  vendorId?: string;
  available: boolean;
  price?: number;
  priceSet?: boolean;
  tdp: number;
  specs: SpecItem[];
  image?: string;
  compat: PartCompat;
}

export interface ReadyPcRow {
  ready_pc_id: string;
  name: string;
  brand: string;
  usage: Usage;
  price_kopecks: number;
  tdp_watt: number;
  summary: string;
  specs_json: string;
  image_url: string | null;
  in_stock: number;
  rating: number;
  is_active: number;
  seller_id: string | null;
  created_at: string;
}

export interface ReadyPcDto {
  id: string;
  name: string;
  brand: string;
  usage: Usage;
  price: number;
  tdp: number;
  summary: string;
  specs: SpecItem[];
  image?: string;
  inStock: boolean;
  rating: number;
  reviewCount: number;
  /** Computed live: all 8 categories present and orderable against the active price list. */
  valid: boolean;
  /** Owning seller id (null for legacy/seeded catalog entries). */
  sellerId: string | null;
  /** True when this build has been archived (is_active = 0). */
  archived: boolean;
  /** Parts attached via ready_pc_part, resolved to PartDto. */
  parts: ConfigPartDto[];
}

export interface ReviewRow {
  review_id: string;
  ready_pc_id: string | null;
  entity_slug: string | null;
  author: string;
  rating: number;
  body: string;
  created_at: string;
}

export interface ReviewDto {
  id: string;
  entityId: string;
  author: string;
  rating: number;
  text: string;
  createdAt: number;
}

export interface ConfigRow {
  config_id: string;
  user_id: string;
  name: string;
  source: ConfigSource;
  usage: Usage | null;
  seller_id: string | null;
  ready_pc_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConfigDto {
  id: string;
  name: string;
  source: ConfigSource;
  usage?: Usage;
  sellerId?: string;
  /** For source='ready': the ready_pc this config was saved from. */
  readyPcId?: string;
  createdAt: number;
  updatedAt: number;
  /** Set only for source=ready: true when a config slot is unavailable/zero-priced or its build is archived. */
  buildInvalid?: boolean;
  parts: ConfigPartDto[];
}

export interface ConfigPartDto {
  category: ComponentCategory;
  part: PartDto | null;
  /** Snapshot price (copy from `config_part.price_kopecks`) for custom/auto. */
  price?: number;
  /** Current price from the config.seller_id active price list (custom/auto comparison). */
  currentPrice?: number;
  /** When `part` is null, the reason the slot is unavailable. */
  unavailableReason?: UnavailableReason;
}

export interface OrderItemRow {
  order_id: string;
  position: number;
  kind: "ready" | "config";
  ref_id: string;
  name: string;
  price_kopecks: number;
  count: number;
  seller_id: string | null;
  category: string | null;
}

export interface OrderItemDto {
  kind: "ready" | "config";
  refId: string;
  name: string;
  price: number;
  count: number;
  sellerId?: string;
  category?: ComponentCategory;
}

export interface OrderRow {
  order_id: string;
  user_id: string;
  total_kopecks: number;
  status: OrderStatus;
  address: string;
  user_name: string;
  created_at: string;
}

export interface OrderDto {
  id: string;
  createdAt: number;
  items: OrderItemDto[];
  total: number;
  status: OrderStatus;
  address: string;
  userName: string;
}

export interface UserRow {
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  company: string | null;
  created_at: string;
}

export interface UserDto {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: UserRole;
  company?: string;
  createdAt: number;
}

export interface SettingRow {
  setting_id: string;
  user_id: string;
  setting_key: string;
  setting_value: string;
  updated_at: string;
}

export interface AppSettingsDto {
  theme: "light" | "dark";
  notifications: boolean;
}

/**
 * Parse a `part.compat_json` row into `PartCompat`.
 *
 * Newer rows store the markers flat with a version flag: `{ v: 2, ...compat }`.
 * Older rows held the same markers flat without the flag. Either way the marker
 * fields are read directly; the `v` flag is ignored and, if absent, the object
 * is treated as already being the compat document. Unparseable input degrades
 * to `{}`.
 */
function decodeCompat(raw: string): PartCompat {
  try {
    const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
    const { v: _version, ...compat } = parsed;
    return compat as unknown as PartCompat;
  } catch {
    return {};
  }
}

export function partToDto(row: PartRow): PartDto {
  return {
    id: row.part_id,
    category: row.category,
    name: row.name,
    brand: row.brand,
    vendorId: row.vendor_id ?? undefined,
    available: row.is_active === 1 && row.is_available === 1,
    tdp: row.tdp_watt,
    specs: JSON.parse(row.specs_json || "[]"),
    image: row.image_url ?? undefined,
    compat: decodeCompat(row.compat_json),
  };
}

/** Copy of a PartDto with a price attached from a price-list item. */
export function attachPrice(part: PartDto, priceKopecks: number | null): PartDto {
  const price =
    priceKopecks !== null && priceKopecks >= 0 ? priceKopecks / 100 : undefined;
  const priceSet = priceKopecks !== null;
  const available =
    part.available &&
    (priceKopecks === null || priceKopecks > 0);
  return {
    ...part,
    price,
    priceSet,
    available,
  };
}

export function readyPcToBaseDto(
  row: ReadyPcRow,
): Omit<ReadyPcDto, "parts" | "reviewCount" | "valid" | "sellerId"> {
  return {
    id: row.ready_pc_id,
    name: row.name,
    brand: row.brand,
    usage: row.usage,
    price: row.price_kopecks / 100,
    tdp: row.tdp_watt,
    summary: row.summary,
    specs: JSON.parse(row.specs_json || "[]"),
    image: row.image_url ?? undefined,
    inStock: row.in_stock === 1,
    rating: row.rating,
    archived: row.is_active !== 1,
  };
}

/** Whether a part resolves to an orderable slot (active + positive price in the active list). */
export function isPartOrderable(part: PartDto | undefined | null): boolean {
  if (!part) return false;
  if (part.available !== true) return false;
  if (part.priceSet !== true) return false;
  return (part.price ?? 0) > 0;
}

/** Showcase spec labels per category, in display order. */
const BUILD_SPEC_LABELS: Array<[ComponentCategory, string]> = [
  ["cpu", "Процессор"],
  ["gpu", "Видеокарта"],
  ["ram", "Память"],
  ["storage", "Накопитель"],
  ["motherboard", "Материнская плата"],
  ["psu", "Блок питания"],
];

/**
 * Derive the showcase spec rows (Процессор/Видеокарта/Память/…) from a build's
 * composition. Used when creating a build and as a read-time fallback for
 * builds persisted before specs were generated.
 */
export function deriveBuildSpecs(
  parts: Array<{ category: ComponentCategory; part: PartDto | null }>,
): SpecItem[] {
  const byCategory = new Map(parts.map((p) => [p.category, p.part]));
  const specs: SpecItem[] = [];
  for (const [category, label] of BUILD_SPEC_LABELS) {
    const part = byCategory.get(category);
    if (part) specs.push({ label, value: part.name });
  }
  return specs;
}

export function reviewToDto(row: ReviewRow): ReviewDto {
  const entityId = row.ready_pc_id ?? row.entity_slug ?? "";
  return {
    id: row.review_id,
    entityId,
    author: row.author,
    rating: row.rating,
    text: row.body,
    createdAt: Date.parse(row.created_at),
  };
}

export function configToDto(
  row: ConfigRow,
  parts: ConfigPartDto[],
  buildInvalid?: boolean,
): ConfigDto {
  return {
    id: row.config_id,
    name: row.name,
    source: row.source,
    usage: row.usage ?? undefined,
    sellerId: row.seller_id ?? undefined,
    readyPcId: row.ready_pc_id ?? undefined,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    buildInvalid: buildInvalid,
    parts,
  };
}

export function orderToDto(
  row: OrderRow,
  items: OrderItemDto[],
): OrderDto {
  return {
    id: row.order_id,
    createdAt: Date.parse(row.created_at),
    items,
    total: row.total_kopecks / 100,
    status: row.status,
    address: row.address,
    userName: row.user_name,
  };
}

export function userToDto(row: UserRow): UserDto {
  return {
    id: row.user_id,
    name: row.name,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    role: row.role,
    company: row.company ?? undefined,
    createdAt: Date.parse(row.created_at),
  };
}