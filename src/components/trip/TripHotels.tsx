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
import { useMemo, useState } from "react";
import { DualPriceDisplay, formatHotelDualPriceParts } from "./tripDualPrice";
import { useTripCurrency, useTripLocationMaps } from "./TripCardContexts";
import type { UnknownRecord } from "./tripShared";
import {
  asIsoDate,
  DEFAULT_OPTION_CARD_CLASS,
  formatHotelCityLine,
  getHotelOptionSortableId,
  isObject,
  LEG_OPTION_PANEL_CLASS,
  pickArray,
  pickNumber,
  pickRecord,
  pickScalar,
  pickString,
  TOP_OPTION_CARD_CLASS,
} from "./tripShared";
import { formatFlightDateTime, toTitleCaseWords } from "./tripFlightFormatting";
import { SortableOptionRow } from "./SortableOptionRow";

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
  const tripCurrency = useTripCurrency();
  const maps = useTripLocationMaps();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const h = isObject(opt.hotel) ? (opt.hotel as UnknownRecord) : undefined;
  const name = h ? pickString(h, ["name", "chain", "brand"]) : undefined;
  const parentCity = pickString(parentStay, ["city_code", "city"]);
  const title = name ?? parentCity ?? `Hotel ${optionIndex + 1}`;

  const cityCode = h ? pickString(h, ["city_code", "cityCode", "city"]) : undefined;
  const hotelParts = formatHotelDualPriceParts(opt, tripCurrency, parentStay);

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

  const rawCity = cityCode ?? parentCity;
  const secondLineCity = rawCity ? formatHotelCityLine(rawCity, maps) : undefined;
  const hasSecondLine = secondLineCity || hotelParts;

  const detailId = `hotel-${parentHotelIndex}-opt-${optionIndex}`;
  const showDetailsPanel = offer != null;
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
        aria-controls={showDetailsPanel ? detailId : undefined}
        id={`${detailId}-summary`}
        className={`flex w-full min-w-0 touch-manipulation items-start gap-2 p-2.5 text-left transition-colors hover:bg-surface-hover/50 sm:p-3 ${
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
          className="border-t border-border bg-background/25 px-2.5 py-2.5 sm:px-3 sm:py-3"
        >
          <HotelStayDetailsPanel offer={offer} />
        </div>
      )}
      {detailsOpen && !showDetailsPanel && (
        <div
          id={detailId}
          role="region"
          aria-labelledby={`${detailId}-summary`}
          className="border-t border-border bg-background/25 px-2.5 py-2.5 sm:px-3 sm:py-3"
        >
          <p className="text-xs text-muted">No offer details available for this stay.</p>
        </div>
      )}
    </div>
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
  const maps = useTripLocationMaps();
  const cityCode = pickString(stay, ["city_code", "city"]);
  const options = pickArray(stay, ["options"]) ?? [];
  const objectOptions = options.filter(isObject) as UnknownRecord[];

  const title = cityCode
    ? `Hotels · ${formatHotelCityLine(cityCode, maps)}`
    : `Hotel ${labelIndex + 1}`;
  const canSortOptions = Boolean(onOptionsReorder) && objectOptions.length > 1;

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-border/80 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full min-w-0 touch-manipulation items-start gap-2 p-2.5 text-left transition-colors hover:bg-surface-hover/50 sm:p-3 ${
          open ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className="mt-0.5 w-4 shrink-0 text-center text-xs text-muted" aria-hidden>
          {open ? "▼" : "▶"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-2 sm:gap-y-1">
            <p className="min-w-0 text-sm font-medium text-foreground">{title}</p>
            {objectOptions.length > 1 ? (
              <p className="shrink-0 text-xs text-muted sm:self-center">{objectOptions.length} hotel options</p>
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
            <p className="pl-2.5 text-xs text-muted sm:pl-3">No hotel options listed.</p>
          )}
        </div>
      )}
    </div>
  );
}
export function LegHotelsBlock({
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
