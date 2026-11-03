import { useSyncExternalStore } from "react";

// Keep in sync with public/theme-init.js, which applies the theme before the first paint.
const STORAGE_KEY = "sendy-theme";

export type ThemePreference = "system" | "light" | "dark";

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && darkQuery().matches);
  document.documentElement.classList.toggle("dark", dark);
}

const listeners = new Set<() => void>();

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Storage blocked: the choice still applies until the page is reloaded.
  }
  applyTheme(preference);
  listeners.forEach((listener) => listener());
}

/** Keeps "system" in step with the OS when it switches between light and dark. */
export function followSystemTheme() {
  applyTheme(getThemePreference());
  darkQuery().addEventListener("change", () => {
    if (getThemePreference() === "system") applyTheme("system");
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current preference, shared by every switcher on the page, and a setter. */
export function useThemePreference() {
  const preference = useSyncExternalStore(subscribe, getThemePreference);
  return [preference, setThemePreference] as const;
}
