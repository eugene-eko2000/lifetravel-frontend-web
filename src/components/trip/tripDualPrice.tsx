"use client";

import type { UnknownRecord } from "./tripShared";
import {
  asIsoDate,
  isObject,
  pickArray,
  pickNumber,
  pickRecord,
  pickScalar,
  pickString,
} from "./tripShared";

/** Primary = trip display currency; optional original = billing currency from `price.currency`. */
export type DualPriceParts = { primary: string; original?: string };

export function DualPriceDisplay({ parts }: { parts: DualPriceParts | undefined }) {
  if (!parts) return null;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span>{parts.primary}</span>
      {parts.original ? (
        <span className="text-[0.82em] text-muted"> ({parts.original})</span>
      ) : null}
    </span>
  );
}

/**
 * Amadeus flight/offer price: converted trip-currency amount first (`704.13 CHF`), then original (`767.01 EUR`) when it differs.
 */
export function formatAmadeusDualPriceParts(price: UnknownRecord, tripCurrency?: string): DualPriceParts | undefined {
  const origCur = pickString(price, ["currency"]);
  const origAmt = pickScalar(price, ["grandTotal", "total"]);
  const originalLine = origCur && origAmt ? `${origAmt} ${origCur}` : undefined;

  if (tripCurrency) {
    const tripAmt = pickScalar(price, [
      "grandTotal_trip_currency",
      "total_trip_currency",
      "base_trip_currency",
      "grandTotal_itinerary_currency",
      "total_itinerary_currency",
      "base_itinerary_currency",
    ]);
    if (tripAmt) {
      const primary = `${tripAmt} ${tripCurrency}`;
      if (originalLine && origCur && origCur !== tripCurrency) {
        return { primary, original: originalLine };
      }
      return { primary };
    }
  }
  if (originalLine) return { primary: originalLine };
  return undefined;
}

export function parseFiniteAmount(s: string): number | undefined {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

export function formatSummaryAmount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(2);
}

export function getNightsFromStay(stay: UnknownRecord): number | undefined {
  const cin = asIsoDate(stay.check_in) ?? asIsoDate(pickString(stay, ["check_in", "checkIn"]));
  const cout = asIsoDate(stay.check_out) ?? asIsoDate(pickString(stay, ["check_out", "checkOut"]));
  if (!cin || !cout) return undefined;
  const d0 = new Date(`${cin}T12:00:00`);
  const d1 = new Date(`${cout}T12:00:00`);
  const ms = d1.getTime() - d0.getTime();
  const days = Math.round(ms / (24 * 3600 * 1000));
  return days > 0 ? days : undefined;
}

/** Nights for hotel price display: parent leg stay → option → `_stay` → first offer check-in/out. */
export function getNightCountForHotelPrice(opt: UnknownRecord, parentStay?: UnknownRecord): number | undefined {
  if (parentStay) {
    const n = getNightsFromStay(parentStay);
    if (n != null) return n;
  }
  const nOpt = getNightsFromStay(opt);
  if (nOpt != null) return nOpt;
  const nested = pickRecord(opt, ["_stay"]);
  if (nested) {
    const n = getNightsFromStay(nested);
    if (n != null) return n;
  }
  const offers = pickArray(opt, ["offers"]) ?? [];
  const first = offers.find(isObject) as UnknownRecord | undefined;
  if (first) {
    const cin = asIsoDate(pickString(first, ["checkInDate", "check_in"]));
    const cout = asIsoDate(pickString(first, ["checkOutDate", "check_out"]));
    if (cin && cout) {
      const d0 = new Date(`${cin}T12:00:00`);
      const d1 = new Date(`${cout}T12:00:00`);
      const days = Math.round((d1.getTime() - d0.getTime()) / (24 * 3600 * 1000));
      return days > 0 ? days : undefined;
    }
  }
  return undefined;
}

export function formatHotelDualPriceParts(
  opt: UnknownRecord,
  tripCurrency?: string,
  parentStay?: UnknownRecord
): DualPriceParts | undefined {
  const nights = getNightCountForHotelPrice(opt, parentStay);
  const nightsLabel =
    nights != null ? ` / ${nights} ${nights === 1 ? "night" : "nights"}` : "";

  const r = isObject(opt._ranking) ? (opt._ranking as UnknownRecord) : undefined;
  const offers = pickArray(opt, ["offers"]) ?? [];
  const first = offers.find(isObject) as UnknownRecord | undefined;
  const price = first ? pickRecord(first, ["price"]) : undefined;
  const variations = price ? pickRecord(price, ["variations"]) : undefined;
  const average = variations ? pickRecord(variations, ["average"]) : undefined;
  const origCur = price ? pickString(price, ["currency"]) : undefined;

  const origTotalFromPrice = price ? pickScalar(price, ["grandTotal", "total"]) : undefined;

  if (tripCurrency) {
    if (price) {
      const totalTripAmount = pickScalar(price, [
        "total_trip_currency",
        "grandTotal_trip_currency",
        "total_itinerary_currency",
        "grandTotal_itinerary_currency",
      ]);
      if (totalTripAmount) {
        const primary = `${totalTripAmount} ${tripCurrency}${nightsLabel}`;
        if (origTotalFromPrice && origCur && origCur !== tripCurrency) {
          return { primary, original: `${origTotalFromPrice} ${origCur}${nightsLabel}` };
        }
        return { primary };
      }
    }
    if (r) {
      const fromRankingTotal = pickScalar(r, [
        "total_trip_currency",
        "total_stay_trip_currency",
        "grand_total_trip_currency",
        "total_itinerary_currency",
        "total_stay_itinerary_currency",
        "grand_total_itinerary_currency",
      ]);
      if (fromRankingTotal) {
        const primary = `${fromRankingTotal} ${tripCurrency}${nightsLabel}`;
        const origT = pickScalar(r, ["total", "grand_total"]);
        if (origT && origCur && origCur !== tripCurrency) {
          return { primary, original: `${origT} ${origCur}${nightsLabel}` };
        }
        if (origTotalFromPrice && origCur && origCur !== tripCurrency) {
          return { primary, original: `${origTotalFromPrice} ${origCur}${nightsLabel}` };
        }
        return { primary };
      }
    }
    const fromRankingPn = r
      ? pickScalar(r, ["price_per_night_trip_currency", "price_per_night_itinerary_currency"])
      : undefined;
    if (fromRankingPn && nights != null) {
      const pnAmt = parseFiniteAmount(fromRankingPn);
      if (pnAmt != null) {
        const total = pnAmt * nights;
        const primary = `${formatSummaryAmount(total)} ${tripCurrency}${nightsLabel}`;
        const origPn = r ? pickNumber(r, ["price_per_night"]) : undefined;
        if (origPn != null && origCur && origCur !== tripCurrency) {
          return {
            primary,
            original: `${formatSummaryAmount(origPn * nights)} ${origCur}${nightsLabel}`,
          };
        }
        return { primary };
      }
    }
    if (average && nights != null) {
      const tripPerNight = pickScalar(average, [
        "total_trip_currency",
        "base_trip_currency",
        "total_itinerary_currency",
        "base_itinerary_currency",
      ]);
      const origPerNight = pickScalar(average, ["total", "base"]);
      if (tripPerNight) {
        const pnAmt = parseFiniteAmount(tripPerNight);
        if (pnAmt != null) {
          const total = pnAmt * nights;
          const primary = `${formatSummaryAmount(total)} ${tripCurrency}${nightsLabel}`;
          if (origPerNight && origCur && origCur !== tripCurrency) {
            const opn = parseFiniteAmount(origPerNight);
            if (opn != null) {
              return {
                primary,
                original: `${formatSummaryAmount(opn * nights)} ${origCur}${nightsLabel}`,
              };
            }
          }
          return { primary };
        }
      }
    }
  }

  if (price && origTotalFromPrice && origCur) {
    const primary = `${origTotalFromPrice} ${origCur}${nightsLabel}`;
    return { primary };
  }
  const num = r ? pickNumber(r, ["price_per_night"]) : undefined;
  if (num != null && nights != null) {
    const cur = origCur ?? tripCurrency;
    if (cur) {
      return { primary: `${formatSummaryAmount(num * nights)} ${cur}${nightsLabel}` };
    }
    return { primary: `${formatSummaryAmount(num * nights)}${nightsLabel}` };
  }
  if (num != null) return { primary: `${num}/night` };
  return undefined;
}
