import { CircleAlert } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import { useLogin, useMe } from "../api/auth";
import { ApiError } from "../api/errors";
import { Logo } from "../components/brand/Logo";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Display";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { safeRedirect } from "../lib/safeRedirect";

function describeError(error: Error): string {
  if (!(error instanceof ApiError)) return "Can't reach the server. Check your connection.";
  if (error.status === 401) return "Wrong email or password.";
  if (error.status === 429) {
    const minutes = Math.ceil((error.retryAfterSeconds ?? 60) / 60);
    return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  return "Something went wrong on the server. Please try again.";
}

export default function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = safeRedirect(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (me.data) return <Navigate to={next} replace />;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    login.mutate(
      { email, password },
      {
        onSuccess: () => void navigate(next, { replace: true }),
        onError: () => setPassword(""),
      },
    );
  };

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card className="p-8">
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Welcome back. Sign in to manage your files and links.
          </p>

          {login.error && (
            <div
              role="alert"
              className="mt-6 flex gap-2 rounded-control bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {describeError(login.error)}
            </div>
          )}

          <form className="mt-6 grid gap-5" onSubmit={onSubmit}>
            <Field label="Email">
              {(control) => (
                <Input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  {...control}
                />
              )}
            </Field>
            <Field label="Password">
              {(control) => (
                <Input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  {...control}
                />
              )}
            </Field>
            <Button type="submit" loading={login.isPending} className="mt-1 w-full">
              Sign in
            </Button>
          </form>
        </Card>
        <p className="mt-6 text-center text-xs text-zinc-600 dark:text-zinc-400">
          Forgot your password? Reset it on the server with{" "}
          <code className="font-mono whitespace-nowrap">update-admin --password</code>.
        </p>
      </div>
    </main>
  );
}
