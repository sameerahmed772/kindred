import { test, expect } from "@playwright/test";

test("unauthenticated visitors redirect to /login and health endpoint responds", async ({ page }) => {
  const health = await page.request.get("/api/health");
  expect(health.status()).toBe(200);
  const json = await health.json();
  expect(json.status).toBe("ok");

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("Kindred")).toBeVisible();
});

test("authenticated user can sign in and export GDPR JSON", async ({ page }) => {
  test.skip(
    !process.env.TEST_USER_A_EMAIL || !process.env.TEST_USER_A_PASSWORD,
    "Set TEST_USER_A_EMAIL and TEST_USER_A_PASSWORD to run authenticated E2E flow."
  );

  await page.goto("/login");
  await page.fill('input[type="email"]', process.env.TEST_USER_A_EMAIL!);
  await page.fill('input[type="password"]', process.env.TEST_USER_A_PASSWORD!);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL("/");

  const exportRes = await page.request.get("/api/account/export");
  expect(exportRes.status()).toBe(200);
  const data = await exportRes.json();
  expect(data).toHaveProperty("companions");
  expect(data).toHaveProperty("memories");
});
