export type ExpiryChoice = "1d" | "7d" | "30d" | "custom" | "never";

export const EXPIRY_CHOICES: { value: ExpiryChoice; label: string }[] = [
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "custom", label: "Pick a date" },
  { value: "never", label: "Never" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-11-03" in the user's own time zone, as `<input type="date">` uses. */
export function toDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * When a link should stop working. A picked date means the end of that day where the user is,
 * so "until Friday" includes Friday. null means never.
 */
export function expiryDate(
  choice: ExpiryChoice,
  customDate: string,
  now = new Date(),
): Date | null {
  switch (choice) {
    case "1d":
      return new Date(now.getTime() + DAY_MS);
    case "7d":
      return new Date(now.getTime() + 7 * DAY_MS);
    case "30d":
      return new Date(now.getTime() + 30 * DAY_MS);
    case "never":
      return null;
    case "custom": {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(customDate);
      if (!match) return null;
      const [, year, month, day] = match.map(Number) as [number, number, number, number];
      return new Date(year, month - 1, day, 23, 59, 59);
    }
  }
}

/** "keep" leaves an existing link's expiry as it is. */
export type ExpiryValue = ExpiryChoice | "keep";

export interface ExpiryState {
  choice: ExpiryValue;
  customDate: string;
}

/** The moment chosen (null: never), or undefined for "keep". */
export function chosenExpiry(state: ExpiryState): Date | null | undefined {
  return state.choice === "keep" ? undefined : expiryDate(state.choice, state.customDate);
}

export function expiryError(state: ExpiryState): string | undefined {
  if (state.choice !== "custom") return undefined;
  if (!state.customDate) return "Pick the last day the link works.";
  const date = chosenExpiry(state);
  return date && date <= new Date() ? "Pick a date in the future." : undefined;
}
