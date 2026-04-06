"use client";

import { useCallback, useMemo, useState } from "react";
import { DualPriceDisplay } from "./tripDualPrice";
import { TripCurrencyContext, TripLocationMapsContext } from "./TripCardContexts";
import { LegFlightsBlock } from "./TripFlights";
import { LegHotelsBlock } from "./TripHotels";
import type { UnknownRecord } from "./tripShared";
import {
  asIsoDate,
  extractTripLocationMaps,
  formatTripSummaryDates,
  isObject,
  pickArray,
  pickNumber,
  pickRecord,
  pickString,
} from "./tripShared";
import {
  applyFlightOptionsReorder,
  applyHotelOptionsReorder,
  computedFlightHotelSummaryParts,
  computeFlightHotelTripTotalsFromRanked,
  getLegsFromRanked,
  rankedTripHasHotelOptions,
  recomputeSummaryTotalsFromRanked,
  sortFlightAndHotelOptionsByRankingInRanked,
} from "./tripRankedModel";

export function RankedTripCard({
  envelope,
  ranked,
  variant = "thumbnail",
}: {
  envelope: UnknownRecord;
  ranked: UnknownRecord;
  /** `thumbnail`: compact inline cards (no ▶/▼). `detailed`: full card (e.g. modal) with chevrons. */
  variant?: "thumbnail" | "detailed";
}) {
  const showExpandChevrons = variant === "detailed";
  const tripIndex = pickNumber(envelope, ["trip_index", "itinerary_index"]);
  const tripCount = pickNumber(envelope, ["trip_count", "itinerary_count"]);

  const [rankedState, setRankedState] = useState<UnknownRecord>(() => {
    const next = structuredClone(ranked);
    sortFlightAndHotelOptionsByRankingInRanked(next);
    recomputeSummaryTotalsFromRanked(next);
    return next;
  });

  const reorderFlightOptions = useCallback((legIndex: number, flightIndex: number, newOptions: unknown[]) => {
    setRankedState((prev) => {
      const next = structuredClone(prev);
      applyFlightOptionsReorder(next, legIndex, flightIndex, newOptions);
      recomputeSummaryTotalsFromRanked(next);
      return next;
    });
  }, []);

  const reorderHotelOptions = useCallback((legIndex: number, hotelIndex: number, newOptions: unknown[]) => {
    setRankedState((prev) => {
      const next = structuredClone(prev);
      applyHotelOptionsReorder(next, legIndex, hotelIndex, newOptions);
      recomputeSummaryTotalsFromRanked(next);
      return next;
    });
  }, []);

  const summary = pickRecord(rankedState, ["summary"]);
  const totalDays = summary ? pickNumber(summary, ["total_duration_days"]) : undefined;
  const tripStartRaw = summary
    ? pickString(summary, ["trip_start_date", "itinerary_start_date", "start_date", "startDate"])
    : undefined;
  const tripEndRaw = summary
    ? pickString(summary, ["trip_end_date", "itinerary_end_date", "end_date", "endDate"])
    : undefined;
  const tripStartIso = tripStartRaw ? asIsoDate(tripStartRaw) : undefined;
  const tripEndIso = tripEndRaw ? asIsoDate(tripEndRaw) : undefined;
  const tripCurrency = summary ? pickString(summary, ["trip_currency", "itinerary_currency"]) : undefined;
  const hasHotelOptionsInData = rankedTripHasHotelOptions(rankedState);

  const { flightsSummaryParts, hotelsSummaryParts } = useMemo(() => {
    const t = computeFlightHotelTripTotalsFromRanked(rankedState);
    return {
      flightsSummaryParts: computedFlightHotelSummaryParts(
        t.flightsTripSum,
        t.flightsContributions,
        tripCurrency
      ),
      hotelsSummaryParts: hasHotelOptionsInData
        ? computedFlightHotelSummaryParts(
            t.hotelsTripSum,
            t.hotelsContributions,
            tripCurrency
          )
        : undefined,
    };
  }, [rankedState, tripCurrency, hasHotelOptionsInData]);

  const legs = getLegsFromRanked(rankedState);
  const legsWithContent = legs.filter((leg) => {
    const f = pickArray(leg, ["flights"]) ?? [];
    const h = pickArray(leg, ["hotels"]) ?? [];
    return f.length > 0 || h.length > 0;
  });

  const locationMaps = useMemo(() => extractTripLocationMaps(rankedState), [rankedState]);

  return (
    <TripCurrencyContext.Provider value={tripCurrency}>
      <TripLocationMapsContext.Provider value={locationMaps}>
      <div className="max-w-full min-w-0 overflow-hidden rounded-xl border border-border bg-surface p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              Trip
              {typeof tripIndex === "number" && typeof tripCount === "number"
                ? ` • ${tripIndex + 1}/${tripCount}`
                : ""}
            </p>
          </div>
        </div>

        {(tripStartIso != null ||
          tripEndIso != null ||
          totalDays != null ||
          flightsSummaryParts != null ||
          hotelsSummaryParts != null ||
          hasHotelOptionsInData) && (
          <div
            className={`mt-3 grid gap-2 ${hasHotelOptionsInData ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}
          >
            <div className="min-w-0 rounded-lg border border-border bg-background/40 p-2 sm:p-2.5">
              <p className="text-[10px] text-muted">Dates</p>
              <p className="text-sm font-medium text-foreground">
                {formatTripSummaryDates(tripStartIso, tripEndIso, totalDays)}
              </p>
            </div>
            <div className="min-w-0 rounded-lg border border-border bg-background/40 p-2 sm:p-2.5">
              <p className="text-[10px] text-muted">Flights</p>
              <p className="text-sm font-medium text-foreground">
                {flightsSummaryParts ? <DualPriceDisplay parts={flightsSummaryParts} /> : "—"}
              </p>
            </div>
            {hasHotelOptionsInData ? (
              <div className="min-w-0 rounded-lg border border-border bg-background/40 p-2 sm:p-2.5">
                <p className="text-[10px] text-muted">Hotels</p>
                <p className="text-sm font-medium text-foreground">
                  {hotelsSummaryParts ? <DualPriceDisplay parts={hotelsSummaryParts} /> : "—"}
                </p>
              </div>
            ) : null}
          </div>
        )}

        {legsWithContent.length > 0 && (
        <div className="mt-4 space-y-4">
          {legsWithContent.map((leg, legIdx) => {
            const legFlights = pickArray(leg, ["flights"]) ?? [];
            const legHotels = pickArray(leg, ["hotels"]) ?? [];

            const legLabel =
              pickString(leg, ["title", "name", "label"]) ??
              pickString(leg, ["from", "origin"]) ??
              (legsWithContent.length > 1 ? `Leg ${legIdx + 1}` : undefined);
            const legDates = [
              asIsoDate(pickString(leg, ["start_date", "startDate"])),
              asIsoDate(pickString(leg, ["end_date", "endDate"])),
            ]
              .filter(Boolean)
              .join(" → ");

            return (
              <div
                key={legIdx}
                className="min-w-0 max-w-full overflow-hidden rounded-lg border border-border/80 bg-background/30 p-2.5 sm:p-3"
              >
                {(legLabel || legDates) && (
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 sm:mb-3">
                    {legLabel && <p className="text-sm font-medium text-foreground">{legLabel}</p>}
                    {legDates && <p className="text-xs text-muted">{legDates}</p>}
                  </div>
                )}
                <div className="space-y-4">
                  <LegFlightsBlock
                    flights={legFlights}
                    legIndex={legIdx}
                    showExpandChevrons={showExpandChevrons}
                    onReorderFlightOptions={(flightIndex, newOptions) =>
                      reorderFlightOptions(legIdx, flightIndex, newOptions)
                    }
                  />
                  <LegHotelsBlock
                    hotels={legHotels}
                    legIndex={legIdx}
                    showExpandChevrons={showExpandChevrons}
                    onReorderHotelOptions={(hotelIndex, newOptions) =>
                      reorderHotelOptions(legIdx, hotelIndex, newOptions)
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
      </TripLocationMapsContext.Provider>
    </TripCurrencyContext.Provider>
  );
}
