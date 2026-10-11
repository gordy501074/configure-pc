// @group regression
// AI advisor tab on /auto: mocked NDJSON stream renders the chat, streams text,
// and surfaces a recommendation CTA. Also covers the 503 ai_not_configured path.

import { test, expect } from "@playwright/test";

/** Serialize an array of events into an NDJSON body. */
function ndjson(events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

test.describe("regression: AI advisor chat", () => {
  test("streams a dialog and surfaces a ready-build recommendation", async ({ page }) => {
    await page.route("**/api/ai/advisor/chat", async (route) => {
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
        body: ndjson([
          { event: "start", deadlineMs: 45000 },
          { event: "delta", text: "Отлично, бюджет " },
          { event: "delta", text: "140 000 ₽ — для игр подойдёт эта сборка." },
          { event: "requirements", data: { budget: 140000, usage: "gaming" } },
          {
            event: "recommendation",
            kind: "ready",
            readyPcId: "ready-gaming",
            summary: "Confi Gaming X — сбалансированная игровая сборка.",
          },
          { event: "done" },
        ]),
      });
    });

    await page.goto("/auto?mode=ai");
    await expect(
      page.getByRole("heading", { name: "Подбор с помощью AI-бота" }),
    ).toBeVisible();

    await page.getByRole("textbox", { name: "Сообщение для AI-помощника" }).fill(
      "Хочу игровой ПК за 140000",
    );
    await page.getByRole("button", { name: "Отправить" }).click();

    // Streamed assistant text renders.
    await expect(page.getByText(/для игр подойдёт эта сборка/)).toBeVisible();
    // Recommendation card + CTA appear.
    await expect(page.getByRole("heading", { name: "Рекомендация готова" })).toBeVisible();
    const cta = page.getByRole("button", { name: "Открыть сборку" });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\/ready\/ready-gaming/);
  });

  test("keeps focus in the input after a reply (send via button and Enter)", async ({ page }) => {
    await page.route("**/api/ai/advisor/chat", async (route) => {
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
        body: ndjson([
          { event: "start", deadlineMs: 45000 },
          { event: "delta", text: "Для чего нужен компьютер?" },
          { event: "done" },
        ]),
      });
    });

    await page.goto("/auto?mode=ai");
    const input = page.getByRole("textbox", { name: "Сообщение для AI-помощника" });

    await input.fill("Бюджет 100000");
    await page.getByRole("button", { name: "Отправить" }).click();
    await expect(page.getByText("Для чего нужен компьютер?")).toHaveCount(1);
    await expect(input).toBeFocused();

    await page.keyboard.type("Для игр");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Для чего нужен компьютер?")).toHaveCount(2);
    await expect(input).toBeFocused();
    await expect(input).toBeEnabled();
  });

  test("deep link ?mode=ai activates the AI tab", async ({ page }) => {
    await page.goto("/auto?mode=ai");
    await expect(page.getByRole("tab", { name: "Подбор с помощью AI-бота" })).toHaveAttribute(
      "data-state",
      "active",
    );
    // The plain survey steps are not active on the AI tab.
    await expect(page.getByText("Шаг 1 из 4")).toHaveCount(0);
  });

  test("shows unconfigured error when the endpoint returns 503", async ({ page }) => {
    await page.route("**/api/ai/advisor/chat", async (route) => {
      route.fulfill({
        status: 503,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "ai_not_configured" }),
      });
    });

    await page.goto("/auto?mode=ai");
    await page.getByRole("textbox", { name: "Сообщение для AI-помощника" }).fill("Привет");
    await page.getByRole("button", { name: "Отправить" }).click();
    await expect(page.getByText(/AI-помощник ещё не настроен/)).toBeVisible();
  });

  test("shows rate-limit message when the endpoint returns 429", async ({ page }) => {
    await page.route("**/api/ai/advisor/chat", async (route) => {
      route.fulfill({
        status: 429,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "rate_limited" }),
      });
    });

    await page.goto("/auto?mode=ai");
    await page.getByRole("textbox", { name: "Сообщение для AI-помощника" }).fill("Ещё вопрос");
    await page.getByRole("button", { name: "Отправить" }).click();
    await expect(page.getByText(/Слишком много сообщений/)).toBeVisible();
  });

  test("never displays the JSON envelope fenced block", async ({ page }) => {
    await page.route("**/api/ai/advisor/chat", async (route) => {
      // Server-side the orchestrator strips the envelope; simulate the client
      // receiving only visible deltas (as the server emits after the fix).
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
        body: ndjson([
          { event: "start", deadlineMs: 45000 },
          { event: "delta", text: "Игровая сборка подойдёт." },
          { event: "requirements", data: { budget: 140000, usage: "gaming" } },
          { event: "done" },
        ]),
      });
    });

    await page.goto("/auto?mode=ai");
    await page.getByRole("textbox", { name: "Сообщение для AI-помощника" }).fill("Игры 140000");
    await page.getByRole("button", { name: "Отправить" }).click();
    await expect(page.getByText("Игровая сборка подойдёт.")).toBeVisible();
    // The raw envelope/JSON must never render in the chat.
    await expect(page.locator('[role="log"]').getByText(/requirements/)).toHaveCount(0);
    await expect(page.locator('[role="log"]').getByText(/```/)).toHaveCount(0);
  });

  test("survey tab still works alongside the AI tab", async ({ page }) => {
    await page.goto("/auto");
    await expect(page.getByRole("heading", { name: "Автоподбор ПК" })).toBeVisible();
    // Survey tab is active by default; step through to the result.
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Далее" }).click();
    }
    await page.getByRole("button", { name: "Подобрать" }).click();
    await expect(page).toHaveURL(/\/auto\/result/);
  });
});