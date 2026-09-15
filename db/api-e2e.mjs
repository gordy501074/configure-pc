const base = "http://localhost:8787";
const j = (r) => r.json();
const jh = { "Content-Type": "application/json" };

const results = [];
const check = (name, ok, extra) => results.push({ name, ok, ...extra });

// health
try {
  const h = await fetch(base + "/api/health").then(j);
  check("health", h.ok === true && h.db === "sqlite");
} catch (e) {
  check("health", false, { err: e.message });
}

// catalog
const parts = await fetch(base + "/api/parts").then(j);
check("parts count", parts.length === 38);
const ready = await fetch(base + "/api/ready").then(j);
check("ready count", ready.length === 4);
const gaming = await fetch(base + "/api/ready/ready-gaming").then(j);
check("ready-gaming parts", gaming.parts.length === 8, { price: gaming.price });

// session
const user = await fetch(base + "/api/session", {
  method: "POST",
  headers: jh,
  body: JSON.stringify({ id: "usr-test", name: "Тест", role: "customer", phone: "79990001122" }),
}).then(j);
check("session ok", user.id === "usr-test" && user.name === "Тест");

// config save + read
const cfg = {
  name: "Игровая сборка",
  source: "custom",
  usage: "gaming",
  parts: [
    { category: "cpu", part_id: "cpu-r7-7800x3d" },
    { category: "gpu", part_id: "gpu-rtx-4070-super" },
    { category: "motherboard", part_id: "mb-b650-am5" },
    { category: "ram", part_id: "ram-ddr5-32" },
    { category: "storage", part_id: "ssd-1tb-nvme" },
    { category: "case", part_id: "case-atx-tower" },
    { category: "psu", part_id: "psu-750" },
    { category: "cooler", part_id: "cooler-air" },
  ],
};
const saved = await fetch(base + "/api/configs/cfg-x?userId=usr-test", {
  method: "PUT", headers: jh, body: JSON.stringify(cfg),
}).then(j);
check("config save", saved.parts.length === 8 && saved.name === "Игровая сборка");
const list = await fetch(base + "/api/configs?userId=usr-test").then(j);
check("config list", list.length === 1 && list[0].id === "cfg-x");

// order
const order = await fetch(base + "/api/orders/ord-1?userId=usr-test", {
  method: "PUT", headers: jh,
  body: JSON.stringify({
    status: "new", address: "Москва", userName: "Тест",
    items: [{ kind: "ready", refId: "ready-gaming", name: "Confi Gaming X", price: 139900, count: 1 }],
  }),
}).then(j);
check("order save", order.total === 139900 && order.address === "Москва");

// review
const review = await fetch(base + "/api/reviews/rev-test", {
  method: "PUT", headers: jh,
  body: JSON.stringify({ entityId: "ready-gaming", author: "Дмитрий", rating: 5, text: "Отлично" }),
}).then(j);
check("review save", review.entityId === "ready-gaming" && review.text === "Отлично");
const revFor = await fetch(base + "/api/reviews?entityId=ready-gaming").then(j);
check("reviews for", revFor.some((r) => r.id === "rev-test"));

// settings (the previously buggy path)
await fetch(base + "/api/settings?userId=usr-test", {
  method: "PATCH", headers: jh, body: JSON.stringify({ theme: "dark", notifications: false }),
}).then(j);
const sett = await fetch(base + "/api/settings?userId=usr-test").then(j);
check("settings dark", sett.theme === "dark" && sett.notifications === false, sett);

// custom-config review
const custom = await fetch(base + "/api/reviews/rev-custom", {
  method: "PUT", headers: jh,
  body: JSON.stringify({ entityId: "custom-config", author: "Кастом", rating: 4, text: "Хорошо" }),
}).then(j);
const customList = await fetch(base + "/api/reviews?entityId=custom-config").then(j);
check("custom review", custom.entityId === "custom-config" && customList.some((r) => r.id === "rev-custom"));

// delete
const delCfg = await fetch(base + "/api/configs/cfg-x?userId=usr-test", { method: "DELETE" });
check("delete config", delCfg.status === 204);
const list2 = await fetch(base + "/api/configs?userId=usr-test").then(j);
check("config deleted", list2.length === 0);

let fail = 0;
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : " " + JSON.stringify(r)}`);
  if (!r.ok) fail++;
}
console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);