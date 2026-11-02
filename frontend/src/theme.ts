const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function apply(isDark: boolean) {
  document.documentElement.classList.toggle("dark", isDark);
}

// Follows the OS setting for now; a manual switcher replaces this later.
export function followSystemTheme() {
  apply(darkQuery.matches);
  darkQuery.addEventListener("change", (event) => apply(event.matches));
}
