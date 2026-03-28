"use client";

import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const ItineraryCurrencyContext = createContext<string | undefined>(undefined);

function useItineraryCurrency(): string | undefined {
  return useContext(ItineraryCurrencyContext);
}

type UnknownRecord = Record<string, unknown>;
/** Inset for expanded flight/hotel option lists under a leg row. */
const LEG_OPTION_PANEL_CLASS = "border-t border-border bg-background/25 pl-3 pr-3 py-2 space-y-2 rounded-b-lg";

/** Stable id per option object so SortableContext `items` order changes when data reorders (index-only ids break dnd-kit). */
const flightOptionSortableSuffix = new WeakMap<UnknownRecord, string>();
const hotelOptionSortableSuffix = new WeakMap<UnknownRecord, string>();

function randomSortableSuffix(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `opt-${Math.random().toString(36).slice(2)}`;
}

function getFlightOptionSortableId(opt: UnknownRecord, legIndex: number, flightIndex: number): string {
  let suffix = flightOptionSortableSuffix.get(opt);
  if (!suffix) {
    const explicit = pickString(opt, ["id", "offer_id", "offerId", "option_id"]);
    // Two options can share the same API id; append a random token so keys stay unique.
    suffix = explicit ? `${explicit}::${randomSortableSuffix()}` : randomSortableSuffix();
    flightOptionSortableSuffix.set(opt, suffix);
  }
  return `flight-${legIndex}-${flightIndex}-${suffix}`;
}

function getHotelOptionSortableId(opt: UnknownRecord, legIndex: number, hotelIndex: number): string {
  let suffix = hotelOptionSortableSuffix.get(opt);
  if (!suffix) {
    const h = isObject(opt.hotel) ? (opt.hotel as UnknownRecord) : undefined;
    const explicit =
      pickString(opt, ["id", "option_id"]) ?? (h ? pickString(h, ["hotel_id"]) : undefined);
    suffix = explicit ? `${explicit}::${randomSortableSuffix()}` : randomSortableSuffix();
    hotelOptionSortableSuffix.set(opt, suffix);
  }
  return `hotel-${legIndex}-${hotelIndex}-${suffix}`;
}

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(obj: UnknownRecord, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

function pickArray(obj: UnknownRecord, keys: string[]): unknown[] | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) return v;
  }
  return undefined;
}

export function looksLikeItinerary(data: unknown): boolean {
  if (!isObject(data)) return false;

  // common shapes: { itinerary: {...} } or { ranked_itinerary: {...} } or { ranked: {...} }
  if ("itinerary" in data && isObject(data.itinerary)) return true;
  if ("ranked_itinerary" in data && isObject((data as UnknownRecord).ranked_itinerary)) return true;
  if ("ranked" in data && isObject((data as UnknownRecord).ranked)) return true;
  if (Array.isArray((data as UnknownRecord).days)) return true;
  if (Array.isArray((data as UnknownRecord).day_plans)) return true;
  if (Array.isArray((data as UnknownRecord).dayPlans)) return true;

  // sometimes nested under "data"
  if ("data" in data && isObject(data.data)) {
    const inner = data.data;
    if ("itinerary" in inner && isObject(inner.itinerary)) return true;
    if ("ranked_itinerary" in inner && isObject((inner as UnknownRecord).ranked_itinerary)) return true;
    if ("ranked" in inner && isObject((inner as UnknownRecord).ranked)) return true;
    if (Array.isArray((inner as UnknownRecord).days)) return true;
    if (Array.isArray((inner as UnknownRecord).day_plans)) return true;
    if (Array.isArray((inner as UnknownRecord).dayPlans)) return true;
  }

  return false;
}

function pickNumber(obj: UnknownRecord, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** String or number amounts (Amadeus often uses string decimals). */
function pickScalar(obj: UnknownRecord, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Primary = itinerary; optional original = billing currency from `price.currency`. */
type DualPriceParts = { primary: string; original?: string };

function DualPriceDisplay({ parts }: { parts: DualPriceParts | undefined }) {
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
 * Amadeus flight/offer price: itinerary amount first (`704.13 CHF`), then original (`767.01 EUR`) when it differs.
 */
function formatAmadeusDualPriceParts(price: UnknownRecord, itineraryCurrency?: string): DualPriceParts | undefined {
  const origCur = pickString(price, ["currency"]);
  const origAmt = pickScalar(price, ["grandTotal", "total"]);
  const originalLine = origCur && origAmt ? `${origAmt} ${origCur}` : undefined;

  if (itineraryCurrency) {
    const itinAmt = pickScalar(price, [
      "grandTotal_itinerary_currency",
      "total_itinerary_currency",
      "base_itinerary_currency",
    ]);
    if (itinAmt) {
      const primary = `${itinAmt} ${itineraryCurrency}`;
      if (originalLine && origCur && origCur !== itineraryCurrency) {
        return { primary, original: originalLine };
      }
      return { primary };
    }
  }
  if (originalLine) return { primary: originalLine };
  return undefined;
}

function formatHotelDualPriceParts(
  opt: UnknownRecord,
  itineraryCurrency?: string,
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

  if (itineraryCurrency) {
    if (price) {
      const totalItin = pickScalar(price, ["total_itinerary_currency", "grandTotal_itinerary_currency"]);
      if (totalItin) {
        const primary = `${totalItin} ${itineraryCurrency}${nightsLabel}`;
        if (origTotalFromPrice && origCur && origCur !== itineraryCurrency) {
          return { primary, original: `${origTotalFromPrice} ${origCur}${nightsLabel}` };
        }
        return { primary };
      }
    }
    if (r) {
      const fromRankingTotal = pickScalar(r, [
        "total_itinerary_currency",
        "total_stay_itinerary_currency",
        "grand_total_itinerary_currency",
      ]);
      if (fromRankingTotal) {
        const primary = `${fromRankingTotal} ${itineraryCurrency}${nightsLabel}`;
        const origT = pickScalar(r, ["total", "grand_total"]);
        if (origT && origCur && origCur !== itineraryCurrency) {
          return { primary, original: `${origT} ${origCur}${nightsLabel}` };
        }
        if (origTotalFromPrice && origCur && origCur !== itineraryCurrency) {
          return { primary, original: `${origTotalFromPrice} ${origCur}${nightsLabel}` };
        }
        return { primary };
      }
    }
    const fromRankingPn = r ? pickScalar(r, ["price_per_night_itinerary_currency"]) : undefined;
    if (fromRankingPn && nights != null) {
      const pnAmt = parseFiniteAmount(fromRankingPn);
      if (pnAmt != null) {
        const total = pnAmt * nights;
        const primary = `${formatSummaryAmount(total)} ${itineraryCurrency}${nightsLabel}`;
        const origPn = r ? pickNumber(r, ["price_per_night"]) : undefined;
        if (origPn != null && origCur && origCur !== itineraryCurrency) {
          return {
            primary,
            original: `${formatSummaryAmount(origPn * nights)} ${origCur}${nightsLabel}`,
          };
        }
        return { primary };
      }
    }
    if (average && nights != null) {
      const itinPerNight = pickScalar(average, ["total_itinerary_currency", "base_itinerary_currency"]);
      const origPerNight = pickScalar(average, ["total", "base"]);
      if (itinPerNight) {
        const pnAmt = parseFiniteAmount(itinPerNight);
        if (pnAmt != null) {
          const total = pnAmt * nights;
          const primary = `${formatSummaryAmount(total)} ${itineraryCurrency}${nightsLabel}`;
          if (origPerNight && origCur && origCur !== itineraryCurrency) {
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
    const cur = origCur ?? itineraryCurrency;
    if (cur) {
      return { primary: `${formatSummaryAmount(num * nights)} ${cur}${nightsLabel}` };
    }
    return { primary: `${formatSummaryAmount(num * nights)}${nightsLabel}` };
  }
  if (num != null) return { primary: `${num}/night` };
  return undefined;
}

function parseFiniteAmount(s: string): number | undefined {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

function formatSummaryAmount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(2);
}

function getNightsFromStay(stay: UnknownRecord): number | undefined {
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
function getNightCountForHotelPrice(opt: UnknownRecord, parentStay?: UnknownRecord): number | undefined {
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

function getFlightOptionItineraryAmount(opt: UnknownRecord): number | undefined {
  const price = pickRecord(opt, ["price"]);
  if (!price) return undefined;
  const v = pickScalar(price, [
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
    const fromOpt = getFlightOptionItineraryAmount(first);
    if (fromOpt != null) return fromOpt;
  }
  const price = pickRecord(flight, ["price"]);
  if (price) {
    const v = pickScalar(price, [
      "grandTotal_itinerary_currency",
      "total_itinerary_currency",
      "base_itinerary_currency",
    ]);
    if (v) return parseFiniteAmount(v);
  }
  return undefined;
}

function getHotelOptionItineraryTotal(opt: UnknownRecord, parentStay: UnknownRecord): number | undefined {
  const r = isObject(opt._ranking) ? (opt._ranking as UnknownRecord) : undefined;
  if (r) {
    const total = pickScalar(r, [
      "total_itinerary_currency",
      "total_stay_itinerary_currency",
      "grand_total_itinerary_currency",
    ]);
    if (total) return parseFiniteAmount(total);
    const pn = pickScalar(r, ["price_per_night_itinerary_currency"]);
    const nights = getNightsFromStay(parentStay);
    const pnAmt = pn ? parseFiniteAmount(pn) : undefined;
    if (pnAmt != null && nights != null) return pnAmt * nights;
  }
  const offers = pickArray(opt, ["offers"]) ?? [];
  const first = offers.find(isObject) as UnknownRecord | undefined;
  const price = first ? pickRecord(first, ["price"]) : undefined;
  if (price) {
    const v = pickScalar(price, [
      "total_itinerary_currency",
      "grandTotal_itinerary_currency",
      "total_itinerary_currency",
    ]);
    if (v) return parseFiniteAmount(v);
  }
  return undefined;
}

function getHotelLegContribution(stay: UnknownRecord): number | undefined {
  const options = pickArray(stay, ["options"]) ?? [];
  const objs = options.filter(isObject) as UnknownRecord[];
  const first = objs.length > 0 ? objs[0] : undefined;
  if (first) return getHotelOptionItineraryTotal(first, stay);
  return undefined;
}

/** Same sums as written by {@link recomputeSummaryTotalsFromRanked} (first-ranked flight/hotel option per leg item). */
function computeFlightHotelItineraryTotalsFromRanked(ranked: UnknownRecord): {
  flightsItinSum: number;
  flightsContributions: number;
  hotelsItinSum: number;
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
    flightsItinSum: flightsSum,
    flightsContributions,
    hotelsItinSum: hotelsSum,
    hotelsContributions,
  };
}

function recomputeSummaryTotalsFromRanked(ranked: UnknownRecord): void {
  const summary = pickRecord(ranked, ["summary"]);
  if (!summary) return;

  const { flightsItinSum, flightsContributions, hotelsItinSum, hotelsContributions } =
    computeFlightHotelItineraryTotalsFromRanked(ranked);

  if (flightsContributions > 0) {
    summary.total_flights_cost_itinerary_currency = formatSummaryAmount(flightsItinSum);
  }
  if (hotelsContributions > 0) {
    summary.total_hotels_cost_itinerary_currency = formatSummaryAmount(hotelsItinSum);
  }
}

function computedFlightHotelSummaryParts(
  sum: number,
  contributions: number,
  itineraryCurrency?: string
): DualPriceParts | undefined {
  if (contributions <= 0) return undefined;
  const amt = formatSummaryAmount(sum);
  if (itineraryCurrency) {
    return { primary: `${amt} ${itineraryCurrency}` };
  }
  return { primary: amt };
}

function applyFlightOptionsReorder(
  ranked: UnknownRecord,
  legIndex: number,
  flightIndex: number,
  newOptions: unknown[]
): void {
  const legs = pickArray(ranked, ["legs", "itinerary_legs", "segments", "trip_segments"]);
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

function applyHotelOptionsReorder(
  ranked: UnknownRecord,
  legIndex: number,
  hotelIndex: number,
  newOptions: unknown[]
): void {
  const legs = pickArray(ranked, ["legs", "itinerary_legs", "segments", "trip_segments"]);
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

/** Rounds total minutes and formats as hours + minutes (e.g. 1030 → "17h 10m", 45 → "45m"). */
function formatDurationMinutesAsHoursMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return "";
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function pickRecord(obj: UnknownRecord, keys: string[]): UnknownRecord | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (isObject(v)) return v;
  }
  return undefined;
}

function asIsoDate(value: unknown): string | undefined {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : undefined;
}

/** Formats YYYY-MM-DD for itinerary summary (matches flight date-only display style). */
function formatIsoDateLabel(isoDate: string): string {
  const parts = isoDate.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const day = parts[2];
  if (y == null || m == null || day == null) return isoDate;
  const local = new Date(y, m - 1, day);
  return local.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Start/end from summary when present; otherwise falls back to total duration days. */
function formatItinerarySummaryDates(
  startIso: string | undefined,
  endIso: string | undefined,
  totalDurationDays: number | undefined
): string {
  if (startIso && endIso) {
    return `${formatIsoDateLabel(startIso)} → ${formatIsoDateLabel(endIso)}`;
  }
  if (startIso) return `${formatIsoDateLabel(startIso)} → —`;
  if (endIso) return `— → ${formatIsoDateLabel(endIso)}`;
  if (totalDurationDays != null) return `${totalDurationDays} days`;
  return "—";
}

function looksLikeDatetimeString(s: string): boolean {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  return t.includes("T") || /\d{1,2}:\d{2}/.test(t) || t.length > 10;
}

/** Formats ISO date or datetime for flight UI; shows time when the value includes it (or is a Unix ms timestamp). */
function formatFlightDateTime(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const s = value.trim();
  const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (isoDateOnly) {
    const parts = s.split("-").map(Number);
    const y = parts[0];
    const m = parts[1];
    const day = parts[2];
    if (y == null || m == null || day == null) return s;
    const local = new Date(y, m - 1, day);
    return local.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    return s.length > 48 ? `${s.slice(0, 45)}…` : s;
  }
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Same inputs as {@link formatFlightDateTime} but omits times (flight row headers). */
function formatFlightDateOnly(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    }
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return formatIsoDateLabel(s);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  return s.length > 48 ? `${s.slice(0, 45)}…` : s;
}

type FlightEndpointFormatter = (value: unknown) => string | undefined;

function collectStringFields(record: UnknownRecord, keys: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const v = record[k];
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return out;
}

function pickBestDateField(record: UnknownRecord, keys: string[]): string | undefined {
  const vals = collectStringFields(record, keys);
  return vals.find(looksLikeDatetimeString) ?? vals[0];
}

function normalizeTimeForCombine(t: string): string {
  const x = t.trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(x)) {
    return x.length === 5 ? `${x}:00` : x;
  }
  return x;
}

/** Reads nested Amadeus/GDS-style { departure: { at } } / { arrival: { at } }. */
function formatFlightEndpointFromNestedEndpoint(
  record: UnknownRecord,
  side: "departure" | "arrival",
  fmt: FlightEndpointFormatter = formatFlightDateTime
): string | undefined {
  const key = side === "departure" ? "departure" : "arrival";
  const v = record[key];
  if (!isObject(v)) return undefined;
  const nested = pickString(v, [
    "at",
    "dateTime",
    "datetime",
    "time",
    "localDateTime",
    "local_date_time",
    "iataDateTime",
  ]);
  if (nested) return fmt(nested);
  return undefined;
}

/** Amadeus flight-offer: all segments in order, then first segment departure / last segment arrival. */
function collectAmadeusSegmentsInOrder(record: UnknownRecord): UnknownRecord[] {
  const itineraries = pickArray(record, ["itineraries"]) ?? [];
  const out: UnknownRecord[] = [];
  for (const it of itineraries) {
    if (!isObject(it)) continue;
    const segs = pickArray(it, ["segments"]) ?? [];
    for (const s of segs) {
      if (isObject(s)) out.push(s as UnknownRecord);
    }
  }
  return out;
}

function formatFlightEndpointFromAmadeusItineraries(
  record: UnknownRecord,
  side: "departure" | "arrival",
  fmt: FlightEndpointFormatter = formatFlightDateTime
): string | undefined {
  const segments = collectAmadeusSegmentsInOrder(record);
  if (segments.length === 0) return undefined;
  const seg = side === "departure" ? segments[0] : segments[segments.length - 1];
  return formatFlightEndpointFromNestedEndpoint(seg, side, fmt);
}

/** Departure or arrival line for a flight or segment option (prefers full datetimes, else date+time fields). */
function formatFlightEndpointDisplay(
  record: UnknownRecord,
  side: "departure" | "arrival",
  omitTime?: boolean
): string | undefined {
  const fmt = omitTime ? formatFlightDateOnly : formatFlightDateTime;
  const nested = formatFlightEndpointFromNestedEndpoint(record, side, fmt);
  if (nested) return nested;

  const fromAmadeus = formatFlightEndpointFromAmadeusItineraries(record, side, fmt);
  if (fromAmadeus) return fromAmadeus;

  const options = pickArray(record, ["options"]);
  if (options?.length) {
    const candidates = options.filter(isObject) as UnknownRecord[];
    const first = candidates.length > 0 ? candidates[0] : undefined;
    if (first) {
      const fromOption = formatFlightEndpointFromAmadeusItineraries(first, side, fmt);
      if (fromOption) return fromOption;
    }
  }

  const atKeys =
    side === "departure"
      ? [
          "depart_at",
          "departure_at",
          "departure_datetime",
          "depart_datetime",
          "departureDateTime",
          "departure_datetime_utc",
          "departure_date_time",
        ]
      : [
          "arrive_at",
          "arrival_at",
          "arrival_datetime",
          "arrive_datetime",
          "arrivalDateTime",
          "arrival_datetime_utc",
          "arrival_date_time",
        ];
  const dateKeys =
    side === "departure"
      ? ["depart_date", "departure_date", "departureDate"]
      : ["arrive_date", "arrival_date", "arrivalDate"];
  const timeKeys =
    side === "departure"
      ? ["depart_time", "departure_time", "departureTime"]
      : ["arrive_time", "arrival_time", "arrivalTime"];

  const flatAt = collectStringFields(record, atKeys);
  const bestAt = flatAt.find(looksLikeDatetimeString) ?? flatAt[0];
  if (bestAt) return fmt(bestAt);

  const datePart = pickBestDateField(record, dateKeys);
  const timeCandidates = collectStringFields(record, timeKeys);
  const timePart = timeCandidates[0];

  if (datePart && timePart) {
    const datePartIso = datePart.split("T")[0] ?? datePart;
    const combined = `${datePartIso}T${normalizeTimeForCombine(timePart)}`;
    return fmt(combined);
  }
  if (datePart) return fmt(datePart);

  const ts =
    side === "departure"
      ? pickNumber(record, ["departure_timestamp", "depart_timestamp", "departure_unix"])
      : pickNumber(record, ["arrival_timestamp", "arrive_timestamp", "arrival_unix"]);
  if (ts != null) return fmt(ts);

  const segmentsOnly = pickArray(record, ["segments"]);
  if (segmentsOnly?.length) {
    const wrapped = { itineraries: [{ segments: segmentsOnly }] } as UnknownRecord;
    const fromSegList = formatFlightEndpointFromAmadeusItineraries(wrapped, side, fmt);
    if (fromSegList) return fromSegList;
  }

  return undefined;
}

/** Segments from Amadeus itineraries or a top-level `segments` array. */
function collectSegmentsFromRecord(record: UnknownRecord): UnknownRecord[] {
  const fromItin = collectAmadeusSegmentsInOrder(record);
  if (fromItin.length > 0) return fromItin;
  const direct = pickArray(record, ["segments"]) ?? [];
  return direct.filter(isObject) as UnknownRecord[];
}

/** Prefer first option when it carries segment data; else the flight record. */
function gatherSegmentsForFlight(flight: UnknownRecord): UnknownRecord[] {
  const options = pickArray(flight, ["options"]) ?? [];
  const objs = options.filter(isObject) as UnknownRecord[];
  const first = objs.length > 0 ? objs[0] : undefined;
  const candidates: UnknownRecord[] = [];
  if (first) candidates.push(first);
  candidates.push(flight);
  for (const c of candidates) {
    const segs = collectSegmentsFromRecord(c);
    if (segs.length > 0) return segs;
  }
  return [];
}

function getSegmentEndpoint(seg: UnknownRecord, side: "departure" | "arrival"): UnknownRecord | undefined {
  const v = seg[side];
  return isObject(v) ? v : undefined;
}

function formatAirportLine(seg: UnknownRecord, side: "departure" | "arrival"): string {
  const ep = getSegmentEndpoint(seg, side);
  if (!ep) return "—";
  const iata = pickString(ep, ["iataCode", "iata"]);
  const city = pickString(ep, ["cityName", "city"]);
  const terminal = pickString(ep, ["terminal"]);
  const parts = [iata, city].filter(Boolean);
  if (terminal) parts.push(`Terminal ${terminal}`);
  return parts.join(" · ") || "—";
}

function formatSegmentCarrier(seg: UnknownRecord): string {
  const carrier = pickString(seg, ["carrierCode", "carrier"]);
  const n = seg.number ?? seg.flight_number;
  const num =
    typeof n === "number" && Number.isFinite(n)
      ? String(n)
      : typeof n === "string" && n.trim()
        ? n.trim()
        : pickString(seg, ["number", "flight_number"]);
  if (carrier && num) return `${carrier} ${num}`;
  const airline = pickString(seg, ["airline", "operatingCarrier"]);
  if (airline) return num ? `${airline} ${num}` : airline;
  return pickString(seg, ["flightNumber"]) ?? "Flight";
}

/** Amadeus segment id for matching `fareDetailsBySegment.segmentId`. */
function getSegmentIdForFareMatching(seg: UnknownRecord): string | undefined {
  return pickString(seg, ["id", "segmentId"]);
}

function toTitleCaseWords(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatCabinClassLabel(cabin: unknown): string | undefined {
  if (typeof cabin !== "string" || !cabin.trim()) return undefined;
  return toTitleCaseWords(cabin);
}

function pickNonNegativeInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return parseInt(value.trim(), 10);
  return undefined;
}

/**
 * Checked/cabin bags: when weight (+ unit) is present → `{n} x {weight}{unit}` (per-bag weight).
 * Quantity defaults to 1 if omitted. Without weight → `{n} bag(s)` from quantity only.
 */
function formatFareBagsLine(bags: unknown): string | undefined {
  if (bags == null) return undefined;
  if (!isObject(bags)) return undefined;
  const w = bags.weight ?? bags.maximumWeight ?? bags.maxWeight;
  const weightStr =
    typeof w === "number" && Number.isFinite(w)
      ? String(w)
      : typeof w === "string" && w.trim()
        ? w.trim()
        : pickScalar(bags, ["weight", "maximumWeight", "maxWeight"]);
  if (weightStr) {
    const unit = (pickString(bags, ["weightUnit", "unit"]) ?? "kg").toLowerCase();
    const qty = pickNonNegativeInt(bags.quantity) ?? 1;
    return `${qty} x ${weightStr}${unit}`;
  }
  const qty = pickNonNegativeInt(bags.quantity);
  if (qty != null) return `${qty} bag${qty === 1 ? "" : "s"}`;
  return undefined;
}

/** First traveler with non-empty fareDetailsBySegment (typical: ADULT). */
function getFirstTravelerFareDetailsBySegment(offerLike: UnknownRecord): UnknownRecord[] {
  const tps = pickArray(offerLike, ["travelerPricings"]) ?? [];
  for (const tp of tps) {
    if (!isObject(tp)) continue;
    const fds = pickArray(tp, ["fareDetailsBySegment"]) ?? [];
    const objs = fds.filter(isObject) as UnknownRecord[];
    if (objs.length > 0) return objs;
  }
  return [];
}

function buildFareDetailBySegmentId(fareDetails: UnknownRecord[]): Map<string, UnknownRecord> {
  const map = new Map<string, UnknownRecord>();
  for (const fd of fareDetails) {
    const sid = pickString(fd, ["segmentId", "segment_id"]);
    if (sid) map.set(sid, fd);
  }
  return map;
}

function resolveFareDetailForSegment(
  seg: UnknownRecord,
  segmentIndex: number,
  fareDetailsInOrder: UnknownRecord[],
  byId: Map<string, UnknownRecord>
): UnknownRecord | undefined {
  const segId = getSegmentIdForFareMatching(seg);
  if (segId) {
    const hit = byId.get(segId);
    if (hit) return hit;
  }
  if (segmentIndex >= 0 && segmentIndex < fareDetailsInOrder.length) {
    return fareDetailsInOrder[segmentIndex];
  }
  return undefined;
}

/** Amadeus-style fare detail: checked/cabin bags field names vary slightly across payloads. */
function pickFareBagsField(fd: UnknownRecord, kind: "checked" | "cabin"): unknown {
  if (kind === "checked") {
    return fd.includedCheckedBags ?? fd.checkedBags;
  }
  return fd.includedCabinBags ?? fd.cabinBags;
}

function parseAtFromSegment(seg: UnknownRecord, side: "departure" | "arrival"): Date | null {
  const ep = getSegmentEndpoint(seg, side);
  if (!ep) return null;
  const at = pickString(ep, ["at", "dateTime", "localDateTime", "datetime"]);
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatConnectionLayover(prev: UnknownRecord, next: UnknownRecord): string | null {
  const arr = parseAtFromSegment(prev, "arrival");
  const dep = parseAtFromSegment(next, "departure");
  if (!arr || !dep || dep.getTime() <= arr.getTime()) return null;
  const mins = Math.round((dep.getTime() - arr.getTime()) / 60000);
  return formatDurationMinutesAsHoursMinutes(mins);
}

/** Prefer explicit `legs`; otherwise one synthetic leg from top-level flights + hotels. */
function getLegsFromRanked(ranked: UnknownRecord): UnknownRecord[] {
  const legs = pickArray(ranked, ["legs", "itinerary_legs", "segments", "trip_segments"]);
  if (legs && legs.length > 0) {
    return legs.filter(isObject);
  }
  const flights = pickArray(ranked, ["flights"]) ?? [];
  const hotels = pickArray(ranked, ["hotels"]) ?? [];
  if (flights.length === 0 && hotels.length === 0) return [];
  return [{ flights, hotels } as UnknownRecord];
}

/** True if any hotel stay has at least one object in `options`. */
function rankedItineraryHasHotelOptions(ranked: UnknownRecord): boolean {
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

function FlightOptionMetaLine({ opt }: { opt: UnknownRecord }) {
  const itineraryCurrency = useItineraryCurrency();
  const price = isObject(opt.price) ? (opt.price as UnknownRecord) : undefined;
  const parts = price ? formatAmadeusDualPriceParts(price, itineraryCurrency) : undefined;
  const ranking = isObject(opt._ranking) ? (opt._ranking as UnknownRecord) : undefined;
  const durationMinutes = ranking ? pickNumber(ranking, ["duration_minutes"]) : undefined;
  const stops = ranking ? pickNumber(ranking, ["stops"]) : undefined;
  if (parts == null && durationMinutes == null && stops == null) return null;
  return (
    <p className="mt-1 text-xs text-muted flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      {parts ? <DualPriceDisplay parts={parts} /> : null}
      {durationMinutes != null ? (
        <>
          {parts ? <span className="text-muted">·</span> : null}
          <span>{formatDurationMinutesAsHoursMinutes(durationMinutes)}</span>
        </>
      ) : null}
      {stops != null ? (
        <>
          {(parts || durationMinutes != null) ? <span className="text-muted">·</span> : null}
          <span>{stops} stops</span>
        </>
      ) : null}
    </p>
  );
}

/** First line matches parent flight row: route (from → to) | dates; falls back to parent segment when option omits fields. */
function FlightOptionBox({
  opt,
  optionIndex,
  parentFlight,
  parentFlightIndex,
}: {
  opt: UnknownRecord;
  optionIndex: number;
  parentFlight: UnknownRecord;
  parentFlightIndex: number;
}) {
  const itineraryCurrency = useItineraryCurrency();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const from =
    pickString(opt, ["from", "origin", "departure_city"]) ?? pickString(parentFlight, ["from", "origin"]);
  const to =
    pickString(opt, ["to", "destination", "arrival_city"]) ?? pickString(parentFlight, ["to", "destination"]);
  const routeTitle = [from, to].filter(Boolean).join(" → ");
  const airline = pickString(opt, ["airline", "carrier", "validating_airline", "marketing_airline"]);
  const flightNo = pickString(opt, ["flight_number", "number", "flight"]);
  const title =
    routeTitle ||
    [airline, flightNo].filter(Boolean).join(" ") ||
    airline ||
    `Flight ${optionIndex + 1}`;

  const depart =
    formatFlightEndpointDisplay(opt, "departure") ?? formatFlightEndpointDisplay(parentFlight, "departure");
  const arrive =
    formatFlightEndpointDisplay(opt, "arrival") ?? formatFlightEndpointDisplay(parentFlight, "arrival");
  const dateRight = [depart, arrive].filter(Boolean).join(" → ");
  const detailId = `flight-${parentFlightIndex}-opt-${optionIndex}`;

  return (
    <div className="w-full min-w-0 rounded-lg border border-border/80 bg-background/40">
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        aria-controls={detailId}
        id={`${detailId}-summary`}
        className={`w-full flex items-start gap-2 p-3 text-left hover:bg-surface-hover/50 transition-colors ${
          detailsOpen ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className="shrink-0 text-xs text-muted mt-0.5 w-4 text-center" aria-hidden>
          {detailsOpen ? "▼" : "▶"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{title}</p>
            {dateRight ? <p className="text-xs text-muted shrink-0">{dateRight}</p> : null}
          </div>
          <FlightOptionMetaLine opt={opt} />
        </div>
      </button>
      {detailsOpen && (
        <div
          id={detailId}
          role="region"
          aria-labelledby={`${detailId}-summary`}
          className="border-t border-border bg-background/25 px-3 py-3"
        >
          <FlightSegmentDetailList flight={parentFlight} segmentsFrom={opt} />
        </div>
      )}
    </div>
  );
}

/** First Amadeus offer in a hotel-offers option, or the option itself when it already is an offer-shaped record. */
function getPrimaryHotelOffer(opt: UnknownRecord): UnknownRecord | undefined {
  const offers = pickArray(opt, ["offers"]) ?? [];
  const first = offers.find(isObject) as UnknownRecord | undefined;
  if (first) return first;
  if (
    pickString(opt, ["checkInDate", "checkOutDate"]) ||
    pickRecord(opt, ["room"]) ||
    pickRecord(opt, ["policies"])
  ) {
    return opt;
  }
  return undefined;
}

function formatCategoryOrCodeLabel(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return toTitleCaseWords(value.replace(/_/g, " "));
}

function getRoomDescriptionText(room: UnknownRecord | undefined, roomInfo: UnknownRecord | undefined): string | undefined {
  const dRoom = room ? pickRecord(room, ["description"]) : undefined;
  const tFromRoom = dRoom ? pickString(dRoom, ["text"]) : undefined;
  const tFromInfo = roomInfo ? pickString(roomInfo, ["description"]) : undefined;
  const a = tFromRoom?.trim() ?? "";
  const b = tFromInfo?.trim() ?? "";
  const best = a.length >= b.length ? a : b;
  return best.length > 0 ? best : undefined;
}

function HotelStayDetailsPanel({ offer }: { offer: UnknownRecord }) {
  const room = pickRecord(offer, ["room"]);
  const roomInfo = pickRecord(offer, ["roomInformation"]);
  const typeEst = room ? pickRecord(room, ["typeEstimated"]) : undefined;
  const typeEstRi = roomInfo ? pickRecord(roomInfo, ["typeEstimated"]) : undefined;
  const category = formatCategoryOrCodeLabel(typeEst?.category ?? typeEstRi?.category);
  const roomTypeCode = pickString(room ?? {}, ["type"]) ?? pickString(roomInfo ?? {}, ["type"]);
  const bedType = formatCategoryOrCodeLabel(typeEst?.bedType ?? typeEstRi?.bedType);
  const beds =
    typeof typeEst?.beds === "number" && Number.isFinite(typeEst.beds)
      ? typeEst.beds
      : typeof typeEstRi?.beds === "number" && Number.isFinite(typeEstRi.beds)
        ? typeEstRi.beds
        : undefined;

  const amenities = getRoomDescriptionText(room, roomInfo);

  const policies = pickRecord(offer, ["policies"]);
  const paymentType = policies ? pickString(policies, ["paymentType"]) : undefined;
  const refundable = policies ? pickRecord(policies, ["refundable"]) : undefined;
  const refundLabel = refundable ? pickString(refundable, ["cancellationRefund"]) : undefined;
  const cancellations = policies ? (pickArray(policies, ["cancellations"]) ?? []).filter(isObject) : [];
  const prepay = policies ? pickRecord(policies, ["prepay"]) : undefined;
  const prepayDeadline = prepay ? pickString(prepay, ["deadline"]) : undefined;
  const accepted = prepay ? pickRecord(prepay, ["acceptedPayments"]) : undefined;
  const ccList = accepted ? (pickArray(accepted, ["creditCards"]) ?? []).filter((x) => typeof x === "string") : [];
  const payMethods = accepted ? (pickArray(accepted, ["methods"]) ?? []).filter((x) => typeof x === "string") : [];

  const rateCode = pickString(offer, ["rateCode"]);
  const rateFamily = pickRecord(offer, ["rateFamilyEstimated"]);
  const rateFamilyCode = rateFamily ? pickString(rateFamily, ["code"]) : undefined;
  const commission = pickRecord(offer, ["commission"]);
  const commissionPct = commission ? pickScalar(commission, ["percentage"]) : undefined;
  const guests = pickRecord(offer, ["guests"]);
  const adults = guests ? pickNumber(guests, ["adults"]) : undefined;

  const roomTypeLine = (() => {
    if (category && roomTypeCode && roomTypeCode !== category) return `${category} (${roomTypeCode})`;
    if (category) return category;
    if (roomTypeCode) return roomTypeCode;
    return "";
  })();
  const bedsLine =
    beds != null && bedType
      ? `${beds} ${bedType.toLowerCase()} bed${beds === 1 ? "" : "s"}`
      : beds != null
        ? `${beds} bed${beds === 1 ? "" : "s"}`
        : bedType ?? undefined;

  const hasRoomBlock = Boolean(roomTypeLine || bedsLine || amenities);
  const hasPolicyBlock = Boolean(
    paymentType ||
      refundLabel ||
      cancellations.length > 0 ||
      prepayDeadline ||
      ccList.length > 0 ||
      payMethods.length > 0
  );
  const hasMetaBlock = Boolean(
    rateCode || rateFamilyCode || commissionPct != null || adults != null
  );

  if (!hasRoomBlock && !hasPolicyBlock && !hasMetaBlock) {
    return <p className="text-xs text-muted">No room or policy details in this offer.</p>;
  }

  return (
    <div className="space-y-4 text-xs">
      {hasMetaBlock ? (
        <dl className="space-y-2">
          {rateCode ? (
            <div>
              <dt className="text-[10px] font-medium uppercase text-muted">Rate</dt>
              <dd className="mt-0.5 text-foreground">
                {rateCode}
                {rateFamilyCode && rateFamilyCode !== rateCode ? ` · ${rateFamilyCode}` : null}
              </dd>
            </div>
          ) : null}
          {commissionPct != null ? (
            <div>
              <dt className="text-[10px] font-medium uppercase text-muted">Commission</dt>
              <dd className="mt-0.5 text-foreground">{commissionPct}%</dd>
            </div>
          ) : null}
          {adults != null ? (
            <div>
              <dt className="text-[10px] font-medium uppercase text-muted">Guests</dt>
              <dd className="mt-0.5 text-foreground">
                {adults} adult{adults === 1 ? "" : "s"}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {hasRoomBlock ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Room</p>
          <dl className="mt-2 space-y-2">
            {roomTypeLine ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Room type</dt>
                <dd className="mt-0.5 text-foreground">{roomTypeLine}</dd>
              </div>
            ) : null}
            {bedsLine ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Beds</dt>
                <dd className="mt-0.5 text-foreground">{bedsLine}</dd>
              </div>
            ) : null}
            {amenities ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Room amenities</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-foreground">{amenities}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      {hasPolicyBlock ? (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Policies</p>
          <dl className="mt-2 space-y-2">
            {paymentType ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Payment</dt>
                <dd className="mt-0.5 text-foreground">{formatCategoryOrCodeLabel(paymentType) ?? paymentType}</dd>
              </div>
            ) : null}
            {refundLabel ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Refundability</dt>
                <dd className="mt-0.5 text-foreground">
                  {formatCategoryOrCodeLabel(refundLabel.replace(/_/g, " ")) ?? refundLabel}
                </dd>
              </div>
            ) : null}
            {cancellations.map((c, i) => {
              const rec = c as UnknownRecord;
              const rawDeadline = pickString(rec, ["deadline"]);
              const deadline = rawDeadline ? formatFlightDateTime(rawDeadline) : undefined;
              const nights = pickNumber(rec, ["numberOfNights"]);
              const pType = pickString(rec, ["policyType"]);
              const parts = [
                pType ? formatCategoryOrCodeLabel(pType.replace(/_/g, " ")) : null,
                nights != null ? `${nights} night${nights === 1 ? "" : "s"} penalty window` : null,
                deadline ? `by ${deadline}` : null,
              ].filter(Boolean);
              return (
                <div key={i}>
                  <dt className="text-[10px] font-medium uppercase text-muted">
                    {cancellations.length > 1 ? `Cancellation ${i + 1}` : "Cancellation"}
                  </dt>
                  <dd className="mt-0.5 text-foreground">{parts.length > 0 ? parts.join(" · ") : "—"}</dd>
                </div>
              );
            })}
            {prepayDeadline ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Prepay deadline</dt>
                <dd className="mt-0.5 text-foreground">{formatFlightDateTime(prepayDeadline) ?? prepayDeadline}</dd>
              </div>
            ) : null}
            {payMethods.length > 0 ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Payment methods</dt>
                <dd className="mt-0.5 text-foreground">{payMethods.join(", ")}</dd>
              </div>
            ) : null}
            {ccList.length > 0 ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Cards accepted</dt>
                <dd className="mt-0.5 text-foreground">{ccList.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

/** First line matches parent hotel row: hotel name | stay dates; uses parent stay when option omits fields. */
function HotelOptionBox({
  opt,
  optionIndex,
  parentStay,
  parentHotelIndex,
}: {
  opt: UnknownRecord;
  optionIndex: number;
  parentStay: UnknownRecord;
  parentHotelIndex: number;
}) {
  const itineraryCurrency = useItineraryCurrency();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const h = isObject(opt.hotel) ? (opt.hotel as UnknownRecord) : undefined;
  const name = h ? pickString(h, ["name", "chain", "brand"]) : undefined;
  const parentCity = pickString(parentStay, ["city_code", "city"]);
  const title = name ?? parentCity ?? `Hotel ${optionIndex + 1}`;

  const cityCode = h ? pickString(h, ["city_code", "cityCode", "city"]) : undefined;
  const hotelParts = formatHotelDualPriceParts(opt, itineraryCurrency, parentStay);

  const offer = getPrimaryHotelOffer(opt);
  const checkInOffer = offer ? asIsoDate(pickString(offer, ["checkInDate", "check_in"])) : undefined;
  const checkOutOffer = offer ? asIsoDate(pickString(offer, ["checkOutDate", "check_out"])) : undefined;
  const checkInOpt = h ? asIsoDate(pickString(h, ["check_in", "checkIn"])) : undefined;
  const checkOutOpt = h ? asIsoDate(pickString(h, ["check_out", "checkOut"])) : undefined;
  const checkInParent = asIsoDate(parentStay.check_in);
  const checkOutParent = asIsoDate(parentStay.check_out);
  const dateRight = [checkInOffer ?? checkInOpt ?? checkInParent, checkOutOffer ?? checkOutOpt ?? checkOutParent]
    .filter(Boolean)
    .join(" → ");

  const secondLineCity = cityCode ?? parentCity;
  const hasSecondLine = secondLineCity || hotelParts;

  const detailId = `hotel-${parentHotelIndex}-opt-${optionIndex}`;
  const showDetailsPanel = offer != null;

  return (
    <div className="w-full min-w-0 rounded-lg border border-border/80 bg-background/40">
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        aria-controls={showDetailsPanel ? detailId : undefined}
        id={`${detailId}-summary`}
        className={`w-full flex items-start gap-2 p-3 text-left hover:bg-surface-hover/50 transition-colors ${
          detailsOpen ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className="shrink-0 text-xs text-muted mt-0.5 w-4 text-center" aria-hidden>
          {detailsOpen ? "▼" : "▶"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{title}</p>
            {dateRight ? <p className="text-xs text-muted shrink-0">{dateRight}</p> : null}
          </div>
          {hasSecondLine ? (
            <p className="mt-1 text-xs text-muted flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              {secondLineCity ? <span>{secondLineCity}</span> : null}
              {secondLineCity && hotelParts ? <span className="text-muted">·</span> : null}
              {hotelParts ? <DualPriceDisplay parts={hotelParts} /> : null}
            </p>
          ) : null}
        </div>
      </button>
      {detailsOpen && showDetailsPanel && (
        <div
          id={detailId}
          role="region"
          aria-labelledby={`${detailId}-summary`}
          className="border-t border-border bg-background/25 px-3 py-3"
        >
          <HotelStayDetailsPanel offer={offer} />
        </div>
      )}
      {detailsOpen && !showDetailsPanel && (
        <div
          id={detailId}
          role="region"
          aria-labelledby={`${detailId}-summary`}
          className="border-t border-border bg-background/25 px-3 py-3"
        >
          <p className="text-xs text-muted">No offer details available for this stay.</p>
        </div>
      )}
    </div>
  );
}

function SortableOptionRow({
  id,
  ariaLabel,
  children,
}: {
  id: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    transition: null,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-60" : undefined}>
      <div className="flex items-start gap-1">
        <button
          type="button"
          className="mt-1.5 shrink-0 inline-flex h-8 w-6 items-center justify-center rounded text-muted hover:bg-surface-hover hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
          aria-label={ariaLabel}
          {...listeners}
          {...attributes}
        >
          <span aria-hidden className="select-none text-sm leading-none">
            ⋮⋮
          </span>
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function SortableFlightOptionsList({
  flight,
  flightIndex,
  legIndex,
  parentFlightIndex,
  objectOptions,
  onReorder,
}: {
  flight: UnknownRecord;
  flightIndex: number;
  legIndex: number;
  parentFlightIndex: number;
  objectOptions: UnknownRecord[];
  onReorder: (newOrder: UnknownRecord[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const sortableIds = useMemo(
    () => objectOptions.map((opt) => getFlightOptionSortableId(opt, legIndex, flightIndex)),
    [objectOptions, legIndex, flightIndex]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortableIds.indexOf(String(active.id));
    const newIndex = sortableIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(objectOptions, oldIndex, newIndex));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {objectOptions.map((opt, i) => (
            <SortableOptionRow
              key={sortableIds[i]}
              id={sortableIds[i]}
              ariaLabel="Drag to reorder fare option"
            >
              <FlightOptionBox
                opt={opt}
                optionIndex={i}
                parentFlight={flight}
                parentFlightIndex={parentFlightIndex}
              />
            </SortableOptionRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableHotelOptionsList({
  stay,
  hotelIndex,
  legIndex,
  objectOptions,
  onReorder,
}: {
  stay: UnknownRecord;
  hotelIndex: number;
  legIndex: number;
  objectOptions: UnknownRecord[];
  onReorder: (newOrder: UnknownRecord[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const sortableIds = useMemo(
    () => objectOptions.map((opt) => getHotelOptionSortableId(opt, legIndex, hotelIndex)),
    [objectOptions, legIndex, hotelIndex]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortableIds.indexOf(String(active.id));
    const newIndex = sortableIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(objectOptions, oldIndex, newIndex));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {objectOptions.map((opt, i) => (
            <SortableOptionRow
              key={sortableIds[i]}
              id={sortableIds[i]}
              ariaLabel="Drag to reorder hotel option"
            >
              <HotelOptionBox opt={opt} optionIndex={i} parentStay={stay} parentHotelIndex={hotelIndex} />
            </SortableOptionRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function FlightSegmentFallback({ flight }: { flight: UnknownRecord }) {
  const dep = formatFlightEndpointDisplay(flight, "departure");
  const arr = formatFlightEndpointDisplay(flight, "arrival");
  const from = pickString(flight, ["from", "origin"]);
  const to = pickString(flight, ["to", "destination"]);
  return (
    <div className="rounded-md border border-border/50 bg-background/30 p-3">
      <p className="text-sm font-medium text-foreground">{[from, to].filter(Boolean).join(" → ") || "Route"}</p>
      <p className="mt-1 text-xs text-muted">{[dep, arr].filter(Boolean).join(" → ") || "—"}</p>
      <p className="mt-2 text-[10px] leading-snug text-muted">
        Per-segment breakdown is not available for this itinerary.
      </p>
    </div>
  );
}

function FlightSegmentConnectionRow({ prev, next }: { prev: UnknownRecord; next: UnknownRecord }) {
  const layover = formatConnectionLayover(prev, next);
  const hub = formatAirportLine(next, "departure");
  if (!layover) return null;
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-background/20 px-3 py-2 text-xs">
      <span className="font-medium text-foreground">Connection</span>
      <span className="text-muted"> at {hub}</span>
      <span className="text-muted"> · {layover}</span>
    </div>
  );
}

function FlightSegmentCard({
  seg,
  index,
  total,
  fareDetail,
}: {
  seg: UnknownRecord;
  index: number;
  total: number;
  fareDetail?: UnknownRecord;
}) {
  const dep = formatFlightEndpointFromNestedEndpoint(seg, "departure");
  const arr = formatFlightEndpointFromNestedEndpoint(seg, "arrival");
  const carrier = formatSegmentCarrier(seg);
  const depLoc = formatAirportLine(seg, "departure");
  const arrLoc = formatAirportLine(seg, "arrival");

  const cabinLabel = fareDetail ? formatCabinClassLabel(fareDetail.cabin) : undefined;
  const checkedBags = fareDetail ? formatFareBagsLine(pickFareBagsField(fareDetail, "checked")) : undefined;
  const cabinBags = fareDetail ? formatFareBagsLine(pickFareBagsField(fareDetail, "cabin")) : undefined;
  const hasFareExtras = Boolean(cabinLabel || checkedBags || cabinBags);

  return (
    <div className="rounded-md border border-border/50 bg-background/30 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
        Segment {index + 1}
        {total > 1 ? ` of ${total}` : ""}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">{carrier}</p>
      <dl className="mt-2 space-y-2 text-xs">
        <div>
          <dt className="text-[10px] font-medium uppercase text-muted">Departure</dt>
          <dd className="mt-0.5 text-foreground">{depLoc}</dd>
          <dd className="text-muted">{dep ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-medium uppercase text-muted">Arrival</dt>
          <dd className="mt-0.5 text-foreground">{arrLoc}</dd>
          <dd className="text-muted">{arr ?? "—"}</dd>
        </div>
        {hasFareExtras ? (
          <>
            {cabinLabel ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Cabin class</dt>
                <dd className="mt-0.5 text-foreground">{cabinLabel}</dd>
              </div>
            ) : null}
            {checkedBags ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Checked bags</dt>
                <dd className="mt-0.5 text-foreground">{checkedBags}</dd>
              </div>
            ) : null}
            {cabinBags ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Cabin bags</dt>
                <dd className="mt-0.5 text-foreground">{cabinBags}</dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>
    </div>
  );
}

function FlightSegmentDetailList({
  flight,
  segmentsFrom,
}: {
  flight: UnknownRecord;
  /** When set (e.g. a fare option), segments are read from this record only. */
  segmentsFrom?: UnknownRecord;
}) {
  const segments =
    segmentsFrom !== undefined ? collectSegmentsFromRecord(segmentsFrom) : gatherSegmentsForFlight(flight);
  const fallbackRecord = segmentsFrom ?? flight;
  /** Cabin/bags usually live on the offer option (`travelerPricings`); fall back to parent flight. */
  const fareSource = segmentsFrom ?? flight;
  const fareDetailsInOrder = getFirstTravelerFareDetailsBySegment(fareSource);
  const fareById = buildFareDetailBySegmentId(fareDetailsInOrder);

  if (segments.length === 0) {
    return <FlightSegmentFallback flight={fallbackRecord} />;
  }
  return (
    <div className="space-y-2">
      {segments.map((seg, i) => (
        <Fragment key={i}>
          <FlightSegmentCard
            seg={seg}
            index={i}
            total={segments.length}
            fareDetail={resolveFareDetailForSegment(seg, i, fareDetailsInOrder, fareById)}
          />
          {i < segments.length - 1 ? <FlightSegmentConnectionRow prev={segments[i]} next={segments[i + 1]} /> : null}
        </Fragment>
      ))}
    </div>
  );
}

function FlightRow({
  flight,
  labelIndex,
  legIndex,
  onOptionsReorder,
}: {
  flight: UnknownRecord;
  labelIndex: number;
  legIndex: number;
  onOptionsReorder?: (newOptions: UnknownRecord[]) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const from = pickString(flight, ["from"]);
  const to = pickString(flight, ["to"]);
  const options = pickArray(flight, ["options"]) ?? [];
  const objectOptions = options.filter(isObject) as UnknownRecord[];

  const title = [from, to].filter(Boolean).join(" → ") || `Flight ${labelIndex + 1}`;
  const canSortOptions = Boolean(onOptionsReorder) && objectOptions.length > 1;

  const departSummary = formatFlightEndpointDisplay(flight, "departure", true);
  const arriveSummary = formatFlightEndpointDisplay(flight, "arrival", true);
  const dateSummary = [departSummary, arriveSummary].filter(Boolean).join(" → ");

  return (
    <div className="w-full min-w-0 rounded-lg border border-border/80 bg-background/40">
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        aria-controls={`flight-detail-${labelIndex}`}
        id={`flight-summary-${labelIndex}`}
        className={`w-full flex items-start gap-2 p-3 text-left hover:bg-surface-hover/50 transition-colors ${
          detailsOpen ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className="shrink-0 text-xs text-muted mt-0.5 w-4 text-center" aria-hidden>
          {detailsOpen ? "▼" : "▶"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <p className="min-w-0 text-sm text-foreground">
              <span className="font-medium">{title}</span>
              {dateSummary ? (
                <>
                  <span className="font-medium text-muted"> · </span>
                  <span className="font-normal text-muted">{dateSummary}</span>
                </>
              ) : null}
            </p>
            {objectOptions.length > 0 ? (
              <p className="text-xs text-muted shrink-0">
                {objectOptions.length === 1 ? "1 fare option" : `${objectOptions.length} fare options`}
              </p>
            ) : null}
          </div>
        </div>
      </button>
      {detailsOpen && (
        <div
          id={`flight-detail-${labelIndex}`}
          role="region"
          aria-labelledby={`flight-summary-${labelIndex}`}
          className={LEG_OPTION_PANEL_CLASS}
        >
          {objectOptions.length > 0 ? (
            canSortOptions && onOptionsReorder ? (
              <SortableFlightOptionsList
                flight={flight}
                flightIndex={labelIndex}
                legIndex={legIndex}
                parentFlightIndex={labelIndex}
                objectOptions={objectOptions}
                onReorder={onOptionsReorder}
              />
            ) : (
              <div className="space-y-2">
                {objectOptions.map((opt, i) => (
                  <FlightOptionBox
                    key={i}
                    opt={opt}
                    optionIndex={i}
                    parentFlight={flight}
                    parentFlightIndex={labelIndex}
                  />
                ))}
              </div>
            )
          ) : (
            <FlightSegmentDetailList flight={flight} />
          )}
        </div>
      )}
    </div>
  );
}

function HotelRow({
  stay,
  labelIndex,
  legIndex,
  onOptionsReorder,
}: {
  stay: UnknownRecord;
  labelIndex: number;
  legIndex: number;
  onOptionsReorder?: (newOptions: UnknownRecord[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const cityCode = pickString(stay, ["city_code", "city"]);
  const options = pickArray(stay, ["options"]) ?? [];
  const objectOptions = options.filter(isObject) as UnknownRecord[];

  const title = cityCode ? `Hotels · ${cityCode}` : `Hotel ${labelIndex + 1}`;
  const canSortOptions = Boolean(onOptionsReorder) && objectOptions.length > 1;

  return (
    <div className="w-full min-w-0 rounded-lg border border-border/80 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`w-full flex items-start gap-2 p-3 text-left hover:bg-surface-hover/50 transition-colors ${
          open ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className="shrink-0 text-xs text-muted mt-0.5 w-4 text-center" aria-hidden>
          {open ? "▼" : "▶"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <p className="text-sm font-medium text-foreground">{title}</p>
            {objectOptions.length > 1 ? (
              <p className="text-xs text-muted shrink-0">{objectOptions.length} hotel options</p>
            ) : null}
          </div>
        </div>
      </button>
      {open && (
        <div className={LEG_OPTION_PANEL_CLASS}>
          {objectOptions.length > 0 ? (
            canSortOptions && onOptionsReorder ? (
              <SortableHotelOptionsList
                stay={stay}
                hotelIndex={labelIndex}
                legIndex={legIndex}
                objectOptions={objectOptions}
                onReorder={onOptionsReorder}
              />
            ) : (
              <div className="space-y-2">
                {objectOptions.map((opt, i) => (
                  <HotelOptionBox key={i} opt={opt} optionIndex={i} parentStay={stay} parentHotelIndex={labelIndex} />
                ))}
              </div>
            )
          ) : (
            <p className="pl-3 text-xs text-muted">No hotel options listed.</p>
          )}
        </div>
      )}
    </div>
  );
}

function LegFlightsBlock({
  flights,
  legIndex,
  onReorderFlightOptions,
}: {
  flights: unknown[];
  legIndex: number;
  onReorderFlightOptions?: (flightIndex: number, newOptions: unknown[]) => void;
}) {
  const list = flights.filter(isObject) as UnknownRecord[];
  if (list.length === 0) return null;

  const listClass = "mt-2 flex w-full min-w-0 flex-col gap-2";

  return (
    <div>
      <p className="text-xs font-medium text-muted">Flights</p>
      <div className={listClass}>
        {list.map((flight, idx) => (
          <FlightRow
            key={idx}
            flight={flight}
            labelIndex={idx}
            legIndex={legIndex}
            onOptionsReorder={
              onReorderFlightOptions
                ? (newOrder) => onReorderFlightOptions(idx, newOrder)
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function LegHotelsBlock({
  hotels,
  legIndex,
  onReorderHotelOptions,
}: {
  hotels: unknown[];
  legIndex: number;
  onReorderHotelOptions?: (hotelIndex: number, newOptions: unknown[]) => void;
}) {
  const list = hotels.filter(isObject) as UnknownRecord[];
  if (list.length === 0) return null;

  const listClass = "mt-2 flex w-full min-w-0 flex-col gap-2";

  return (
    <div>
      <p className="text-xs font-medium text-muted">Hotels</p>
      <div className={listClass}>
        {list.map((stay, idx) => (
          <HotelRow
            key={idx}
            stay={stay}
            labelIndex={idx}
            legIndex={legIndex}
            onOptionsReorder={
              onReorderHotelOptions
                ? (newOrder) => onReorderHotelOptions(idx, newOrder)
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function RankedItineraryCard({ envelope, ranked }: { envelope: UnknownRecord; ranked: UnknownRecord }) {
  const itineraryIndex = pickNumber(envelope, ["itinerary_index"]);
  const itineraryCount = pickNumber(envelope, ["itinerary_count"]);

  const [rankedState, setRankedState] = useState<UnknownRecord>(() => structuredClone(ranked));

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
  const itineraryStartRaw = summary
    ? pickString(summary, ["itinerary_start_date", "start_date", "startDate"])
    : undefined;
  const itineraryEndRaw = summary
    ? pickString(summary, ["itinerary_end_date", "end_date", "endDate"])
    : undefined;
  const itineraryStartIso = itineraryStartRaw ? asIsoDate(itineraryStartRaw) : undefined;
  const itineraryEndIso = itineraryEndRaw ? asIsoDate(itineraryEndRaw) : undefined;
  const itineraryCurrency = summary ? pickString(summary, ["itinerary_currency"]) : undefined;
  const hasHotelOptionsInData = rankedItineraryHasHotelOptions(rankedState);

  const { flightsSummaryParts, hotelsSummaryParts } = useMemo(() => {
    const t = computeFlightHotelItineraryTotalsFromRanked(rankedState);
    return {
      flightsSummaryParts: computedFlightHotelSummaryParts(
        t.flightsItinSum,
        t.flightsContributions,
        itineraryCurrency
      ),
      hotelsSummaryParts: hasHotelOptionsInData
        ? computedFlightHotelSummaryParts(
            t.hotelsItinSum,
            t.hotelsContributions,
            itineraryCurrency
          )
        : undefined,
    };
  }, [rankedState, itineraryCurrency, hasHotelOptionsInData]);

  const legs = getLegsFromRanked(rankedState);
  const legsWithContent = legs.filter((leg) => {
    const f = pickArray(leg, ["flights"]) ?? [];
    const h = pickArray(leg, ["hotels"]) ?? [];
    return f.length > 0 || h.length > 0;
  });

  return (
    <ItineraryCurrencyContext.Provider value={itineraryCurrency}>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              Itinerary
              {typeof itineraryIndex === "number" && typeof itineraryCount === "number"
                ? ` • ${itineraryIndex + 1}/${itineraryCount}`
                : ""}
            </p>
          </div>
        </div>

        {(itineraryStartIso != null ||
          itineraryEndIso != null ||
          totalDays != null ||
          flightsSummaryParts != null ||
          hotelsSummaryParts != null ||
          hasHotelOptionsInData) && (
          <div
            className={`mt-3 grid gap-2 ${hasHotelOptionsInData ? "grid-cols-3" : "grid-cols-2"}`}
          >
            <div className="rounded-lg border border-border bg-background/40 p-2">
              <p className="text-[10px] text-muted">Dates</p>
              <p className="text-sm font-medium text-foreground">
                {formatItinerarySummaryDates(itineraryStartIso, itineraryEndIso, totalDays)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background/40 p-2">
              <p className="text-[10px] text-muted">Flights</p>
              <p className="text-sm font-medium text-foreground">
                {flightsSummaryParts ? <DualPriceDisplay parts={flightsSummaryParts} /> : "—"}
              </p>
            </div>
            {hasHotelOptionsInData ? (
              <div className="rounded-lg border border-border bg-background/40 p-2">
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
              <div key={legIdx} className="rounded-lg border border-border/80 bg-background/30 p-3">
                {(legLabel || legDates) && (
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    {legLabel && <p className="text-sm font-medium text-foreground">{legLabel}</p>}
                    {legDates && <p className="text-xs text-muted">{legDates}</p>}
                  </div>
                )}
                <div className="space-y-4">
                  <LegFlightsBlock
                    flights={legFlights}
                    legIndex={legIdx}
                    onReorderFlightOptions={(flightIndex, newOptions) =>
                      reorderFlightOptions(legIdx, flightIndex, newOptions)
                    }
                  />
                  <LegHotelsBlock
                    hotels={legHotels}
                    legIndex={legIdx}
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
    </ItineraryCurrencyContext.Provider>
  );
}

function normalizeItineraryRoot(data: unknown): UnknownRecord | undefined {
  if (!isObject(data)) return undefined;
  if ("itinerary" in data && isObject(data.itinerary)) return data.itinerary;
  if ("ranked_itinerary" in data && isObject((data as UnknownRecord).ranked_itinerary)) {
    return (data as UnknownRecord).ranked_itinerary as UnknownRecord;
  }
  if ("ranked" in data && isObject((data as UnknownRecord).ranked)) {
    return (data as UnknownRecord).ranked as UnknownRecord;
  }
  if ("data" in data && isObject(data.data)) {
    const inner = data.data;
    if ("itinerary" in inner && isObject(inner.itinerary)) return inner.itinerary;
    if ("ranked_itinerary" in inner && isObject((inner as UnknownRecord).ranked_itinerary)) {
      return (inner as UnknownRecord).ranked_itinerary as UnknownRecord;
    }
    if ("ranked" in inner && isObject((inner as UnknownRecord).ranked)) {
      return (inner as UnknownRecord).ranked as UnknownRecord;
    }
    return inner as UnknownRecord;
  }
  return data;
}

export function ItineraryCard({ data }: { data: unknown }) {
  // Envelope-aware ranked itinerary format:
  // { type: "ranked" | "ranked_itinerary" | "ranked", id, itinerary_index, itinerary_count, ranked_itinerary: {...} }
  if (isObject(data) && "ranked_itinerary" in data && isObject((data as UnknownRecord).ranked_itinerary)) {
    return <RankedItineraryCard envelope={data} ranked={(data as UnknownRecord).ranked_itinerary as UnknownRecord} />;
  }

  const root = normalizeItineraryRoot(data);
  if (!root) return null;

  const title =
    pickString(root, ["title", "name"]) ??
    pickString(root, ["destination", "location", "city", "country"]) ??
    "Itinerary";

  const subtitleParts: string[] = [];
  const destination = pickString(root, ["destination", "location"]);
  const start = pickString(root, ["start_date", "startDate", "from", "start"]);
  const end = pickString(root, ["end_date", "endDate", "to", "end"]);
  const duration = pickString(root, ["duration", "duration_days", "durationDays"]);

  if (destination && destination !== title) subtitleParts.push(destination);
  if (start || end) subtitleParts.push([start, end].filter(Boolean).join(" → "));
  if (duration) subtitleParts.push(duration);

  const summary =
    pickString(root, ["summary", "overview", "description"]) ??
    pickString(root, ["notes"]);

  const days = pickArray(root, ["days", "day_plans", "dayPlans"]) ?? [];

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          {subtitleParts.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-muted">{subtitleParts.join(" • ")}</p>
          )}
        </div>
      </div>

      {summary && <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{summary}</p>}

      {days.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted">Days</p>
          <div className="mt-2 space-y-2">
            {days.slice(0, 7).map((d, idx) => {
              const dayObj = isObject(d) ? d : undefined;
              const dayTitle =
                (dayObj && pickString(dayObj, ["title", "name"])) || `Day ${idx + 1}`;
              const dayDate = dayObj && pickString(dayObj, ["date", "day", "start_date"]);
              const activities =
                dayObj && (pickArray(dayObj, ["activities", "items", "plan"]) ?? []);

              return (
                <div key={idx} className="rounded-lg border border-border bg-background/40 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{dayTitle}</p>
                    {dayDate && <p className="text-xs text-muted">{dayDate}</p>}
                  </div>
                  {Array.isArray(activities) && activities.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-sm text-foreground">
                      {activities.slice(0, 4).map((a, i) => (
                        <li key={i} className="whitespace-pre-wrap">
                          {typeof a === "string"
                            ? a
                            : isObject(a)
                              ? pickString(a, ["title", "name", "description"]) ?? JSON.stringify(a)
                              : String(a)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {days.length > 7 && (
              <p className="text-xs text-muted">Showing first 7 days…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

