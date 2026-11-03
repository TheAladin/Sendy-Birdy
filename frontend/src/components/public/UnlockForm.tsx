import { Eye, EyeOff, Lock } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { useUnlockShare } from "../../api/public";
import { ApiError } from "../../api/errors";
import { useDocumentTitle } from "../../lib/useDocumentTitle";
import { Button, IconButton } from "../ui/Button";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";

/** "2 minutes", "45 seconds": how long until another attempt is allowed. */
function waitText(seconds: number): string {
  if (seconds >= 90) return `${Math.ceil(seconds / 60)} minutes`;
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/** A number of seconds that counts itself down to 0, one second at a time. */
function useCountdown(): [number, (seconds: number) => void] {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return [seconds, setSeconds];
}

export function UnlockForm({ token, sharedBy }: { token: string; sharedBy: string }) {
  useDocumentTitle("Password required");
  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string>();
  const unlock = useUnlockShare(token);
  const [wait, startWait] = useCountdown();
  const blocked = wait > 0;
  const ask = sharedBy ? `Ask ${sharedBy}` : "Ask the person who sent the link";

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (blocked) return;
    if (!password) {
      setError("Enter the password.");
      inputRef.current?.focus();
      return;
    }
    setError(undefined);
    unlock.mutate(password, {
      onError: (failure) => {
        if (failure instanceof ApiError && failure.status === 429) {
          startWait(failure.retryAfterSeconds ?? 60);
          setError(undefined);
        } else if (failure instanceof ApiError && failure.status === 401) {
          setError(`That password isn't right. ${ask} to check it.`);
          // Ready to retype: the whole wrong attempt is selected.
          inputRef.current?.select();
        } else if (!(failure instanceof ApiError && [404, 410].includes(failure.status))) {
          setError("Something went wrong. Check your connection and try again.");
        }
      },
    });
  };

  return (
    <div className="mx-auto max-w-sm py-12">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
        <Lock className="size-6" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-center text-xl font-semibold tracking-tight">
        This link is protected by a password
      </h1>
      <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
        {sharedBy ? `${sharedBy} added a password. ` : ""}Enter the one you were given.
      </p>

      <form className="mt-8 grid gap-4" onSubmit={onSubmit} noValidate>
        <Field label="Password" error={error}>
          {(control) => (
            <div className="relative">
              <Input
                ref={inputRef}
                // Typing right away is the only thing to do on this page.
                // eslint-disable-next-line jsx-a11y-x/no-autofocus
                autoFocus
                type={visible ? "text" : "password"}
                value={password}
                // Each link has its own password; offering to save it for the site would mislead.
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={128}
                onChange={(event) => setPassword(event.target.value)}
                className="pr-11"
                {...control}
              />
              <IconButton
                label={visible ? "Hide password" : "Show password"}
                aria-pressed={visible}
                icon={visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                className="absolute top-0.5 right-0.5 size-9"
                onClick={() => setVisible((shown) => !shown)}
              />
            </div>
          )}
        </Field>

        {blocked && (
          <p
            role="alert"
            className="rounded-control bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
          >
            Too many attempts. Try again in{" "}
            <span className="font-medium tabular-nums">{waitText(wait)}</span>.
          </p>
        )}

        <Button type="submit" loading={unlock.isPending} disabled={blocked} className="w-full">
          Open
        </Button>
      </form>
    </div>
  );
}
