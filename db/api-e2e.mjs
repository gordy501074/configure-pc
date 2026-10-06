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
  method: "PUT", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` }, body: JSON.stringify(cfg),
}).then(j);
check("config save", saved.parts.length === 8 && saved.name === "Игровая сборка");
const list = await fetch(base + "/api/configs?userId=usr-test").then(j);
check("config list", list.length === 1 && list[0].id === "cfg-x");

// order
const order = await fetch(base + "/api/orders/ord-1?userId=usr-test", {
  method: "PUT", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` },
  body: JSON.stringify({
    status: "new", address: "Москва", userName: "Тест",
    items: [{ kind: "ready", refId: "ready-gaming", name: "Confi Gaming X", price: 139900, count: 1 }],
  }),
}).then(j);
check("order save", order.total === 139900 && order.address === "Москва");
// Attribution: server resolves ready-line seller from ready_pc.seller_id.
check("order item seller resolved", order.items?.[0]?.sellerId === "usr-seller");

// Deleting a user who still owns orders is blocked with a detailed reason.
const delWithOrders = await fetch(base + "/api/users/usr-test", {
  method: "DELETE", headers: { Cookie: `confi_session=${adminSession.sessionId}` },
});
const delWithOrdersBody = await delWithOrders.json();
check(
  "admin delete user with orders 409 + detail",
  delWithOrders.status === 409 &&
    delWithOrdersBody.error === "user_has_dependencies" &&
    delWithOrdersBody.details?.dependencies?.orders > 0 &&
    typeof delWithOrdersBody.details?.message === "string" &&
    delWithOrdersBody.details.message.length > 0,
);

// The seeded seller owns ready PCs / price lists / brands, so it must be undeletable.
const delSeller = await fetch(base + "/api/users/usr-seller", {
  method: "DELETE", headers: { Cookie: `confi_session=${adminSession.sessionId}` },
});
const delSellerBody = await delSeller.json();
check(
  "admin delete protected seller 409 + detail",
  delSeller.status === 409 &&
    delSellerBody.error === "user_has_dependencies" &&
    (delSellerBody.details?.dependencies?.readyPcs > 0 ||
      delSellerBody.details?.dependencies?.priceLists > 0 ||
      delSellerBody.details?.dependencies?.brands > 0),
);

// soft-cancel via explicit endpoint keeps the row and flips status
const cancelRes = await fetch(base + "/api/orders/ord-1/cancel?userId=usr-test", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` },
});
check("order cancel 204", cancelRes.status === 204);
const afterCancel = await fetch(base + "/api/orders?userId=usr-test").then(j);
const cancelled = afterCancel.find((o) => o.id === "ord-1");
check("order soft-cancelled preserved", !!cancelled && cancelled.status === "cancelled" && cancelled.items.length === 1);

// another customer cannot cancel a foreign order
const stranger = await fetch(base + "/api/session", {
  method: "POST", headers: jh,
  body: JSON.stringify({ id: "usr-stranger", name: "Чужой", email: "stranger@example.com" }),
}).then(j);
const foreignCancel = await fetch(base + "/api/orders/ord-1/cancel?userId=usr-stranger", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${stranger.sessionId}` },
});
check("order cancel foreign 403", foreignCancel.status === 403);

// ---- Seller / admin customer-orders lifecycle ----

// A second seller account (FK target for a foreign order line).
await fetch(base + "/api/session", {
  method: "POST", headers: jh,
  body: JSON.stringify({ id: "usr-other-seller", name: "Другой продавец", role: "seller" }),
}).then(j);

// A customer cannot self-approve an existing order's status via PUT: the stored
// status wins over the body (lifecycle goes through the dedicated endpoints).
await fetch(base + "/api/orders/ord-sticky?userId=usr-test", {
  method: "PUT", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` },
  body: JSON.stringify({
    status: "new", address: "Москва", userName: "Тест",
    items: [{ kind: "ready", refId: "ready-gaming", name: "Confi Gaming X", price: 139900, count: 1 }],
  }),
});
const stickyPut = await fetch(base + "/api/orders/ord-sticky?userId=usr-test", {
  method: "PUT", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` },
  body: JSON.stringify({
    status: "done", address: "Москва", userName: "Тест",
    items: [{ kind: "ready", refId: "ready-gaming", name: "Confi Gaming X", price: 139900, count: 1 }],
  }),
}).then(j);
check("customer PUT cannot self-advance status", stickyPut.status === "new");

// A customer cannot create an order pre-set to a terminal lifecycle status.
const sneakyCreate = await fetch(base + "/api/orders/ord-sneaky?userId=usr-test", {
  method: "PUT", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` },
  body: JSON.stringify({
    status: "done", address: "Москва", userName: "Тест",
    items: [{ kind: "ready", refId: "ready-gaming", name: "Confi Gaming X", price: 139900, count: 1 }],
  }),
}).then(j);
check("customer PUT cannot create as terminal status", sneakyCreate.status === "new");

// Order with a line of usr-seller and a line of usr-other-seller.
const sellerOrder = await fetch(base + "/api/orders/ord-seller-1?userId=usr-test", {
  method: "PUT", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` },
  body: JSON.stringify({
    status: "new", address: "СПб", userName: "Тест",
    items: [
      { kind: "ready", refId: "ready-gaming", name: "Confi Gaming X", price: 139900, count: 1 },
      { kind: "config", refId: "cpu-1", name: "Чужой процессор", price: 100, count: 2, sellerId: "usr-other-seller", category: "cpu" },
    ],
  }),
}).then(j);
check("seller order created", !!sellerOrder.id && sellerOrder.items.length === 2);

const sellerOrders = await fetch(base + "/api/seller/usr-seller/orders", {
  headers: { Cookie: `confi_session=${sellerSessionA.sessionId}` },
}).then(j);
const mine = sellerOrders.find((o) => o.id === "ord-seller-1");
check("seller sees own order", !!mine);
check("seller lines filtered to own", mine?.items.length === 1 && mine?.items[0]?.sellerId === "usr-seller");
check("seller total only own lines", mine?.total === 139900);

// Customer cannot read the seller's orders endpoint.
const sellerOrdersCust = await fetch(base + "/api/seller/usr-other-seller/orders", {
  headers: { Cookie: `confi_session=${customerSess.sessionId}` },
});
check("seller orders foreign 403", sellerOrdersCust.status === 403);

// Valid transition: new -> confirmed.
const toConfirmed = await fetch(base + "/api/seller/usr-seller/orders/ord-seller-1/status", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${sellerSessionA.sessionId}` },
  body: JSON.stringify({ status: "confirmed" }),
});
check("seller transition new->confirmed 200", toConfirmed.status === 200);

// Invalid transition: confirmed -> confirmed.
const badTransition = await fetch(base + "/api/seller/usr-seller/orders/ord-seller-1/status", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${sellerSessionA.sessionId}` },
  body: JSON.stringify({ status: "confirmed" }),
});
check("seller invalid transition 409", badTransition.status === 409);

// A seller with no line in the order cannot change its status.
const noLineSeller = await fetch(base + "/api/session", {
  method: "POST", headers: jh,
  body: JSON.stringify({ id: "usr-no-line", name: "Без позиций", role: "seller" }),
}).then(j);
const foreignSellerStatus = await fetch(base + "/api/seller/usr-no-line/orders/ord-seller-1/status", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${noLineSeller.sessionId}` },
  body: JSON.stringify({ status: "cancelled" }),
});
check("seller foreign order 403", foreignSellerStatus.status === 403);

// ---- Installment (Alpha) approve / reject ----

const alphaOrder = await fetch(base + "/api/orders/ord-alpha-1?userId=usr-test", {
  method: "PUT", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` },
  body: JSON.stringify({
    status: "alpha", address: "Казань", userName: "Тест",
    items: [{ kind: "ready", refId: "ready-gaming", name: "Confi Gaming X", price: 139900, count: 1 }],
  }),
}).then(j);
check("alpha order created", alphaOrder.status === "alpha");

const alphaList = await fetch(base + "/api/admin/orders?status=alpha", {
  headers: { Cookie: `confi_session=${adminSession.sessionId}` },
}).then(j);
check("admin alpha list", Array.isArray(alphaList) && alphaList.some((o) => o.id === "ord-alpha-1"));

const approved = await fetch(base + "/api/admin/orders/ord-alpha-1/approve-installment", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${adminSession.sessionId}` },
});
check("admin approve 200", approved.status === 200);
const approvedBody = await approved.json();
check("admin approve -> confirmed", approvedBody?.status === "confirmed");

// Second decision on a non-alpha order -> 409.
const reApprove = await fetch(base + "/api/admin/orders/ord-alpha-1/approve-installment", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${adminSession.sessionId}` },
});
check("admin re-decision 409", reApprove.status === 409);

// Reject path.
await fetch(base + "/api/orders/ord-alpha-2?userId=usr-test", {
  method: "PUT", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` },
  body: JSON.stringify({
    status: "alpha", address: "Сочи", userName: "Тест",
    items: [{ kind: "ready", refId: "ready-gaming", name: "Confi Gaming X", price: 139900, count: 1 }],
  }),
});
const rejected = await fetch(base + "/api/admin/orders/ord-alpha-2/reject-installment", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${adminSession.sessionId}` },
}).then(j);
check("admin reject -> alpha_rejected", rejected?.status === "alpha_rejected");

// Customer buys at own expense (alpha_rejected -> confirmed).
const buyOwn = await fetch(base + "/api/orders/ord-alpha-2/buy-own", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` },
}).then(j);
check("customer buy-own -> confirmed", buyOwn?.status === "confirmed");

// Buy-own on a non-rejected order -> 409.
const buyOwnAgain = await fetch(base + "/api/orders/ord-alpha-2/buy-own", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` },
});
check("customer buy-own wrong status 409", buyOwnAgain.status === 409);

// Buy-own by a non-owner -> 403.
await fetch(base + "/api/orders/ord-alpha-3?userId=usr-test", {
  method: "PUT", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` },
  body: JSON.stringify({
    status: "alpha", address: "Сочи", userName: "Тест",
    items: [{ kind: "ready", refId: "ready-gaming", name: "Confi Gaming X", price: 139900, count: 1 }],
  }),
});
await fetch(base + "/api/admin/orders/ord-alpha-3/reject-installment", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${adminSession.sessionId}` },
});
const buyOwnForeign = await fetch(base + "/api/orders/ord-alpha-3/buy-own", {
  method: "POST", headers: { ...jh, Cookie: `confi_session=${stranger.sessionId}` },
});
check("customer buy-own foreign 403", buyOwnForeign.status === 403);

// review
const review = await fetch(base + "/api/reviews/rev-test", {
  method: "PUT", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` },
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
  method: "PUT", headers: { ...jh, Cookie: `confi_session=${session.sessionId}` },
  body: JSON.stringify({ entityId: "custom-config", author: "Кастом", rating: 4, text: "Хорошо" }),
}).then(j);
const customList = await fetch(base + "/api/reviews?entityId=custom-config").then(j);
check("custom review", custom.entityId === "custom-config" && customList.some((r) => r.id === "rev-custom"));

// delete
const delCfg = await fetch(base + "/api/configs/cfg-x?userId=usr-test", {
  method: "DELETE", headers: { Cookie: `confi_session=${session.sessionId}` },
});
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