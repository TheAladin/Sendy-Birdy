import { expect, type Page, test } from "@playwright/test";

import { ADMIN, signIn } from "./helpers";

// The README's screenshots, taken from the demo library (`make screenshots`). Each project takes
// the same pictures in its own colour scheme.

const OUT = "../docs/screenshots";
const MAIN_TITLE = "Northwind: dashboard redesign, round 2";
const MESSAGE =
  "Hi Sam,\n\nHere's where the dashboard stands after Tuesday's call. The **reports page** is new, " +
  "and the walkthrough shows the onboarding flow end to end.\n\nLet me know what you think!";

type Share = { id: string; title: string; url: string };

const headers = { "X-Requested-With": "fetch" };
let mainLink = "";

test.describe.configure({ mode: "serial" });

function shot(page: Page, name: string): Promise<Buffer> {
  const scheme = test.info().project.use.colorScheme ?? "light";
  return page.screenshot({ path: `${OUT}/${name}-${scheme}.png`, animations: "disabled" });
}

async function settle(page: Page): Promise<void> {
  // Lazy thumbnails and the font must be in before the picture is taken.
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

test.beforeAll(async ({ browser }) => {
  // The first project makes the links; the second finds them, so the Shares page doesn't repeat.
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page);
  const existing = (await (await page.request.get(`${ADMIN}/api/shares`)).json()) as Share[];
  const found = existing.find((share) => share.title === MAIN_TITLE);
  if (found) {
    mainLink = found.url;
    await context.close();
    return;
  }
  const { items } = (await (await page.request.get(`${ADMIN}/api/items?limit=100`)).json()) as {
    items: { id: string; kind: string; title: string }[];
  };
  const ids = items.map((item) => item.id);
  const byKind = (kind: string) =>
    items.filter((item) => item.kind === kind).map((item) => item.id);
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const create = async (data: object): Promise<Share> => {
    const response = await page.request.post(`${ADMIN}/api/shares`, { headers, data });
    expect(response.status()).toBe(201);
    return (await response.json()) as Share;
  };

  const main = await create({
    title: MAIN_TITLE,
    message: MESSAGE,
    // Pictures first: that's what a client sees on opening the link.
    item_ids: [...byKind("image").slice(0, 4), ...byKind("video"), ...byKind("note").slice(0, 1)],
    expires_at: inDays(7),
    allow_downloads: true,
  });
  mainLink = main.url;
  await create({
    title: "Contract notes for legal",
    item_ids: byKind("note"),
    expires_at: inDays(1),
    password: "northwind",
  });
  await create({ title: "Pricing page draft", item_ids: ids.slice(2, 4), expires_at: inDays(30) });
  const old = await create({ title: "First mockups", item_ids: ids.slice(4, 6) });
  await page.request.post(`${ADMIN}/api/shares/${old.id}/revoke`, { headers });

  // A few visits from "clients", so views and the activity log aren't empty.
  for (let visit = 0; visit < 3; visit += 1) {
    const client = await browser.newContext();
    await (await client.newPage()).request.get(mainLink.replace("/s/", "/api/public/shares/"));
    await client.close();
  }
  await context.close();
});

test("library", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("button", { name: /^Open / }).first()).toBeVisible();
  // Away from the cards, so no card shows its hover menu.
  await page.mouse.move(0, 0);
  await settle(page);
  await shot(page, "library");
});

test("share dialog", async ({ page }) => {
  // Tall enough for the whole dialog, footer included.
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await page.getByRole("button", { name: "Actions for Pricing page" }).click();
  await page.getByRole("menuitem", { name: "Select" }).click();
  for (const title of ["Analytics dashboard", "Checkout flow - mobile"]) {
    await page.getByRole("checkbox", { name: `Select ${title}` }).check();
  }
  await page
    .getByRole("region", { name: "Selection" })
    .getByRole("button", { name: "Share" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Title").fill("Northwind: new reports page");
  await settle(page);
  await shot(page, "share-dialog");
});

test("shares", async ({ page }) => {
  await signIn(page);
  await page.goto(`${ADMIN}/shares`);
  await expect(page.getByText(MAIN_TITLE)).toBeVisible();
  await settle(page);
  await shot(page, "shares");
});

test("share page on a phone", async ({ browser }) => {
  const scheme = test.info().project.use.colorScheme;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: scheme,
  });
  const page = await context.newPage();
  await page.goto(mainLink);
  await expect(page.getByRole("heading", { name: MAIN_TITLE })).toBeVisible();
  await settle(page);
  await shot(page, "share-page");
  await context.close();
});
