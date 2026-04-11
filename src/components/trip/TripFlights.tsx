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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Fragment, useMemo, useState } from "react";
import { DualPriceDisplay, formatAmadeusDualPriceParts } from "./tripDualPrice";
import { useTripCarriers, useTripCurrency, useTripLocationMaps } from "./TripCardContexts";
import type { UnknownRecord } from "./tripShared";
import {
  DEFAULT_OPTION_CARD_CLASS,
  formatDurationMinutesAsHoursMinutes,
  getFlightOptionSortableId,
  isObject,
  LEG_OPTION_PANEL_CLASS,
  pickArray,
  pickNumber,
  pickString,
  TOP_OPTION_CARD_CLASS,
} from "./tripShared";
import {
  collectSegmentGroupsFromRecord,
  formatAirportLineWithMaps,
  formatCabinClassLabel,
  formatConnectionLayover,
  formatFareBagsLine,
  formatFlightEndpointDisplay,
  formatFlightEndpointFromNestedEndpoint,
  formatOptionCarrierAndFlightLine,
  formatSegmentCarrier,
  formatSegmentDuration,
  formatSegmentOperatedByLine,
  gatherFlightOfferSourceRecord,
  getFlightLegHeadersFromOffer,
  type FlightLegHeaderParts,
  getMultiItinerarySummaryLines,
  getFirstTravelerFareDetailsBySegment,
  buildFareDetailBySegmentId,
  resolveFareDetailForSegment,
  itineraryGroupLabel,
  pickFareBagsField,
  pickFlightOptionRouteAirportCodes,
  resolveFlightHeaderPlaceLabel,
} from "./tripFlightFormatting";
import { SortableOptionRow } from "./SortableOptionRow";

/** When `priceOnly`, show dual price only (header line already includes duration & stops). */
function FlightOptionMetaLine({ opt, priceOnly }: { opt: UnknownRecord; priceOnly?: boolean }) {
  const tripCurrency = useTripCurrency();
  const price = isObject(opt.price) ? (opt.price as UnknownRecord) : undefined;
  const parts = price ? formatAmadeusDualPriceParts(price, tripCurrency) : undefined;
  const ranking = isObject(opt._ranking) ? (opt._ranking as UnknownRecord) : undefined;
  const durationMinutes =
    !priceOnly && ranking ? pickNumber(ranking, ["duration_minutes"]) : undefined;
  const stops = !priceOnly && ranking ? pickNumber(ranking, ["stops"]) : undefined;
  if (parts == null && durationMinutes == null && stops == null) return null;
  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 break-words text-xs text-muted">
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

function FlightLegHeaderGrid({ rows }: { rows: FlightLegHeaderParts[] }) {
  return (
    <>
      {/* Narrow viewports: one card per leg, label/value rows (no horizontal scroll). */}
      <div className="space-y-2.5 md:hidden">
        {rows.map((row, i) => (
          <div
            key={i}
            className="rounded-lg border border-border/60 bg-background/30 p-2.5 text-sm shadow-sm"
          >
            <dl className="space-y-2 text-sm">
              <div className="flex flex-col gap-0.5">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">From – to</dt>
                <dd className="min-w-0 break-words font-medium text-foreground">{row.route}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">Date & time</dt>
                <dd className="min-w-0 break-words text-foreground">{row.schedule}</dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">Duration</dt>
                  <dd className="tabular-nums text-muted">{row.duration}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">Stops</dt>
                  <dd className="tabular-nums text-muted">{row.stops}</dd>
                </div>
              </div>
            </dl>
          </div>
        ))}
      </div>

      {/* md+: aligned columns */}
      <div className="hidden min-w-0 md:block">
        <div className="grid grid-cols-4 gap-2 border-b border-border/50 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">
          <span className="min-w-0">From – to</span>
          <span className="min-w-0">Date & time</span>
          <span className="min-w-0">Duration</span>
          <span className="min-w-0">Stops</span>
        </div>
        <div className="divide-y divide-border/40">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-4 gap-2 py-2 text-sm">
              <span className="min-w-0 break-words font-medium text-foreground">{row.route}</span>
              <span className="min-w-0 break-words text-foreground">{row.schedule}</span>
              <span className="min-w-0 tabular-nums text-muted">{row.duration}</span>
              <span className="min-w-0 tabular-nums text-muted">{row.stops}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Fare option summary; falls back to title + dates when segment data is missing. */
function FlightOptionBox({
  opt,
  optionIndex,
  parentFlight,
  parentFlightIndex,
  showExpandChevrons = false,
}: {
  opt: UnknownRecord;
  optionIndex: number;
  parentFlight: UnknownRecord;
  parentFlightIndex: number;
  showExpandChevrons?: boolean;
}) {
  const maps = useTripLocationMaps();
  const carriers = useTripCarriers();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const routeAirports = pickFlightOptionRouteAirportCodes(opt, parentFlight);
  const routeTitle = [routeAirports.from, routeAirports.to].filter(Boolean).join(" → ");
  const airline = pickString(opt, ["airline", "carrier", "validating_airline", "marketing_airline"]);
  const flightNo = pickString(opt, ["flight_number", "number", "flight"]);
  const carrierFlightLine = formatOptionCarrierAndFlightLine(airline, flightNo, carriers);
  const title =
    routeTitle ||
    carrierFlightLine ||
    airline ||
    `Flight ${optionIndex + 1}`;

  const depart =
    formatFlightEndpointDisplay(opt, "departure") ?? formatFlightEndpointDisplay(parentFlight, "departure");
  const arrive =
    formatFlightEndpointDisplay(opt, "arrival") ?? formatFlightEndpointDisplay(parentFlight, "arrival");
  const dateRight = [depart, arrive].filter(Boolean).join(" → ");
  const headerRows = getFlightLegHeadersFromOffer(opt, parentFlight, maps, "airport");
  const detailId = `flight-${parentFlightIndex}-opt-${optionIndex}`;
  const isTopOption = optionIndex === 0;

  return (
    <div
      className={`w-full min-w-0 max-w-full overflow-hidden rounded-lg border ${
        isTopOption ? TOP_OPTION_CARD_CLASS : DEFAULT_OPTION_CARD_CLASS
      }`}
    >
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        aria-controls={detailId}
        id={`${detailId}-summary`}
        className={`flex w-full min-w-0 touch-manipulation items-start ${
          showExpandChevrons ? "gap-2" : ""
        } p-2.5 text-left transition-colors hover:bg-surface-hover/50 sm:p-3 ${
          detailsOpen ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        {showExpandChevrons ? (
          <span className="mt-0.5 w-4 shrink-0 text-center text-xs text-muted" aria-hidden>
            {detailsOpen ? "▼" : "▶"}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          {headerRows.length > 0 ? (
            <FlightLegHeaderGrid rows={headerRows} />
          ) : (
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{title}</p>
              {dateRight ? <p className="text-xs text-muted shrink-0">{dateRight}</p> : null}
            </div>
          )}
          <FlightOptionMetaLine opt={opt} priceOnly={headerRows.length > 0} />
        </div>
      </button>
      {detailsOpen && (
        <div
          id={detailId}
          role="region"
          aria-labelledby={`${detailId}-summary`}
          className="border-t border-border bg-background/25 px-2.5 py-2.5 sm:px-3 sm:py-3"
        >
          <FlightSegmentDetailList flight={parentFlight} segmentsFrom={opt} />
        </div>
      )}
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
  showExpandChevrons = false,
}: {
  flight: UnknownRecord;
  flightIndex: number;
  legIndex: number;
  parentFlightIndex: number;
  objectOptions: UnknownRecord[];
  onReorder: (newOrder: UnknownRecord[]) => void;
  showExpandChevrons?: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 6,
      },
    }),
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
              ariaLabel="Fare option: press and hold, then drag to reorder"
            >
              <FlightOptionBox
                opt={opt}
                optionIndex={i}
                parentFlight={flight}
                parentFlightIndex={parentFlightIndex}
                showExpandChevrons={showExpandChevrons}
              />
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
        Per-segment breakdown is not available for this trip.
      </p>
    </div>
  );
}

function FlightSegmentConnectionRow({ prev, next }: { prev: UnknownRecord; next: UnknownRecord }) {
  const maps = useTripLocationMaps();
  const layover = formatConnectionLayover(prev, next);
  const hub = formatAirportLineWithMaps(next, "departure", maps);
  if (!layover) return null;
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-background/20 px-3 py-2 text-xs">
      <span className="font-medium text-muted">Connection at </span>
      <span className="font-bold text-foreground">
        {hub} · {layover}
      </span>
    </div>
  );
}

function FlightSegmentCard({
  seg,
  index,
  total,
  fareDetail,
  /** When set (multi-itinerary offer), "Segment X of Y" counts within this itinerary only. */
  segmentIndexInLeg,
  segmentCountInLeg,
}: {
  seg: UnknownRecord;
  /** Global index for fare matching (`fareDetailsBySegment` order). */
  index: number;
  total: number;
  fareDetail?: UnknownRecord;
  segmentIndexInLeg?: number;
  segmentCountInLeg?: number;
}) {
  const maps = useTripLocationMaps();
  const carriers = useTripCarriers();
  const dep = formatFlightEndpointFromNestedEndpoint(seg, "departure");
  const arr = formatFlightEndpointFromNestedEndpoint(seg, "arrival");
  const carrier = formatSegmentCarrier(seg, carriers);
  const operatedByLine = formatSegmentOperatedByLine(seg, carriers);
  const segmentDuration = formatSegmentDuration(seg);
  const depLoc = formatAirportLineWithMaps(seg, "departure", maps);
  const arrLoc = formatAirportLineWithMaps(seg, "arrival", maps);

  const cabinLabel = fareDetail ? formatCabinClassLabel(fareDetail.cabin) : undefined;
  const checkedBags = fareDetail ? formatFareBagsLine(pickFareBagsField(fareDetail, "checked")) : undefined;
  const cabinBags = fareDetail ? formatFareBagsLine(pickFareBagsField(fareDetail, "cabin")) : undefined;
  const hasFareExtras = Boolean(cabinLabel || checkedBags || cabinBags);

  const useLegLabels =
    segmentIndexInLeg !== undefined && segmentCountInLeg !== undefined && segmentCountInLeg > 0;
  const labelNum = useLegLabels ? segmentIndexInLeg + 1 : index + 1;
  const labelTotal = useLegLabels ? segmentCountInLeg : total;

  return (
    <div className="rounded-md border border-border/50 bg-background/30 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
        Segment {labelNum}
        {labelTotal > 1 ? ` of ${labelTotal}` : ""}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">{carrier}</p>
      {operatedByLine ? (
        <p className="mt-1 text-xs text-muted">{operatedByLine}</p>
      ) : null}
      <div className="mt-2 min-w-0">
        <table className="w-full min-w-0 table-fixed border-collapse text-xs">
          <colgroup>
            <col className="w-[38%]" />
            <col className="w-[38%]" />
            <col className="w-[24%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border/60">
              <th className="pb-1.5 pr-1 text-left align-bottom text-[10px] font-medium uppercase tracking-wide text-muted sm:pr-2">
                Departure
              </th>
              <th className="pb-1.5 pr-1 text-left align-bottom text-[10px] font-medium uppercase tracking-wide text-muted sm:pr-2">
                Arrival
              </th>
              <th className="pb-1.5 text-left align-bottom text-[10px] font-medium uppercase tracking-wide text-muted">
                Duration
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="align-top py-1.5 pr-1 font-semibold text-foreground sm:pr-2">
                <div className="min-w-0 break-words">{depLoc}</div>
                <div className="mt-0.5 min-w-0 break-words">{dep ?? "—"}</div>
              </td>
              <td className="align-top py-1.5 pr-1 font-semibold text-foreground sm:pr-2">
                <div className="min-w-0 break-words">{arrLoc}</div>
                <div className="mt-0.5 min-w-0 break-words">{arr ?? "—"}</div>
              </td>
              <td className="align-top py-1.5 font-semibold text-foreground tabular-nums">
                {segmentDuration ?? "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {hasFareExtras ? (
        <dl className="mt-3 space-y-2 border-t border-border/40 pt-3 text-xs">
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
        </dl>
      ) : null}
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
  const source = segmentsFrom !== undefined ? segmentsFrom : gatherFlightOfferSourceRecord(flight);
  const groups = collectSegmentGroupsFromRecord(source);
  const fallbackRecord = segmentsFrom ?? flight;
  /** Cabin/bags usually live on the offer option (`travelerPricings`); fall back to parent flight. */
  const fareSource = segmentsFrom ?? flight;
  const fareDetailsInOrder = getFirstTravelerFareDetailsBySegment(fareSource);
  const fareById = buildFareDetailBySegmentId(fareDetailsInOrder);

  const flatCount = groups.reduce((n, g) => n + g.length, 0);
  if (flatCount === 0) {
    return <FlightSegmentFallback flight={fallbackRecord} />;
  }

  if (groups.length <= 1) {
    const segments = groups[0] ?? [];
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
            {i < segments.length - 1 ? (
              <FlightSegmentConnectionRow prev={segments[i]} next={segments[i + 1]} />
            ) : null}
          </Fragment>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group, gi) => {
        const segStart = groups.slice(0, gi).reduce((s, g) => s + g.length, 0);
        const legLabel = itineraryGroupLabel(gi, groups.length);
        return (
          <div
            key={gi}
            className="overflow-hidden rounded-lg border border-border/70 bg-background/25"
          >
            <div className="border-b border-border/50 bg-muted/20 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground">{legLabel}</p>
              {group.length > 1 ? (
                <p className="mt-0.5 text-[10px] text-muted">
                  {group.length} segment{group.length === 1 ? "" : "s"} in this direction
                </p>
              ) : null}
            </div>
            <div className="space-y-2 px-3 py-2">
              {group.map((seg, si) => {
                const idx = segStart + si;
                return (
                  <Fragment key={`${gi}-${si}`}>
                    <FlightSegmentCard
                      seg={seg}
                      index={idx}
                      total={flatCount}
                      segmentIndexInLeg={si}
                      segmentCountInLeg={group.length}
                      fareDetail={resolveFareDetailForSegment(seg, idx, fareDetailsInOrder, fareById)}
                    />
                    {si < group.length - 1 ? (
                      <FlightSegmentConnectionRow prev={group[si]} next={group[si + 1]} />
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FlightRow({
  flight,
  labelIndex,
  legIndex,
  onOptionsReorder,
  showExpandChevrons = false,
}: {
  flight: UnknownRecord;
  labelIndex: number;
  legIndex: number;
  onOptionsReorder?: (newOptions: UnknownRecord[]) => void;
  showExpandChevrons?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const maps = useTripLocationMaps();
  const from = pickString(flight, ["from"]);
  const to = pickString(flight, ["to"]);
  const options = pickArray(flight, ["options"]) ?? [];
  const objectOptions = options.filter(isObject) as UnknownRecord[];

  const title =
    [resolveFlightHeaderPlaceLabel(from, maps), resolveFlightHeaderPlaceLabel(to, maps)].filter(Boolean).join(" → ") ||
    `Flight ${labelIndex + 1}`;
  const canSortOptions = Boolean(onOptionsReorder) && objectOptions.length > 1;

  const previewSource = objectOptions[0] ?? flight;
  const multiItinLines = getMultiItinerarySummaryLines(previewSource, maps);
  const departSummary = formatFlightEndpointDisplay(flight, "departure", true);
  const arriveSummary = formatFlightEndpointDisplay(flight, "arrival", true);
  const dateSummary =
    departSummary && arriveSummary && departSummary === arriveSummary
      ? departSummary
      : [departSummary, arriveSummary].filter(Boolean).join(" → ");

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-border/80 bg-background/40">
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        aria-controls={`flight-detail-${labelIndex}`}
        id={`flight-summary-${labelIndex}`}
        className={`flex w-full min-w-0 touch-manipulation items-start ${
          showExpandChevrons ? "gap-2" : ""
        } p-2.5 text-left transition-colors hover:bg-surface-hover/50 sm:p-3 ${
          detailsOpen ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        {showExpandChevrons ? (
          <span className="mt-0.5 w-4 shrink-0 text-center text-xs text-muted" aria-hidden>
            {detailsOpen ? "▼" : "▶"}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-2 sm:gap-y-1">
            {multiItinLines && multiItinLines.length > 1 ? (
              <div className="min-w-0 space-y-0.5">
                {multiItinLines.map((line, i) => (
                  <p key={i} className="text-sm text-foreground">
                    <span className="font-medium">{line}</span>
                  </p>
                ))}
              </div>
            ) : (
              <p className="min-w-0 text-sm text-foreground">
                <span className="font-medium">{title}</span>
                {dateSummary ? (
                  <>
                    <span className="font-medium text-muted"> · </span>
                    <span className="font-normal text-muted">{dateSummary}</span>
                  </>
                ) : null}
              </p>
            )}
            {objectOptions.length > 0 ? (
              <p className="shrink-0 text-xs text-muted sm:self-center">
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
                showExpandChevrons={showExpandChevrons}
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
                    showExpandChevrons={showExpandChevrons}
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

export function LegFlightsBlock({
  flights,
  legIndex,
  onReorderFlightOptions,
  showExpandChevrons = false,
}: {
  flights: unknown[];
  legIndex: number;
  onReorderFlightOptions?: (flightIndex: number, newOptions: unknown[]) => void;
  showExpandChevrons?: boolean;
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
            showExpandChevrons={showExpandChevrons}
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
