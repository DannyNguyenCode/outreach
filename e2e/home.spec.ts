import { expect, test } from "@playwright/test";

test.describe("application smoke", () => {
  test("loads the home page with accessible landmarks", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Outreach" }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });
});
