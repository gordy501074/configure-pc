import { Fragment } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Хлебные крошки">
      <ol className="m-0 flex list-none flex-wrap items-center gap-1 py-2">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={i}>
              {i > 0 ? (
                <li aria-hidden="true" className="flex items-center text-muted-foreground">
                  <ChevronRight className="size-4" />
                </li>
              ) : null}
              <li className={cn("flex items-center", last ? "font-medium" : "")}>
                {last || !item.to ? (
                  <span
                    className={cn(
                      "text-sm",
                      last ? "text-foreground" : "text-muted-foreground",
                    )}
                    aria-current={last ? "page" : undefined}
                  >
                    {item.label}
                  </span>
                ) : (
                  <Link
                    to={item.to}
                    className="text-sm text-muted-foreground no-underline transition-colors hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}