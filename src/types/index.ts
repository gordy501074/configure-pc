/**
 * Core domain types for the PC configurator.
 */

import type { InstallmentDecision, PaymentMethod } from "../lib/orderStatus.ts";

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
export type Ecosystem = "intel" | "amd";
export type Priority = "perf" | "price" | "silent";

export interface SpecItem {
  label: string;
  value: string;
}

export type FormFactor = "ATX" | "mATX" | "ITX";
export type RamType = "DDR4" | "DDR5";
export type PsuForm = "ATX" | "SFX";

/**
 * Nested compatibility markers used by the compatibility engine.
 * Persisted inside `compat_json` (part table) as `{ v: 2, ...compat }`.
 */
export interface PartCompat {
  socket?: string;
  chipset?: string;
  ramType?: RamType;
  psuForm?: PsuForm;
  /** Rated wattage (only for PSU parts). */
  power?: number;
  /** Motherboard / case form factor. */
  formFactor?: FormFactor;
  /** Max GPU length in mm (only for GPU parts). */
  gpuLength?: number;
  /** Max CPU cooler height in mm (only for case parts). */
  cpuCoolerMaxHeight?: number;
  /** Cooling capacity in watts (only for cooler parts). */
  coolTdp?: number;
  /** Heatsink / radiator height/length in mm (only for cooler parts). */
  sizeMm?: number;
  /** Benchmark scores (CPU / GPU). */
  benches?: { label: string; score: number }[];
}

export interface Part {
  id: string;
  category: ComponentCategory;
  name: string;
  brand: string;
  vendorId?: string;
  /** False when deactivated, unavailable-for-order, or lacks a positive price in the seller's active list. */
  available?: boolean;
  /** Present when the part has a price in the seller's active price list. */
  price?: number;
  /** True when this part has an explicit price list entry (even 0 = unavailable). */
  priceSet?: boolean;
  specs: SpecItem[];
  /** In watts. */
  tdp: number;
  image?: string;
  /** Short RU card description (AI-generated or manual). */
  description?: string;
  /** Compat markers used by the compatibility engine. */
  compat: PartCompat;
}

/** Why a config slot can't be ordered. */
export type UnavailableReason = "deactivated" | "missing" | "no_price";

/** A slot in a config/ready PC. When `part` is null, the component is unavailable. */
export interface ConfigPart {
  category: ComponentCategory;
  part: Part | null;
  /** Snapshot price (custom/auto); for ready it's the live re-priced value. */
  price?: number;
  /** Current price from the seller's active list (custom/auto -5% comparison). */
  currentPrice?: number;
  unavailableReason?: UnavailableReason;
}

/** A brand / trademark dictionary entry. */
export interface Vendor {
  id: string;
  name: string;
}

/** A full configuration (list of chosen parts). */
export interface Config {
  id: string;
  name: string;
  parts: ConfigPart[];
  createdAt: number;
  updatedAt: number;
  source: "custom" | "auto" | "ready";
  usage?: Usage;
  sellerId?: string;
  /** For source=ready: the ready_pc this config was saved from. */
  readyPcId?: string;
  /** Set only for source=ready: true when the saved ready build is currently invalid (a slot is unavailable/zero-priced, or the build is archived). */
  buildInvalid?: boolean;
}

export interface ReadyPc {
  id: string;
  name: string;
  brand: string;
  usage: Usage;
  price: number;
  tdp: number;
  parts: ConfigPart[];
  summary: string;
  specs: SpecItem[];
  image?: string;
  inStock: boolean;
  rating: number;
  reviewCount: number;
  /** Computed live by the server: all 8 slots orderable against the seller's active price list. */
  valid?: boolean;
  /** Owning seller id. */
  sellerId?: string;
  /** True when the build has been archived (soft-deleted). */
  archived?: boolean;
}

export interface Review {
  id: string;
  entityId: string;
  author: string;
  rating: number;
  text: string;
  createdAt: number;
}

export interface OrderItem {
  kind: "ready" | "config";
  refId: string;
  name: string;
  price: number;
  count: number;
  /** Seller attribution snapshot (absent for legacy/history rows). */
  sellerId?: string;
  /** Category snapshot for per-category analytics. */
  category?: ComponentCategory;
}

export interface Order {
  id: string;
  createdAt: number;
  items: OrderItem[];
  total: number;
  status: "new" | "confirmed" | "delivery" | "done" | "alpha" | "alpha_rejected" | "cancelled";
  /** How the order is paid (absent on legacy payloads = 'full'). */
  paymentMethod?: PaymentMethod;
  /** Alpha-Bank installment decision snapshot; null/absent for non-installment orders. */
  installmentDecision?: InstallmentDecision | null;
  address: string;
  userName: string;
}

export type UserRole = "customer" | "seller" | "admin";

export interface User {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: UserRole;
  company?: string;
  createdAt: number;
}

export interface AppSettings {
  theme: "light" | "dark";
  notifications: boolean;
}

/** Survey answers for auto-selection. */
export interface SurveyAnswers {
  budget: number;
  usage: Usage;
  ecosystem: Ecosystem;
  priority: Priority;
}

/** A brand owned by a seller. */
export interface SellerBrand {
  brand: string;
  description?: string;
}

/** A seller account, for the catalog seller selector. */
export interface SellerSummary {
  id: string;
  name: string;
  company?: string;
}

/** A price-list item (a part with a price in rubles). */
export interface PriceListItem {
  partId: string;
  /** Part display name (present when the part still exists). */
  name?: string;
  /** Part category (present when the part still exists). */
  category?: ComponentCategory;
  price: number;
}

/** A seller's price list (exactly one active per seller). */
export interface PriceList {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: number;
  items: PriceListItem[];
}

/** Compatibility disallow reason. */
export interface PartIssue {
  category: ComponentCategory;
  partId: string;
  reason: string;
}

// ---- Sales analytics ----

export type AnalyticsPeriod = "7d" | "30d" | "90d" | "all";

export interface SalesKpi {
  revenue: number;
  orders: number;
  units: number;
  avgOrder: number;
  cancelledOrders: number;
  cancelledRate: number;
}

export interface RevenueDayRow {
  date: string;
  revenue: number;
  orders: number;
}

export interface FunnelStage {
  status: Order["status"];
  orders: number;
  revenue: number;
}

export interface TopBuildRow {
  kind: "ready" | "config";
  refId: string;
  name: string;
  units: number;
  revenue: number;
}

export interface TopPartRow {
  refId: string;
  name: string;
  category: string;
  units: number;
  revenue: number;
}

export interface BucketRow {
  bucket: string;
  orders: number;
}

export interface CoverageRow {
  category: string;
  total: number;
  priced: number;
  available: number;
}

export interface InstallmentAnalytics {
  approved: number;
  rejected: number;
  pending: number;
  withInstallment: number;
  withoutInstallment: number;
  installmentShare: number;
  avgInstallmentOrder: number;
  avgFullOrder: number;
}

export interface SalesAnalytics {
  period: { preset: AnalyticsPeriod; from: string | null; to: string };
  sellerId: string | null;
  kpi: SalesKpi;
  revenueByDay: RevenueDayRow[];
  funnel: FunnelStage[];
  topBuilds: TopBuildRow[];
  topParts: TopPartRow[];
  orderValueBuckets: BucketRow[];
  catalogCoverage: CoverageRow[];
  /** Only returned by the admin aggregate endpoint. */
  installment?: InstallmentAnalytics;
}

// ---- CTR (fake doors) ----

/** One row of the admin "CTR по fake door" table. */
export interface FakeDoorCtrRow {
  id: string;
  label: string;
  views: number;
  clicks: number;
  impressions: number;
  ctr: number | null;
}