/**
 * Copies text, returning whether it worked. The Clipboard API only exists on https and
 * localhost, so plain-http addresses (e.g. a LAN IP) fall back to the older copy command.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (no permission, or the page lost focus): try the fallback.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try {
    // Deprecated, but still the only way to copy without the Clipboard API.
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
