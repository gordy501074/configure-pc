import { Link } from "react-router-dom";

import { Badge, Card, StarRating } from "../ui";
import { formatPrice, USAGE_LABELS } from "../../lib/format";
import type { ReadyPc } from "../../types";

export function ReadyPcCard({ pc }: { pc: ReadyPc }) {
  return (
    <Link to={`/ready/${pc.id}`} className="block h-full no-underline">
      <Card className="group h-full gap-0 p-4 transition-shadow hover:shadow-md">
        <div className="flex flex-wrap gap-2">
          <Badge variant={pc.inStock ? "success" : "neutral"}>
            {pc.inStock ? "В наличии" : "Под заказ"}
          </Badge>
          <Badge variant="info">{USAGE_LABELS[pc.usage] ?? pc.usage}</Badge>
        </div>

        <h3 className="mt-3 text-lg font-semibold text-foreground">
          {pc.name}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{pc.summary}</p>

        <div className="mt-3">
          <StarRating value={pc.rating} showValue reviewCount={pc.reviewCount} />
        </div>

        <div className="mt-4 grid gap-2">
          {pc.specs.slice(0, 3).map((s) => (
            <div
              key={s.label}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-medium">{s.value}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <span className="text-xl font-bold text-foreground">
            {formatPrice(pc.price)}
          </span>
          <span className="text-sm text-muted-foreground">{pc.tdp} Вт</span>
        </div>
      </Card>
    </Link>
  );
}