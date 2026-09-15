// @group smoke
// Onboarding is the entry gate for all routes — a must-not-break flow.

import { test, expect } from "@playwright/test";

test.describe("smoke: onboarding gate", () => {
  test("@smoke un-onboarded user is gated, completion un-gates home", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // Un-onboard (via API) so the gate is truly exercised.
    const resp = await page.request.post("/api/onboarding", { data: { onboarded: false } });
    expect(resp.ok()).toBeTruthy();

    await page.goto("/");
    // Redirection to the onboarding screen happens.
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { name: /Добро пожаловать/ })).toBeVisible();

    // "Пропустить" completes onboarding (writes onboarded=true) and navigates home.
    await page.getByRole("button", { name: "Пропустить" }).click();

    // The gate must no longer block: home is reachable directly now.
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "Соберите компьютер, который решает ваши задачи" }),
    ).toBeVisible();
    expect(errors, "page errors during onboarding").toEqual([]);

    // Re-enable onboarding so other tests (which assume onboarded) remain valid.
    await page.request.post("/api/onboarding", { data: { onboarded: true } });
  });
});