import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { ADMIN, PUBLIC, signIn } from "./helpers";

// WCAG 2.2 A and AA, the level the app aims for. Each project runs this file once in light and
// once in dark mode, so colour contrast is checked in both.
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  // Readable failures: which rule, how bad, and where.
  const found = violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help}\n` +
      violation.nodes.map((node) => `    ${node.target.join(" ")}`).join("\n"),
  );
  expect(found).toEqual([]);
}

const links = { open: "", locked: "" };
// Each project (light, dark) makes its own links; the title tells them apart.
const titles = { open: "", locked: "" };

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }, testInfo) => {
  // Two links to look at as a client: one open, one behind a password.
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page);
  const items = (await (await page.request.get(`${ADMIN}/api/items?limit=100`)).json()) as {
    items: { id: string }[];
  };
  const ids = items.items.map((item) => item.id);
  for (const key of ["open", "locked"] as const) {
    titles[key] = `Northwind review (${key}, ${testInfo.project.name})`;
  }
  for (const [key, extra] of [
    ["open", {}],
    ["locked", { password: "for the locked page" }],
  ] as const) {
    const response = await page.request.post(`${ADMIN}/api/shares`, {
      headers: { "X-Requested-With": "fetch" },
      data: { title: titles[key], item_ids: ids, ...extra },
    });
    expect(response.status()).toBe(201);
    links[key] = ((await response.json()) as { url: string }).url;
  }
  await context.close();
});

test.describe("admin", () => {
  test("sign-in page", async ({ page }) => {
    await page.goto(`${ADMIN}/login`);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expectAccessible(page);
  });

  test("library", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("button", { name: /^Open / }).first()).toBeVisible();
    await expectAccessible(page);
  });

  test("library: lightbox", async ({ page }) => {
    await signIn(page);
    await page
      .getByRole("button", { name: /^Open / })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page);
  });

  test("library: share dialog", async ({ page }) => {
    await signIn(page);
    await page
      .getByRole("button", { name: /^Actions for / })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Share…" }).click();
    await expect(page.getByRole("dialog", { name: "Share" })).toBeVisible();
    await expectAccessible(page);
  });

  test("shares", async ({ page }) => {
    await signIn(page);
    await page.goto(`${ADMIN}/shares`);
    await expect(page.getByText(titles.open)).toBeVisible();
    await expectAccessible(page);
  });

  test("activity", async ({ page }) => {
    await signIn(page);
    await page.goto(`${ADMIN}/activity`);
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    // The sign-ins above are logged, so the table has rows to check.
    await expect(page.getByRole("table").or(page.getByRole("list")).first()).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe("client", () => {
  test("share page", async ({ page }) => {
    await page.goto(links.open);
    await expect(page.getByRole("heading", { name: titles.open })).toBeVisible();
    await expectAccessible(page);
  });

  test("share page: image viewer", async ({ page }) => {
    await page.goto(links.open);
    await page
      .getByRole("button", { name: /full size$/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectAccessible(page);
  });

  test("password page", async ({ page }) => {
    await page.goto(links.locked);
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expectAccessible(page);
  });

  test("unknown link", async ({ page }) => {
    await page.goto(`${PUBLIC}/s/does-not-exist`);
    await expect(page.getByRole("heading", { name: "This link doesn't exist" })).toBeVisible();
    await expectAccessible(page);
  });
});
