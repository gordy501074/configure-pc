/**
 * Core domain types for the PC configurator.
 */

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

export interface Part {
  id: string;
  category: ComponentCategory;
  name: string;
  brand: string;
  price: number;
  specs: SpecItem[];
  /** In watts. */
  tdp: number;
  image?: string;
  /** Compat markers used by the compatibility engine. */
  socket?: string;
  chipset?: string;
  ramType?: "DDR4" | "DDR5";
  psuForm?: "ATX" | "SFX";
  power?: number;
  formFactor?: "ATX" | "mATX" | "ITX";
  gpuLength?: number;
  cpuCoolerMaxHeight?: number;
  includesCooler?: boolean;
  baseWattage?: number;
  /** Cooling capacity in watts (only for cooler parts). */
  coolTdp?: number;
  /** Heatsink / radiator height/length in mm (only for cooler parts). */
  sizeMm?: number;
  benches?: { label: string; score: number }[];
}

export interface ConfigPart {
  category: ComponentCategory;
  part: Part;
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
}

export interface Order {
  id: string;
  createdAt: number;
  items: OrderItem[];
  total: number;
  status: "new" | "confirmed" | "delivery" | "done" | "alpha";
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

/** Compatibility disallow reason. */
export interface PartIssue {
  category: ComponentCategory;
  partId: string;
  reason: string;
}