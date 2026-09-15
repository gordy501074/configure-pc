import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Moon, Sun } from "lucide-react";

import { Button } from "./Button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useToast } from "./Toast";

const NAV = [
  { to: "/", label: "Главная" },
  { to: "/ready", label: "Готовые ПК" },
  { to: "/config", label: "Конфигуратор" },
  { to: "/auto", label: "Автоподбор" },
];

export function Navbar() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleSignOut = () => {
    signOut();
    toast("Вы вышли из аккаунта", "info");
    navigate("/");
  };

  const isDark = theme === "dark";

  return (
    <header className="sticky top-0 z-40 border-b bg-card">
      <nav
        className="container flex min-h-16 items-center gap-4"
        aria-label="Основная навигация"
      >
        <Link
          to="/"
          className="flex min-h-11 items-center gap-2 text-lg font-bold text-foreground no-underline"
          aria-label="Сконфигурируй'КА — на главную"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
            С
          </span>
          <span className="hidden whitespace-nowrap sm:inline">
            Сконфигурируй'КА
          </span>
        </Link>

        <ul
          id="main-menu"
          className={cn(
            "flex flex-1 items-center gap-1",
            "m-0 list-none border-b bg-card p-2",
            "hidden md:flex md:border-0 md:bg-transparent md:p-0",
            open && "absolute inset-x-0 top-16 z-50 flex-col items-stretch gap-1 md:static md:h-auto md:flex-row md:items-center",
            open && "md:flex",
          )}
        >
          {NAV.map((item) => (
            <li key={item.to} className="m-0 list-none">
              <NavLink
                to={item.to}
                end={item.to === "/"}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "inline-flex min-h-11 items-center rounded-md px-3 font-medium text-muted-foreground no-underline transition-colors hover:bg-accent hover:text-foreground",
                    isActive && "bg-primary/10 text-foreground font-semibold",
                  )
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
            aria-pressed={isDark}
            title={isDark ? "Светлая тема" : "Тёмная тема"}
          >
            {isDark ? <Sun /> : <Moon />}
          </Button>

          {user ? (
            <>
              <Link
                to="/profile"
                onClick={() => setOpen(false)}
                className="hidden items-center gap-2 rounded-md px-2 text-foreground no-underline hover:bg-accent sm:inline-flex"
                aria-label={`Профиль: ${user.name}`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                  {user.name.charAt(0).toUpperCase()}
                </span>
                <span className="max-w-28 truncate text-sm font-semibold">
                  {user.name}
                </span>
              </Link>
              <Button
                variant="ghost"
                onClick={handleSignOut}
                className="hidden sm:inline-flex"
              >
                Выйти
              </Button>
            </>
          ) : (
            <Link to="/auth" onClick={() => setOpen(false)}>
              <Button>Войти</Button>
            </Link>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-expanded={open}
            aria-controls="main-menu"
            aria-label={open ? "Закрыть меню" : "Открыть меню"}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="relative flex h-4 w-5 flex-col justify-center gap-[5px]">
              <span
                className={cn(
                  "h-0.5 w-full rounded bg-current transition-transform",
                  open && "translate-y-[7px] rotate-45",
                )}
              />
              <span
                className={cn(
                  "h-0.5 w-full rounded bg-current transition-opacity",
                  open && "opacity-0",
                )}
              />
              <span
                className={cn(
                  "h-0.5 w-full rounded bg-current transition-transform",
                  open && "-translate-y-[7px] -rotate-45",
                )}
              />
            </span>
          </Button>
        </div>
      </nav>
    </header>
  );
}