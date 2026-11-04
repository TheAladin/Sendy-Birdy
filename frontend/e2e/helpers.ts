import { expect, type Page } from "@playwright/test";

// localhost, not 127.0.0.1: browsers treat it as secure, so the Secure session cookie works.
export const ADMIN = "http://localhost:8100";
export const PUBLIC = "http://localhost:8101";

export const adminAccount = {
  email: process.env.E2E_ADMIN_EMAIL ?? "",
  password: process.env.E2E_ADMIN_PASSWORD ?? "",
};

// A 160×100 PNG drawn like a tiny web page, so the upload goes through real image processing.
export const SCREENSHOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAACO1KzYAAAA6klEQVR42u3brQ2EQBCAURaoAUXAUhBNUNb5KwgLQaGwKBAYJMmRCz/v" +
    "6TU7X0ZOSJpPxHPFRiAwAiMwAiMwAiOwwAiMwAiMwAiMwAIjMAJzMWGaF1OwwQiMwAiMwAiMwAIjMAIjMAIjMAK/UnrkUVXmJrVp" +
    "u8EGIzACIzACC2wEAiMwAiMwAiMwe26TbDACIzACIzACI7DACIzACIzA/OTQZUPxHe/1q77OpLXBAiMwAiMwAiMwAguMwAiMwAiM" +
    "wAgsMAIjMAIjMGdz4W+DERiBERiBERiBBUZgBEZgBEZgBBYYgREYgfmrFcAHEI55IZNRAAAAAElFTkSuQmCC",
  "base64",
);

export async function signIn(page: Page): Promise<void> {
  await page.goto(`${ADMIN}/login`);
  await page.getByLabel("Email").fill(adminAccount.email);
  await page.getByLabel("Password").fill(adminAccount.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
}
