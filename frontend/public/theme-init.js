// Runs before the page is drawn, so dark-mode users never see a flash of the light theme.
// Keep in sync with src/theme.ts (same storage key and values).
(function () {
  var preference = "system";
  try {
    preference = localStorage.getItem("sendy-theme") || "system";
  } catch (error) {
    // Storage can be blocked (private browsing); fall back to the system setting.
  }
  var dark =
    preference === "dark" ||
    (preference !== "light" &&
      !!window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
