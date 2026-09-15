import type {
  AppSettings,
  Config,
  Review,
  Order,
  User,
} from "../types";

const KEYS = {
  onboarded: "alfagen:onboarded",
  session: "alfagen:session",
  configs: "alfagen:configs",
  reviews: "alfagen:reviews",
  orders: "alfagen:orders",
  settings: "alfagen:settings",
  pendingAuth: "alfagen:pendingAuth",
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded — ignore for mock */
  }
}

/** Onboarding gate. */
export function isOnboarded(): boolean {
  return read(KEYS.onboarded, false);
}
export function setOnboarded(v: boolean): void {
  write(KEYS.onboarded, v);
}

/** Mock auth session. */
export function getSession(): User | null {
  return read<User | null>(KEYS.session, null);
}
export function setSession(user: User | null): void {
  write(KEYS.session, user);
}

/** Pending phone auth (mock SMS). */
export interface PendingAuth {
  phone: string;
  code: string;
  expiresAt: number;
}
export function getPendingAuth(): PendingAuth | null {
  return read<PendingAuth | null>(KEYS.pendingAuth, null);
}
export function setPendingAuth(p: PendingAuth): void {
  write(KEYS.pendingAuth, p);
}
export function clearPendingAuth(): void {
  write(KEYS.pendingAuth, null);
}

/** User configs. */
export function getConfigs(): Config[] {
  return read(KEYS.configs, []);
}
export function saveConfig(config: Config): Config[] {
  const list = getConfigs();
  const idx = list.findIndex((c) => c.id === config.id);
  if (idx >= 0) list[idx] = config;
  else list.unshift(config);
  write(KEYS.configs, list);
  return list;
}
export function deleteConfig(id: string): Config[] {
  const list = getConfigs().filter((c) => c.id !== id);
  write(KEYS.configs, list);
  return list;
}
export function getConfig(id: string): Config | undefined {
  return getConfigs().find((c) => c.id === id);
}

/** Reviews. */
export function getReviews(): Review[] {
  return read<Review[]>(KEYS.reviews, []);
}
export function addReview(review: Review): Review[] {
  const list = getReviews();
  list.unshift(review);
  write(KEYS.reviews, list);
  return list;
}
export function getReviewsFor(entityId: string): Review[] {
  return getReviews().filter((r) => r.entityId === entityId);
}

/** Orders. */
export function getOrders(): Order[] {
  return read<Order[]>(KEYS.orders, []);
}
export function addOrder(order: Order): Order[] {
  const list = getOrders();
  list.unshift(order);
  write(KEYS.orders, list);
  return list;
}
export function deleteOrder(id: string): Order[] {
  const list = getOrders().filter((o) => o.id !== id);
  write(KEYS.orders, list);
  return list;
}

/** Settings. */
export function getSettings(): AppSettings {
  return read<AppSettings>(KEYS.settings, { theme: "light", notifications: true });
}
export function setSettings(s: AppSettings): void {
  write(KEYS.settings, s);
}

/** Simple id generator. */
export function uid(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}