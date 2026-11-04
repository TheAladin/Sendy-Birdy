import { expect, test } from "@playwright/test";

import { PUBLIC, SCREENSHOT, signIn } from "./helpers";

const TITLE = "Checkout redesign";
const PASSWORD = "blue-heron-42";

test("upload, share with a password, open it as the client, then revoke it", async ({
  page,
  browser,
}) => {
  await test.step("sign in", async () => {
    await signIn(page);
  });

  await test.step("upload a screenshot", async () => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: `${TITLE}.png`, mimeType: "image/png", buffer: SCREENSHOT });
    await expect(page.getByRole("button", { name: `Actions for ${TITLE}` })).toBeVisible();
  });

  let link = "";
  await test.step("share it with a password", async () => {
    await page.getByRole("button", { name: `Actions for ${TITLE}` }).click();
    await page.getByRole("menuitem", { name: "Share…" }).click();
    const dialog = page.getByRole("dialog", { name: "Share" });
    await expect(dialog.getByLabel("Title")).toHaveValue(TITLE);
    await dialog.getByLabel("Require a password").check();
    await dialog.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
    await dialog.getByRole("button", { name: "Create link" }).click();

    const ready = page.getByRole("dialog", { name: "Link ready" });
    link = await ready.getByLabel("Link").inputValue();
    expect(link).toMatch(new RegExp(`^${PUBLIC}/s/[\\w-]+$`));
    await ready.getByRole("button", { name: "Done" }).click();
  });

  // A separate browser context: no cookies, nothing shared with the admin's session.
  const client = await browser.newContext();
  const visitor = await client.newPage();

  await test.step("the client needs the password", async () => {
    await visitor.goto(link);
    await expect(visitor.getByRole("heading", { name: /password/i })).toBeVisible();
    await expect(visitor.getByRole("button", { name: `View ${TITLE} full size` })).toHaveCount(0);

    await visitor.getByLabel("Password", { exact: true }).fill("not the password");
    await visitor.getByRole("button", { name: "Open" }).click();
    await expect(visitor.getByText("That password isn't right.")).toBeVisible();
  });

  await test.step("the right password shows the screenshot", async () => {
    await visitor.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await visitor.getByRole("button", { name: "Open" }).click();

    const preview = visitor.getByRole("button", { name: `View ${TITLE} full size` });
    await expect(preview).toBeVisible();
    // The thumbnail really loaded (made by the server from our upload).
    await expect
      .poll(() => preview.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);

    await preview.click();
    const viewer = visitor.getByRole("dialog");
    await expect(viewer.getByRole("img", { name: TITLE })).toBeVisible();
    await viewer.getByRole("button", { name: "Close" }).click();
  });

  await test.step("revoke the link from the Shares page", async () => {
    await page.getByRole("link", { name: "Shares" }).first().click();
    await page.getByRole("button", { name: `Actions for ${TITLE}` }).click();
    await page.getByRole("menuitem", { name: "Revoke" }).click();
    await page.getByRole("button", { name: "Revoke link" }).click();
    await expect(page.getByText("Revoked", { exact: true }).first()).toBeVisible();
  });

  await test.step("the link now says it's been turned off", async () => {
    await visitor.reload();
    await expect(
      visitor.getByRole("heading", { name: "This link is no longer available" }),
    ).toBeVisible();
    await expect(visitor.getByRole("button", { name: `View ${TITLE} full size` })).toHaveCount(0);
  });

  await client.close();
});
