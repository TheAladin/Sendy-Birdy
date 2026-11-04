import { expect, type Locator, type Page, test } from "@playwright/test";

import { adminAccount, ADMIN, SCREENSHOT } from "./helpers";

// The main path again, with the keyboard only: no clicks anywhere. Each control is reached by
// pressing Tab, the way someone who can't use a mouse would get there.

const TITLE = "Pricing table v3";
const PASSWORD = "quiet-otter-17";

/** Presses Tab until `target` has focus (fails if it's never reached). */
async function tabTo(page: Page, target: Locator, max = 80): Promise<void> {
  for (let presses = 0; presses < max; presses++) {
    const focused = await target.evaluate((element) => element === document.activeElement, null, {
      timeout: 1_000,
    });
    if (focused) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${target.toString()}`);
}

test("the whole path works with the keyboard alone", async ({ page, browser }) => {
  await test.step("sign in", async () => {
    await page.goto(`${ADMIN}/login`);
    await tabTo(page, page.getByLabel("Email"));
    await page.keyboard.type(adminAccount.email);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password")).toBeFocused();
    await page.keyboard.type(adminAccount.password);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  });

  await test.step("the skip link jumps to the content", async () => {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  await test.step("open the viewer, move through it, and close it", async () => {
    const first = page.getByRole("button", { name: /^Open / }).first();
    await tabTo(page, first);
    await page.keyboard.press("Enter");
    const viewer = page.getByRole("dialog");
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText(/^1 of \d+$/)).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(viewer.getByText(/^2 of \d+$/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(first).toBeFocused();
  });

  await test.step("upload a screenshot", async () => {
    await tabTo(page, page.getByRole("button", { name: "Upload", exact: true }));
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    // The system file dialog itself is outside the page; choosing the file is the one step a
    // test can't do with page keys.
    await (
      await chooser
    ).setFiles({ name: `${TITLE}.png`, mimeType: "image/png", buffer: SCREENSHOT });
    await expect(page.getByRole("button", { name: `Actions for ${TITLE}` })).toBeVisible();
  });

  let link = "";
  await test.step("share it with a password from the card's menu", async () => {
    await tabTo(page, page.getByRole("button", { name: `Actions for ${TITLE}` }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Share…" })).toBeFocused();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Share" });
    // The title is prefilled and focused.
    await expect(dialog.getByLabel("Title")).toBeFocused();
    await tabTo(page, dialog.getByLabel("Require a password"));
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("textbox", { name: "Password" })).toBeFocused();
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Enter");

    const ready = page.getByRole("dialog", { name: "Link ready" });
    await expect(ready.getByRole("button", { name: /^Cop/ })).toBeFocused();
    link = await ready.getByLabel("Link").inputValue();
    await page.keyboard.press("Escape");
    await expect(ready).toBeHidden();
  });

  const client = await browser.newContext();
  const visitor = await client.newPage();

  await test.step("the client unlocks it", async () => {
    await visitor.goto(link);
    const password = visitor.getByLabel("Password", { exact: true });
    await expect(password).toBeFocused();
    await visitor.keyboard.type("wrong guess");
    await visitor.keyboard.press("Enter");
    await expect(visitor.getByText("That password isn't right.")).toBeVisible();
    // The failed attempt is selected, so typing replaces it.
    await expect(password).toBeFocused();
    await visitor.keyboard.type(PASSWORD);
    await visitor.keyboard.press("Enter");

    const preview = visitor.getByRole("button", { name: `View ${TITLE} full size` });
    await expect(preview).toBeVisible();
    await tabTo(visitor, preview);
    await visitor.keyboard.press("Enter");
    await expect(visitor.getByRole("dialog")).toBeVisible();
    await visitor.keyboard.press("Escape");
    await expect(visitor.getByRole("dialog")).toBeHidden();
    await expect(preview).toBeFocused();
  });

  await test.step("revoke it from the Shares page", async () => {
    await tabTo(page, page.getByRole("link", { name: "Shares" }).first());
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Shares", level: 1 })).toBeVisible();

    await tabTo(page, page.getByRole("button", { name: `Actions for ${TITLE}` }));
    await page.keyboard.press("Enter");
    const revoke = page.getByRole("menuitem", { name: "Revoke" });
    for (
      let presses = 0;
      presses < 10 && !(await revoke.evaluate((e) => e === document.activeElement));
      presses++
    ) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(revoke).toBeFocused();
    await page.keyboard.press("Enter");

    const confirm = page.getByRole("button", { name: "Revoke link" });
    await tabTo(page, confirm);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Revoked", { exact: true }).first()).toBeVisible();
  });

  await test.step("the client's page says it's gone", async () => {
    await visitor.reload();
    await expect(
      visitor.getByRole("heading", { name: "This link is no longer available" }),
    ).toBeVisible();
  });

  await client.close();
});
