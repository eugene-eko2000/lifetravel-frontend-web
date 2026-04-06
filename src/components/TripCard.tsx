"use client";

import { RankedTripCard } from "./trip/RankedTripCard";
import type { TripLocationMaps, UnknownRecord } from "./trip/tripShared";
import {
  isObject,
  pickArray,
  pickString,
} from "./trip/tripShared";

export type { TripLocationMaps };

export function looksLikeTrip(data: unknown): boolean {
  if (!isObject(data)) return false;

  if ("trip" in data && isObject(data.trip)) return true;
  if ("ranked_trip" in data && isObject((data as UnknownRecord).ranked_trip)) return true;
  if ("itinerary" in data && isObject(data.itinerary)) return true;
  if ("ranked_itinerary" in data && isObject((data as UnknownRecord).ranked_itinerary)) return true;
  if ("ranked" in data && isObject((data as UnknownRecord).ranked)) return true;
  if (Array.isArray((data as UnknownRecord).days)) return true;
  if (Array.isArray((data as UnknownRecord).day_plans)) return true;
  if (Array.isArray((data as UnknownRecord).dayPlans)) return true;

  if ("data" in data && isObject(data.data)) {
    const inner = data.data;
    if ("trip" in inner && isObject(inner.trip)) return true;
    if ("ranked_trip" in inner && isObject((inner as UnknownRecord).ranked_trip)) return true;
    if ("itinerary" in inner && isObject(inner.itinerary)) return true;
    if ("ranked_itinerary" in inner && isObject((inner as UnknownRecord).ranked_itinerary)) return true;
    if ("ranked" in inner && isObject((inner as UnknownRecord).ranked)) return true;
    if (Array.isArray((inner as UnknownRecord).days)) return true;
    if (Array.isArray((inner as UnknownRecord).day_plans)) return true;
    if (Array.isArray((inner as UnknownRecord).dayPlans)) return true;
  }

  return false;
}

function normalizeTripRoot(data: unknown): UnknownRecord | undefined {
  if (!isObject(data)) return undefined;
  if ("trip" in data && isObject(data.trip)) return data.trip as UnknownRecord;
  if ("ranked_trip" in data && isObject((data as UnknownRecord).ranked_trip)) {
    return (data as UnknownRecord).ranked_trip as UnknownRecord;
  }
  if ("itinerary" in data && isObject(data.itinerary)) return data.itinerary;
  if ("ranked_itinerary" in data && isObject((data as UnknownRecord).ranked_itinerary)) {
    return (data as UnknownRecord).ranked_itinerary as UnknownRecord;
  }
  if ("ranked" in data && isObject((data as UnknownRecord).ranked)) {
    return (data as UnknownRecord).ranked as UnknownRecord;
  }
  if ("data" in data && isObject(data.data)) {
    const inner = data.data;
    if ("trip" in inner && isObject(inner.trip)) return inner.trip as UnknownRecord;
    if ("ranked_trip" in inner && isObject((inner as UnknownRecord).ranked_trip)) {
      return (inner as UnknownRecord).ranked_trip as UnknownRecord;
    }
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

export type TripCardVariant = "thumbnail" | "detailed";

export function TripCard({
  data,
  variant = "thumbnail",
}: {
  data: unknown;
  /** Inline chat previews use `thumbnail` (no expand chevrons); modal uses `detailed`. */
  variant?: TripCardVariant;
}) {
  if (isObject(data) && "ranked_trip" in data && isObject((data as UnknownRecord).ranked_trip)) {
    return (
      <RankedTripCard
        envelope={data}
        ranked={(data as UnknownRecord).ranked_trip as UnknownRecord}
        variant={variant}
      />
    );
  }
  if (isObject(data) && "ranked_itinerary" in data && isObject((data as UnknownRecord).ranked_itinerary)) {
    return (
      <RankedTripCard
        envelope={data}
        ranked={(data as UnknownRecord).ranked_itinerary as UnknownRecord}
        variant={variant}
      />
    );
  }

  const root = normalizeTripRoot(data);
  if (!root) return null;

  const title =
    pickString(root, ["title", "name"]) ??
    pickString(root, ["destination", "location", "city", "country"]) ??
    "Trip";

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
    <div className="max-w-full min-w-0 overflow-hidden rounded-xl border border-border bg-surface p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
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
                <div key={idx} className="min-w-0 rounded-lg border border-border bg-background/40 p-2.5 sm:p-3">
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
