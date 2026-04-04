import type { DualPriceParts } from "./tripDualPrice";
import {
  formatSummaryAmount,
  getNightsFromStay,
  parseFiniteAmount,
} from "./tripDualPrice";
import type { UnknownRecord } from "./tripShared";
import {
  isObject,
  pickArray,
  pickRecord,
  pickScalar,
} from "./tripShared";

/** Prefer explicit `legs`; otherwise one synthetic leg from top-level flights + hotels. */
export function getLegsFromRanked(ranked: UnknownRecord): UnknownRecord[] {
  const legs = pickArray(ranked, ["legs", "trip_legs", "itinerary_legs", "segments", "trip_segments"]);
  if (legs && legs.length > 0) {
    return legs.filter(isObject);
  }
  const flights = pickArray(ranked, ["flights"]) ?? [];
  const hotels = pickArray(ranked, ["hotels"]) ?? [];
  if (flights.length === 0 && hotels.length === 0) return [];
  return [{ flights, hotels } as UnknownRecord];
}

/** True if any hotel stay has at least one object in `options`. */
export function rankedTripHasHotelOptions(ranked: UnknownRecord): boolean {
  const legs = getLegsFromRanked(ranked);
  for (const leg of legs) {
    if (!isObject(leg)) continue;
    const hotels = pickArray(leg, ["hotels"]) ?? [];
    for (const h of hotels) {
      if (!isObject(h)) continue;
      const opts = pickArray(h, ["options"]) ?? [];
      if (opts.some(isObject)) return true;
    }
  }
  return false;
}

function getFlightOptionTripAmount(opt: UnknownRecord): number | undefined {
  const price = pickRecord(opt, ["price"]);
  if (!price) return undefined;
  const v = pickScalar(price, [
    "grandTotal_trip_currency",
    "total_trip_currency",
    "base_trip_currency",
    "grandTotal_itinerary_currency",
    "total_itinerary_currency",
    "base_itinerary_currency",
  ]);
  if (v) return parseFiniteAmount(v);
  return undefined;
}

/** First fare option if present; else price on the flight record (single-offer shape). */
function getFlightLegContribution(flight: UnknownRecord): number | undefined {
  const options = pickArray(flight, ["options"]) ?? [];
  const objs = options.filter(isObject) as UnknownRecord[];
  const first = objs.length > 0 ? objs[0] : undefined;
  if (first) {
    const fromOpt = getFlightOptionTripAmount(first);
    if (fromOpt != null) return fromOpt;
  }
  const price = pickRecord(flight, ["price"]);
  if (price) {
    const v = pickScalar(price, [
      "grandTotal_trip_currency",
      "total_trip_currency",
      "base_trip_currency",
      "grandTotal_itinerary_currency",
      "total_itinerary_currency",
      "base_itinerary_currency",
    ]);
    if (v) return parseFiniteAmount(v);
  }
  return undefined;
}

function getHotelOptionTripTotal(opt: UnknownRecord, parentStay: UnknownRecord): number | undefined {
  const r = isObject(opt._ranking) ? (opt._ranking as UnknownRecord) : undefined;
  if (r) {
    const total = pickScalar(r, [
      "total_trip_currency",
      "total_stay_trip_currency",
      "grand_total_trip_currency",
      "total_itinerary_currency",
      "total_stay_itinerary_currency",
      "grand_total_itinerary_currency",
    ]);
    if (total) return parseFiniteAmount(total);
    const pn = pickScalar(r, ["price_per_night_trip_currency", "price_per_night_itinerary_currency"]);
    const nights = getNightsFromStay(parentStay);
    const pnAmt = pn ? parseFiniteAmount(pn) : undefined;
    if (pnAmt != null && nights != null) return pnAmt * nights;
  }
  const offers = pickArray(opt, ["offers"]) ?? [];
  const first = offers.find(isObject) as UnknownRecord | undefined;
  const price = first ? pickRecord(first, ["price"]) : undefined;
  if (price) {
    const v = pickScalar(price, [
      "total_trip_currency",
      "grandTotal_trip_currency",
      "total_itinerary_currency",
      "grandTotal_itinerary_currency",
    ]);
    if (v) return parseFiniteAmount(v);
  }
  return undefined;
}

function getHotelLegContribution(stay: UnknownRecord): number | undefined {
  const options = pickArray(stay, ["options"]) ?? [];
  const objs = options.filter(isObject) as UnknownRecord[];
  const first = objs.length > 0 ? objs[0] : undefined;
  if (first) return getHotelOptionTripTotal(first, stay);
  return undefined;
}

/** Same sums as written by {@link recomputeSummaryTotalsFromRanked} (first-ranked flight/hotel option per leg item). */
export function computeFlightHotelTripTotalsFromRanked(ranked: UnknownRecord): {
  flightsTripSum: number;
  flightsContributions: number;
  hotelsTripSum: number;
  hotelsContributions: number;
} {
  const legs = getLegsFromRanked(ranked);
  let flightsSum = 0;
  let flightsContributions = 0;
  let hotelsSum = 0;
  let hotelsContributions = 0;

  for (const leg of legs) {
    if (!isObject(leg)) continue;
    const flights = pickArray(leg, ["flights"]) ?? [];
    for (const f of flights) {
      if (!isObject(f)) continue;
      const amt = getFlightLegContribution(f);
      if (amt != null) {
        flightsSum += amt;
        flightsContributions++;
      }
    }
    const hotels = pickArray(leg, ["hotels"]) ?? [];
    for (const h of hotels) {
      if (!isObject(h)) continue;
      const amt = getHotelLegContribution(h);
      if (amt != null) {
        hotelsSum += amt;
        hotelsContributions++;
      }
    }
  }

  return {
    flightsTripSum: flightsSum,
    flightsContributions,
    hotelsTripSum: hotelsSum,
    hotelsContributions,
  };
}

export function recomputeSummaryTotalsFromRanked(ranked: UnknownRecord): void {
  const summary = pickRecord(ranked, ["summary"]);
  if (!summary) return;

  const { flightsTripSum, flightsContributions, hotelsTripSum, hotelsContributions } =
    computeFlightHotelTripTotalsFromRanked(ranked);

  if (flightsContributions > 0) {
    const f = formatSummaryAmount(flightsTripSum);
    summary.total_flights_cost_itinerary_currency = f;
    summary.total_flights_cost_trip_currency = f;
  }
  if (hotelsContributions > 0) {
    const h = formatSummaryAmount(hotelsTripSum);
    summary.total_hotels_cost_itinerary_currency = h;
    summary.total_hotels_cost_trip_currency = h;
  }
}

export function computedFlightHotelSummaryParts(
  sum: number,
  contributions: number,
  tripCurrency?: string
): DualPriceParts | undefined {
  if (contributions <= 0) return undefined;
  const amt = formatSummaryAmount(sum);
  if (tripCurrency) {
    return { primary: `${amt} ${tripCurrency}` };
  }
  return { primary: amt };
}

/** `_ranking.score` on each flight/hotel option; higher is better. Missing score sorts last. */
function pickOptionRankingScore(opt: UnknownRecord): number | undefined {
  const r = isObject(opt._ranking) ? (opt._ranking as UnknownRecord) : undefined;
  if (!r) return undefined;
  const s = r.score;
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s === "string" && s.trim()) {
    const n = parseFloat(s.trim());
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function compareOptionsByRankingScoreDescending(a: UnknownRecord, b: UnknownRecord): number {
  const sa = pickOptionRankingScore(a);
  const sb = pickOptionRankingScore(b);
  if (sa != null && sb != null) return sb - sa;
  if (sa != null) return -1;
  if (sb != null) return 1;
  return 0;
}

function sortOptionsArrayByRankingScore(objs: UnknownRecord[]): unknown[] {
  return [...objs].sort(compareOptionsByRankingScoreDescending);
}

function sortOptionsOnEntity(entity: UnknownRecord): void {
  const options = pickArray(entity, ["options"]) ?? [];
  const objs = options.filter(isObject) as UnknownRecord[];
  if (objs.length < 2) return;
  entity.options = sortOptionsArrayByRankingScore(objs);
}

/** Sorts `options` on every flight and hotel under each leg (or top-level flights/hotels). */
export function sortFlightAndHotelOptionsByRankingInRanked(ranked: UnknownRecord): void {
  const legs = pickArray(ranked, ["legs", "trip_legs", "itinerary_legs", "segments", "trip_segments"]);
  if (legs && legs.length > 0) {
    for (const leg of legs) {
      if (!isObject(leg)) continue;
      const flights = pickArray(leg, ["flights"]) ?? [];
      for (const f of flights) {
        if (isObject(f)) sortOptionsOnEntity(f);
      }
      const hotels = pickArray(leg, ["hotels"]) ?? [];
      for (const h of hotels) {
        if (isObject(h)) sortOptionsOnEntity(h);
      }
    }
    return;
  }
  const flights = pickArray(ranked, ["flights"]) ?? [];
  for (const f of flights) {
    if (isObject(f)) sortOptionsOnEntity(f);
  }
  const hotels = pickArray(ranked, ["hotels"]) ?? [];
  for (const h of hotels) {
    if (isObject(h)) sortOptionsOnEntity(h);
  }
}

export function applyFlightOptionsReorder(
  ranked: UnknownRecord,
  legIndex: number,
  flightIndex: number,
  newOptions: unknown[]
): void {
  const legs = pickArray(ranked, ["legs", "trip_legs", "itinerary_legs", "segments", "trip_segments"]);
  if (legs && legs.length > 0) {
    const leg = legs[legIndex];
    if (isObject(leg)) {
      const flights = pickArray(leg, ["flights"]) ?? [];
      const target = flights[flightIndex];
      if (isObject(target)) {
        (target as UnknownRecord).options = newOptions;
      }
    }
    return;
  }
  const flights = pickArray(ranked, ["flights"]) ?? [];
  const target = flights[flightIndex];
  if (isObject(target)) {
    (target as UnknownRecord).options = newOptions;
  }
}

export function applyHotelOptionsReorder(
  ranked: UnknownRecord,
  legIndex: number,
  hotelIndex: number,
  newOptions: unknown[]
): void {
  const legs = pickArray(ranked, ["legs", "trip_legs", "itinerary_legs", "segments", "trip_segments"]);
  if (legs && legs.length > 0) {
    const leg = legs[legIndex];
    if (isObject(leg)) {
      const hotels = pickArray(leg, ["hotels"]) ?? [];
      const target = hotels[hotelIndex];
      if (isObject(target)) {
        (target as UnknownRecord).options = newOptions;
      }
    }
    return;
  }
  const hotels = pickArray(ranked, ["hotels"]) ?? [];
  const target = hotels[hotelIndex];
  if (isObject(target)) {
    (target as UnknownRecord).options = newOptions;
  }
}
