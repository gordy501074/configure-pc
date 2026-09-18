// Shared seller selection hook for the catalog/configurator screens.
// Defaults to ConfiГУРА (`usr-seller`); falls back to the first seller when the
// default is absent from the seller list.

import { useCallback, useEffect, useState } from "react";
import { fetchSellerSummaries } from "./api";
import type { SellerSummary } from "../types";

export const DEFAULT_SELLER_ID = "usr-seller";

export interface SellerSelection {
  sellerId: string;
  sellers: SellerSummary[];
  setSellerId: (id: string) => void;
  loading: boolean;
}

export function useSeller(): SellerSelection {
  const [sellers, setSellers] = useState<SellerSummary[]>([]);
  const [sellerId, setSellerIdState] = useState<string>(DEFAULT_SELLER_ID);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchSellerSummaries()
      .then((list) => {
        if (cancelled) return;
        setSellers(list);
        setLoading(false);
        // Ensure the default (or fallback) is a real seller.
        if (list.length > 0) {
          setSellerIdState((cur) =>
            list.some((s) => s.id === cur) ? cur : list[0].id,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSellerId = useCallback((id: string) => {
    setSellerIdState(id);
  }, []);

  return { sellerId, sellers, setSellerId, loading };
}