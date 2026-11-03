import { Activity, Images, Link2, LogOut, Menu as MenuIcon } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";

import { useLogout, useMe } from "../api/auth";
import { cn } from "../lib/cn";
import { Logo } from "./brand/Logo";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { IconButton } from "./ui/Button";
import { Sheet } from "./ui/Sheet";

const links = [
  { to: "/", label: "Library", icon: Images },
  { to: "/shares", label: "Shares", icon: Link2 },
  { to: "/activity", label: "Activity", icon: Activity },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main">
      <ul className="grid gap-1">
        {links.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === "/"}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium",
                  isActive
                    ? "bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                )
              }
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Account() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{me.data?.display_name}</p>
        <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">{me.data?.email}</p>
      </div>
      <IconButton
        label="Sign out"
        icon={<LogOut className="size-4" />}
        loading={logout.isPending}
        onClick={() =>
          logout.mutate(undefined, {
            onSettled: () => void navigate("/login", { replace: true }),
          })
        }
      />
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-8 p-4">
      <Logo className="px-2 pt-2" />
      <div className="flex-1">
        <Navigation onNavigate={onNavigate} />
      </div>
      <ThemeSwitcher />
      <Account />
    </div>
  );
}

/** The frame around every admin page: sidebar on large screens, top bar + slide-over on phones. */
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow-card dark:focus:bg-zinc-900"
      >
        Skip to content
      </a>

      <aside className="hidden border-r border-zinc-200 bg-white lg:block dark:border-zinc-800 dark:bg-zinc-900">
        <div className="sticky top-0 h-dvh">
          <SidebarContent />
        </div>
      </aside>

      <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2 lg:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <IconButton
          label="Open navigation"
          icon={<MenuIcon className="size-5" />}
          onClick={() => setMenuOpen(true)}
        />
        <Logo />
      </header>
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} label="Navigation">
        {/* Following a link in the slide-over closes it. */}
        <SidebarContent onNavigate={() => setMenuOpen(false)} />
      </Sheet>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 lg:py-10">
        <Outlet />
      </main>
    </div>
  );
}
