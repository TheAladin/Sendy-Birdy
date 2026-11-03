import { useId } from "react";

import { cn } from "../../lib/cn";
import {
  chosenExpiry,
  EXPIRY_CHOICES,
  type ExpiryState,
  type ExpiryValue,
  toDateInput,
} from "../../lib/expiry";
import { formatDateTime } from "../../lib/format";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";

interface ExpiryPickerProps {
  legend: string;
  value: ExpiryState;
  onChange: (value: ExpiryState) => void;
  error?: string;
  /** Offers "Keep", describing the current expiry (editing an existing link). */
  current?: string | null;
}

export function ExpiryPicker({ legend, value, onChange, error, current }: ExpiryPickerProps) {
  const name = useId();
  const choices: { value: ExpiryValue; label: string }[] =
    current === undefined ? EXPIRY_CHOICES : [{ value: "keep", label: "Keep" }, ...EXPIRY_CHOICES];
  const date = chosenExpiry(value);

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-1 rounded-control bg-zinc-100 p-1 dark:bg-zinc-800/60">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={cn(
              "cursor-pointer rounded-[calc(var(--radius-control)-0.125rem)] px-3 py-1.5 text-sm font-medium",
              "has-focus-visible:outline-2 has-focus-visible:outline-brand-600",
              value.choice === choice.value
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={value.choice === choice.value}
              onChange={() => onChange({ ...value, choice: choice.value })}
              className="sr-only"
            />
            {choice.label}
          </label>
        ))}
      </div>
      {value.choice === "custom" ? (
        <Field label="Last day" error={error}>
          {(control) => (
            <Input
              type="date"
              min={toDateInput(new Date())}
              value={value.customDate}
              onChange={(event) => onChange({ ...value, customDate: event.target.value })}
              className="w-auto"
              {...control}
            />
          )}
        </Field>
      ) : (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {value.choice === "keep"
            ? current
              ? `Works until ${formatDateTime(new Date(current))}.`
              : "Never expires."
            : date
              ? `Works until ${formatDateTime(date)}.`
              : "Works until you revoke it."}
        </p>
      )}
    </fieldset>
  );
}
