import { useEffect, useRef } from "react";
import { useBob } from "@/contexts/BobContext";

interface PagePublisherOptions {
  filters?: Record<string, any>;
  selectedVehicle?: {
    id: string;
    make?: string;
    model?: string;
    variant?: string;
    year?: number;
    km?: number;
    price?: number;
    source?: string;
    score?: number;
  } | null;
  searchTerms?: string;
  sortState?: string;
  metrics?: Record<string, any>;
  vehicleIds?: string[];
}

/**
 * Publish the current page's filter/selection state into Bob's context so the
 * assistant knows what the dealer is looking at. Updates are shallow-merged
 * and only fire when the relevant slice actually changes.
 */
export function useBobPagePublisher(options: PagePublisherOptions) {
  const { setPageContext } = useBob();
  const lastSerializedRef = useRef<string>("");

  useEffect(() => {
    const update: Record<string, any> = {};
    if (options.filters !== undefined) update.filters = options.filters;
    if (options.selectedVehicle !== undefined)
      update.selected_vehicle = options.selectedVehicle;
    if (options.searchTerms !== undefined)
      update.search_terms = options.searchTerms;
    if (options.sortState !== undefined) update.sort_state = options.sortState;
    if (options.metrics !== undefined) update.metrics = options.metrics;
    if (options.vehicleIds !== undefined) update.vehicle_ids = options.vehicleIds;

    const serialized = JSON.stringify(update);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;

    setPageContext(update);
  }, [
    setPageContext,
    options.filters,
    options.selectedVehicle,
    options.searchTerms,
    options.sortState,
    options.metrics,
    options.vehicleIds,
  ]);
}
