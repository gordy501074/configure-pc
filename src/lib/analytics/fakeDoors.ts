// Catalog of fake doors (заглушки «Скоро»). Shared reference for the client
// (which renders/tracks them) and the server (which aggregates their CTR).
// Pure data — no browser/server globals, safe to import from either side.

export interface FakeDoorDef {
  id: string;
  label: string;
  hostRoute: string;
}

export const FAKE_DOORS: FakeDoorDef[] = [
  { id: "fake_door_compare", label: "Сравнение конфигураций", hostRoute: "/profile/configs" },
  { id: "fake_door_installment_20_6", label: "Рассрочка 20% / 6 мес", hostRoute: "/config" },
  { id: "fake_door_installment_50_12", label: "Рассрочка 50% / 12 мес", hostRoute: "/config" },
];

/** A fake door id registered as a trackable door (used to validate names). */
export function isFakeDoorId(id: string): boolean {
  return FAKE_DOORS.some((d) => d.id === id);
}