import { Link } from "react-router";

import { LogoMark } from "../components/brand/Logo";
import { useDocumentTitle } from "../lib/useDocumentTitle";

export default function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <LogoMark className="mx-auto size-12" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          This bird flew off somewhere. The address may be mistyped.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-control bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800"
        >
          Back to the start
        </Link>
      </div>
    </main>
  );
}
