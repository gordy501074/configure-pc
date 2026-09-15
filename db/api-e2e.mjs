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
const session = await fetch(base + "/api/session", {
  method: "POST",
  headers: jh,
  body: JSON.stringify({ id: "usr-test", name: "Тест", role: "customer", phone: "79990001122", email: "test@example.com" }),
}).then(j);
check("session ok", session.user?.id === "usr-test" && session.user.name === "Тест" && !!session.sessionId);
// session restore
const restored = await fetch(base + "/api/session/" + session.sessionId).then(j);
check("session restore", restored.user?.id === "usr-test" && restored.sessionId === session.sessionId);

// ---- Role model ----

// seller login by email preserves role + user_id across re-logins
const sellerSessionA = await fetch(base + "/api/session", {
  method: "POST", headers: jh,
  body: JSON.stringify({ email: "user@company.com", name: "X" }),
}).then(j);
check("seller login keeps role", sellerSessionA.user?.role === "seller" && sellerSessionA.user?.id === "usr-seller");
check("seller has no phone", sellerSessionA.user?.phone == null && !!sellerSessionA.user?.company);
const sellerSessionB = await fetch(base + "/api/session", {
  method: "POST", headers: jh,
  body: JSON.stringify({ email: "user@company.com", name: "Другой" }),
}).then(j);
check("seller relogin same id+role", sellerSessionB.user?.id === "usr-seller" && sellerSessionB.user?.role === "seller");

// admin login by email preserves role
const adminSession = await fetch(base + "/api/session", {
  method: "POST", headers: jh,
  body: JSON.stringify({ email: "avgordeev@alfabank.ru", name: "X" }),
}).then(j);
check("admin login", adminSession.user?.role === "admin" && adminSession.user?.id === "usr-admin" && adminSession.user?.phone == null);

// seller brands: admin can read; anonymous cannot read
const brandsForSellerResp = await fetch(base + "/api/seller/usr-seller/brands");
check("seller brands anon forbidden", brandsForSellerResp.status === 403);
const sellerBrandsCtx = sellerSessionA.sessionId;
const brandsAuth = await fetch(base + "/api/seller/usr-seller/brands", {
  headers: { Cookie: `confi_session=${sellerBrandsCtx}` },
}).then(j);
check("seller brands owner ok", Array.isArray(brandsAuth) && brandsAuth.some((b) => b.brand === "Confi"));

// /api/users guards: anonymous 403, customer 403, admin 200
const usersAnon = await fetch(base + "/api/users");
check("users anon 403", usersAnon.status === 403);
const customerSess = await fetch(base + "/api/session", {
  method: "POST", headers: jh,
  body: JSON.stringify({ email: "client@example.com", name: "Клиент" }),
}).then(j);
const usersCustomer = await fetch(base + "/api/users", {
  headers: { Cookie: `confi_session=${customerSess.sessionId}` },
});
check("users customer 403", usersCustomer.status === 403);
const usersAdmin = await fetch(base + "/api/users", {
  headers: { Cookie: `confi_session=${adminSession.sessionId}` },
}).then(j);
check("users admin 200", Array.isArray(usersAdmin) && usersAdmin.some((u) => u.id === "usr-admin"));

// create/delete/role via admin
const created = await fetch(base + "/api/users", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${adminSession.sessionId}` },
  body: JSON.stringify({ name: "Новый Продавец", email: "seller2@example.com", role: "seller", company: "Компания Б" }),
}).then(j);
check("admin create seller fields", created.id && created.role === "seller" && created.phone == null && created.company === "Компания Б");

// duplicate email => 409 graceful
const dupEmail = await fetch(base + "/api/users", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${adminSession.sessionId}` },
  body: JSON.stringify({ name: "Дубль", email: "seller2@example.com", role: "customer" }),
});
check("admin create duplicate email 409", dupEmail.status === 409);
const roleChanged = await fetch(base + `/api/users/${created.id}/role`, {
  method: "PATCH", headers: { ...jh, Cookie: `confi_session=${adminSession.sessionId}` },
  body: JSON.stringify({ role: "customer" }),
}).then(j);
check("admin role change", roleChanged.role === "customer" && roleChanged.phone == null);
const delByAdmin = await fetch(base + `/api/users/${created.id}`, {
  method: "DELETE", headers: { Cookie: `confi_session=${adminSession.sessionId}` },
});
check("admin delete user", delByAdmin.status === 204);

// PATCH /api/profile self-service
const custUpdate = await fetch(base + "/api/profile", {
  method: "PATCH", headers: { ...jh, Cookie: `confi_session=${customerSess.sessionId}` },
  body: JSON.stringify({ name: "Кирилл", company: "Попытка" }),
}).then(j);
check("profile client changes name", custUpdate.name === "Кирилл" && custUpdate.role === "customer" && custUpdate.company == null);
const sellerUpdate = await fetch(base + "/api/profile", {
  method: "PATCH", headers: { ...jh, Cookie: `confi_session=${sellerSessionA.sessionId}` },
  body: JSON.stringify({ name: "Продавец 2", company: "Confi Plus" }),
}).then(j);
check("profile seller changes name+company", sellerUpdate.name === "Продавец 2" && sellerUpdate.company === "Confi Plus" && sellerUpdate.role === "seller");
const profileAnon = await fetch(base + "/api/profile", {
  method: "PATCH", headers: jh, body: JSON.stringify({ name: "x" }),
});
check("profile anon 403", profileAnon.status === 403);

// phone login does NOT grant admin/seller role (they have phone=NULL)
const phoneProbe = await fetch(base + "/api/session", {
  method: "POST", headers: jh,
  body: JSON.stringify({ phone: "+7(900)000-00-00", name: "Кто-то" }),
}).then(j);
check("phone login creates customer", phoneProbe.user?.role === "customer" && !!phoneProbe.user?.id);

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