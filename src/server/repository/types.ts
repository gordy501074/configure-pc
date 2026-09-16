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
export type OrderStatus = "new" | "confirmed" | "delivery" | "done" | "alpha";
export type UserRole = "customer" | "seller" | "admin";
export type SellerBrandDto = { brand: string; description?: string };

export interface SpecItem {
  label: string;
  value: string;
}

/** Compat markers and bench scores, reconstructed from compat_json. */
export interface Compat {
  socket?: string;
  chipset?: string;
  ramType?: "DDR4" | "DDR5";
  psuForm?: "ATX" | "SFX";
  power?: number;
  formFactor?: "ATX" | "mATX" | "ITX";
  gpuLength?: number;
  cpuCoolerMaxHeight?: number;
  includesCooler?: boolean;
  coolTdp?: number;
  sizeMm?: number;
  benches?: { label: string; score: number }[];
}

export interface PartRow {
  part_id: string;
  category: ComponentCategory;
  name: string;
  brand: string;
  price_kopecks: number;
  tdp_watt: number;
  compat_json: string;
  specs_json: string;
  image_url: string | null;
  is_active: number;
  created_at: string;
}

/** API-facing part (rubles, parsed jsons). */
export interface PartDto {
  id: string;
  category: ComponentCategory;
  name: string;
  brand: string;
  price: number;
  tdp: number;
  specs: SpecItem[];
  image?: string;
  socket?: string;
  chipset?: string;
  ramType?: "DDR4" | "DDR5";
  psuForm?: "ATX" | "SFX";
  power?: number;
  formFactor?: "ATX" | "mATX" | "ITX";
  gpuLength?: number;
  cpuCoolerMaxHeight?: number;
  includesCooler?: boolean;
  coolTdp?: number;
  sizeMm?: number;
  benches?: { label: string; score: number }[];
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
  created_at: string;
  updated_at: string;
}

export interface ConfigDto {
  id: string;
  name: string;
  source: ConfigSource;
  usage?: Usage;
  createdAt: number;
  updatedAt: number;
  parts: ConfigPartDto[];
}

export interface ConfigPartDto {
  category: ComponentCategory;
  part: PartDto;
}

export interface OrderItemRow {
  order_id: string;
  position: number;
  kind: "ready" | "config";
  ref_id: string;
  name: string;
  price_kopecks: number;
  count: number;
}

export interface OrderItemDto {
  kind: "ready" | "config";
  refId: string;
  name: string;
  price: number;
  count: number;
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

export function partToDto(row: PartRow): PartDto {
  const compat = JSON.parse(row.compat_json || "{}") as Compat;
  return {
    id: row.part_id,
    category: row.category,
    name: row.name,
    brand: row.brand,
    price: row.price_kopecks / 100,
    tdp: row.tdp_watt,
    specs: JSON.parse(row.specs_json || "[]"),
    image: row.image_url ?? undefined,
    socket: compat.socket,
    chipset: compat.chipset,
    ramType: compat.ramType,
    psuForm: compat.psuForm,
    power: compat.power,
    formFactor: compat.formFactor,
    gpuLength: compat.gpuLength,
    cpuCoolerMaxHeight: compat.cpuCoolerMaxHeight,
    includesCooler: compat.includesCooler,
    coolTdp: compat.coolTdp,
    sizeMm: compat.sizeMm,
    benches: compat.benches,
  };
}

export function readyPcToBaseDto(
  row: ReadyPcRow,
): Omit<ReadyPcDto, "parts" | "reviewCount"> {
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
  };
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
): ConfigDto {
  return {
    id: row.config_id,
    name: row.name,
    source: row.source,
    usage: row.usage ?? undefined,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
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