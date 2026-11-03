import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";

import { cn } from "../lib/cn";
import { type ThemePreference, useThemePreference } from "../theme";

const options = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const satisfies readonly { value: ThemePreference; label: string; icon: LucideIcon }[];

/** Native radio buttons, so arrow keys, Tab and screen readers work without extra code. */
export function ThemeSwitcher() {
  const [preference, choose] = useThemePreference();
  // Unique per switcher: radios sharing a name form one group across the whole page.
  const name = useId();

  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="flex rounded-control bg-zinc-100 p-0.5 dark:bg-zinc-800">
        {options.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            title={label}
            className={cn(
              "flex flex-1 cursor-pointer items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] py-1.5 text-zinc-600 dark:text-zinc-400",
              "has-checked:bg-white has-checked:text-zinc-900 has-checked:shadow-sm dark:has-checked:bg-zinc-700 dark:has-checked:text-zinc-100",
              "has-focus-visible:outline-2 has-focus-visible:outline-brand-500",
            )}
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={preference === value}
              onChange={() => choose(value)}
              className="sr-only"
            />
            <Icon className="size-4" aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
