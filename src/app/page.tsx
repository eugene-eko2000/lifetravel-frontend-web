"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { JsonViewer } from "@/components/JsonViewer";
import { TripCard, looksLikeTrip } from "@/components/TripCard";

type TripBlock =
  | { type: "json"; data: unknown }
  | { type: "text"; data: string };

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Assistant-only: each websocket payload as a block (JSON or plain text) */
  blocks?: TripBlock[];
  /** Assistant-only: latest status text for current request */
  statusText?: string;
  /** Assistant-only: `structured_request.output.missing_info` from `type: "missing_info"` messages */
  missingInfoText?: string;
}

interface DebugMessage {
  id?: string;
  request_id?: string;
  message: string;
  source?: string;
  level?: "debug" | "info" | "warning" | "error";
  payload?: Record<string, unknown>;
}

interface DebugEntry {
  id: string;
  data: DebugMessage;
}

interface StatusMessage {
  id: string;
  message: string;
}

const INGRESS_API = process.env.NEXT_PUBLIC_INGRESS_API ?? "ws://localhost:8080";

const TRIP_PAGE_SIZE = 10;

const TRIP_MODAL_COPY_KEY = "trip-modal";

/** Viewports below Tailwind `md` use a horizontal splitter (trip above, debug below). */
const MOBILE_DEBUG_SPLIT_QUERY = "(max-width: 767px)";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** True when `<main>` is column-stacked (trip above debug); must match CSS `flex-col md:flex-row`. */
function isSplitStackedLayout(main: HTMLElement): boolean {
  const dir = getComputedStyle(main).flexDirection;
  return dir === "column" || dir === "column-reverse";
}

/** Trip pane size along the split axis (25–80%). Stacked layout uses vertical pointer movement. */
function getSplitPercentFromPointer(main: HTMLElement, event: PointerEvent): number | null {
  const rect = main.getBoundingClientRect();
  const stacked = isSplitStackedLayout(main);
  let nextPercent: number;
  if (stacked) {
    if (!rect.height) return null;
    nextPercent = ((event.clientY - rect.top) / rect.height) * 100;
  } else {
    if (!rect.width) return null;
    nextPercent = ((event.clientX - rect.left) / rect.width) * 100;
  }
  return Math.min(80, Math.max(25, nextPercent));
}

function TripModal({
  data,
  mountKey,
  onClose,
  isDebugPanelOpen,
  copyJsonToClipboard,
  copiedBlockKey,
}: {
  data: unknown;
  mountKey: number;
  onClose: () => void;
  isDebugPanelOpen: boolean;
  copyJsonToClipboard: (data: unknown, blockKey: string) => void;
  copiedBlockKey: string | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-modal-title"
        className="relative flex max-h-[min(90vh,900px)] w-full max-w-[min(95vw,96rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 pr-12">
          <h2 id="trip-modal-title" className="text-sm font-semibold text-foreground">
            Trip
          </h2>
          {isDebugPanelOpen && (
            <button
              type="button"
              onClick={() => copyJsonToClipboard(data, TRIP_MODAL_COPY_KEY)}
              className="text-xs font-medium text-muted hover:text-foreground transition-colors"
            >
              {copiedBlockKey === TRIP_MODAL_COPY_KEY ? "Copied!" : "Copy"}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-[6px] z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm transition-colors hover:bg-surface-hover"
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-4 w-4"
            aria-hidden
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TripCard key={mountKey} data={data} />
        </div>
      </div>
    </div>,
    document.body
  );
}

function AssistantMessageBlocks({
  message,
  copiedBlockKey,
  copyJsonToClipboard,
  isConnecting,
  isStreaming,
  isDebugPanelOpen,
  onOpenTripModal,
}: {
  message: Message;
  copiedBlockKey: string | null;
  copyJsonToClipboard: (data: unknown, blockKey: string) => void;
  isConnecting: boolean;
  isStreaming: boolean;
  isDebugPanelOpen: boolean;
  onOpenTripModal: (data: unknown) => void;
}) {
  const blocks = message.blocks ?? [];
  const tripIndices = useMemo(() => {
    const out: number[] = [];
    blocks.forEach((b, i) => {
      if (b.type === "json" && looksLikeTrip(b.data)) out.push(i);
    });
    return out;
  }, [blocks]);
  const tripCount = tripIndices.length;

  const [visibleTripCount, setVisibleTripCount] = useState(TRIP_PAGE_SIZE);

  useEffect(() => {
    setVisibleTripCount(TRIP_PAGE_SIZE);
  }, [message.id]);

  const visibleTripBlockIndices = useMemo(
    () => new Set(tripIndices.slice(0, visibleTripCount)),
    [tripIndices, visibleTripCount]
  );

  const hiddenTripCount = Math.max(0, tripCount - visibleTripCount);
  const canShowMore = hiddenTripCount > 0;

  const renderJsonBlock = (i: number): ReactNode => {
    const block = blocks[i];
    if (block.type !== "json") return null;
    if (looksLikeTrip(block.data) && !visibleTripBlockIndices.has(i)) {
      return null;
    }
    const isTrip = looksLikeTrip(block.data);
    const copyBar =
      (!isTrip || isDebugPanelOpen) && (
        <div
          className="flex items-center justify-end gap-2 border-b border-border px-2 py-1.5"
          onClick={isTrip ? (e) => e.stopPropagation() : undefined}
        >
          <button
            type="button"
            onClick={() => copyJsonToClipboard(block.data, `${message.id}-${i}`)}
            className="text-xs font-medium text-muted hover:text-foreground transition-colors"
          >
            {copiedBlockKey === `${message.id}-${i}` ? "Copied!" : "Copy"}
          </button>
        </div>
      );

    if (isTrip) {
      return (
        <div
          key={i}
          role="button"
          tabIndex={0}
          onClick={() => onOpenTripModal(block.data)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenTripModal(block.data);
            }
          }}
          className="min-w-0 cursor-pointer rounded-lg border border-border bg-background/50 text-left overflow-x-auto outline-none transition-colors hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-border"
          aria-label="Open trip in modal"
        >
          {copyBar}
          <div className="pointer-events-none p-3">
            <TripCard data={block.data} />
          </div>
        </div>
      );
    }

    return (
      <div
        key={i}
        className="min-w-0 rounded-lg border border-border bg-background/50 overflow-x-auto"
      >
        {copyBar}
        <div className="p-3">
          <JsonViewer data={block.data} defaultExpanded={true} />
        </div>
      </div>
    );
  };

  const renderedBlocks: ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === "json" && looksLikeTrip(b.data)) {
      const runStart = i;
      const runIndices: number[] = [];
      while (i < blocks.length && blocks[i].type === "json" && looksLikeTrip(blocks[i].data)) {
        runIndices.push(i);
        i++;
      }
      renderedBlocks.push(
        <div
          key={`trip-grid-${runStart}`}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 min-w-0"
        >
          {runIndices.map((idx) => renderJsonBlock(idx))}
        </div>
      );
    } else if (b.type === "json") {
      renderedBlocks.push(renderJsonBlock(i));
      i++;
    } else {
      renderedBlocks.push(
        <pre
          key={i}
          className="whitespace-pre-wrap rounded-lg border border-border bg-background/50 p-3 text-xs"
        >
          {b.data}
        </pre>
      );
      i++;
    }
  }

  return (
    <>
      {renderedBlocks}
      {canShowMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => setVisibleTripCount((c) => c + TRIP_PAGE_SIZE)}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            Show more… ({hiddenTripCount} more)
          </button>
        </div>
      )}
      {(isConnecting || isStreaming) && <span className="inline-block animate-pulse">▊</span>}
    </>
  );
}

const normalizeDebugLevel = (value: unknown): DebugMessage["level"] => {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warning" ||
    normalized === "error"
  ) {
    return normalized;
  }
  if (normalized === "warn") return "warning";
  return undefined;
};

const parseDebugMessage = (
  value: unknown,
  fallbackMessage: string,
  fallbackId?: string
): DebugMessage => {
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  ) {
    const data = value as Partial<DebugMessage>;
    return {
      id: typeof data.id === "string" ? data.id : fallbackId,
      request_id: typeof data.request_id === "string" ? data.request_id : undefined,
      message: data.message as string,
      source: typeof data.source === "string" ? data.source : undefined,
      level: normalizeDebugLevel(data.level),
      payload:
        data.payload && typeof data.payload === "object"
          ? (data.payload as Record<string, unknown>)
          : undefined,
    };
  }

  if (typeof value === "string") {
    return { id: fallbackId, message: value };
  }

  return { id: fallbackId, message: fallbackMessage };
};

const getDebugLevelColor = (level?: DebugMessage["level"]) => {
  switch (level) {
    case "debug":
      return "#9ca3af";
    case "warning":
      return "#facc15";
    case "error":
      return "#ef4444";
    case "info":
    default:
      return undefined;
  }
};

/** If the user is within this many px of the bottom, treat as "following" new messages. */
const DEBUG_SCROLL_BOTTOM_THRESHOLD_PX = 80;

const isStatusMessage = (value: unknown): value is StatusMessage => {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "message" in value &&
    typeof (value as { id: unknown }).id === "string" &&
    typeof (value as { message: unknown }).message === "string"
  );
};

/** Reads `structured_request.output.missing_info` from a `missing_info` websocket payload. */
function extractMissingInfoText(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const root = payload as Record<string, unknown>;
  const sr = root.structured_request;
  if (typeof sr !== "object" || sr === null) return undefined;
  const output = (sr as Record<string, unknown>).output;
  if (typeof output !== "object" || output === null) return undefined;
  const mi = (output as Record<string, unknown>).missing_info;
  if (typeof mi === "string") return mi;
  if (mi != null && typeof mi === "object") return JSON.stringify(mi, null, 2);
  if (mi != null) return String(mi);
  return undefined;
}

/** Reads `prompt_id` from trip payloads (root or nested under ranked_trip / trip / legacy ranked_itinerary / itinerary / data / ranked). */
function extractPromptIdFromTripPayload(value: unknown): string | undefined {
  const fromObject = (obj: Record<string, unknown>): string | undefined => {
    const raw = obj.prompt_id;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
    return undefined;
  };
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const direct = fromObject(o);
    if (direct) return direct;
    const nested =
      o.ranked_trip ?? o.trip ?? o.ranked_itinerary ?? o.itinerary ?? o.data ?? o.ranked;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return fromObject(nested as Record<string, unknown>);
    }
  }
  return undefined;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [debugMessages, setDebugMessages] = useState<DebugEntry[]>([]);
  const [input, setInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [leftPaneWidthPercent, setLeftPaneWidthPercent] = useState(65);
  const [isDebugPanelOpen, setIsDebugPanelOpen] = useState(false);
  const lastLeftPaneWidthPercentRef = useRef(leftPaneWidthPercent);
  /** Sentinel for optional scroll anchoring; not used for auto-scroll on trip updates. */
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const debugPanelScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  /** Last `prompt_id` from a trip JSON payload; sent on the next request. */
  const lastPromptIdRef = useRef<string | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const isMobileDebugSplit = useMediaQuery(MOBILE_DEBUG_SPLIT_QUERY);
  const [copiedBlockKey, setCopiedBlockKey] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [tripModal, setTripModal] = useState<{ data: unknown; mountKey: number } | null>(null);

  const openTripModal = useCallback((data: unknown) => {
    setTripModal((prev) => ({
      data,
      mountKey: (prev?.mountKey ?? 0) + 1,
    }));
  }, []);

  const copyJsonToClipboard = useCallback((data: unknown, blockKey: string) => {
    const text = JSON.stringify(data, null, 2);
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedBlockKey(blockKey);
      setTimeout(() => setCopiedBlockKey(null), 2000);
    });
  }, []);

  const copyPromptToClipboard = useCallback((text: string, promptId: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedPromptId(promptId);
      setTimeout(() => setCopiedPromptId(null), 2000);
    });
  }, []);

  // Auto-scroll debug pane only when the user is already near the bottom (not reading older lines)
  useEffect(() => {
    const el = debugPanelScrollRef.current;
    if (!el || debugMessages.length === 0) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    if (distanceFromBottom <= DEBUG_SCROLL_BOTTOM_THRESHOLD_PX) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [debugMessages]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!isResizingRef.current || !splitContainerRef.current) return;
      const next = getSplitPercentFromPointer(splitContainerRef.current, event);
      if (next === null) return;
      setLeftPaneWidthPercent(next);
    };

    const endResize = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endResize);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endResize);
      window.removeEventListener("pointercancel", endResize);
    };
  }, []);

  const sendMessage = useCallback(() => {
    const prompt = input.trim();
    if (!prompt || isConnecting || isStreaming) return;

    const continuingSamePromptId = lastPromptIdRef.current != null;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
    };
    const assistantMessageId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      blocks: [],
      statusText: undefined,
      missingInfoText: undefined,
    };

    if (continuingSamePromptId) {
      setMessages((prev) => {
        const promptsOnly = prev.filter((m) => m.role === "user");
        return [...promptsOnly, userMessage, assistantMessage];
      });
    } else {
      setDebugMessages([]);
      setMessages([userMessage, assistantMessage]);
    }

    setInput("");
    setIsConnecting(true);

    // Establish WebSocket connection
    const wsUrl = `${INGRESS_API}/api/v1/trip`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnecting(false);
      setIsStreaming(true);
      // Send request payload matching backend trip request schema
      ws.send(
        JSON.stringify({
          id: null,
          prompt_id: lastPromptIdRef.current,
          content: prompt,
        })
      );
    };

    ws.onmessage = (event) => {
      const rawData = typeof event.data === "string" ? event.data : String(event.data);
      console.log("Trip websocket message:", rawData);
      let parsedData: unknown = null;
      try {
        parsedData = JSON.parse(rawData);
      } catch {
        parsedData = null;
      }

      const messageType =
        typeof parsedData === "object" &&
        parsedData !== null &&
        "type" in parsedData &&
        typeof (parsedData as { type: unknown }).type === "string"
          ? (parsedData as { type: string }).type
          : undefined;

      if (messageType === "debug") {
        const debugEnvelope =
          typeof parsedData === "object" && parsedData !== null
            ? (parsedData as Record<string, unknown>)
            : null;
        const envelopeId = typeof debugEnvelope?.id === "string" ? debugEnvelope.id : undefined;
        const rawDebugPayload =
          typeof parsedData === "object" &&
          parsedData !== null &&
          "debug_message" in parsedData
            ? (parsedData as { debug_message: unknown }).debug_message
            : parsedData;
        const mergedDebugPayload =
          debugEnvelope !== null &&
          typeof rawDebugPayload === "object" &&
          rawDebugPayload !== null
            ? { ...debugEnvelope, ...(rawDebugPayload as Record<string, unknown>) }
            : rawDebugPayload;
        const debugMessage = parseDebugMessage(mergedDebugPayload, rawData, envelopeId);
        setDebugMessages((prev) => [...prev, { id: crypto.randomUUID(), data: debugMessage }]);
        setIsStreaming(false);
        return;
      }

      const isTypedStatus = messageType === "status";
      if (isTypedStatus || isStatusMessage(parsedData)) {
        const statusMessage = parsedData as StatusMessage;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  statusText: statusMessage.message,
                }
              : msg
          )
        );
        setIsStreaming(false);
        return;
      }

      if (messageType === "missing_info") {
        const missingText = extractMissingInfoText(parsedData) ?? "";
        if (parsedData !== null) {
          const pid = extractPromptIdFromTripPayload(parsedData);
          if (pid !== undefined) lastPromptIdRef.current = pid;
        }
        setIsStreaming(false);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  missingInfoText: missingText,
                  statusText: undefined,
                }
              : msg
          )
        );
        return;
      }

      const newBlock: TripBlock =
        parsedData !== null
          ? { type: "json", data: parsedData }
          : { type: "text", data: rawData };
      if (parsedData !== null) {
        const pid = extractPromptIdFromTripPayload(parsedData);
        if (pid !== undefined) lastPromptIdRef.current = pid;
      }
      setIsStreaming(false);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                blocks: [...(msg.blocks ?? []), newBlock],
                statusText: undefined,
              }
            : msg
        )
      );
    };

    ws.onerror = () => {
      setIsConnecting(false);
      setIsStreaming(false);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                blocks: [
                  ...(msg.blocks ?? []),
                  { type: "text" as const, data: "⚠️ Connection error. Please try again." },
                ],
              }
            : msg
        )
      );
      wsRef.current = null;
    };

    ws.onclose = () => {
      setIsConnecting(false);
      setIsStreaming(false);
      wsRef.current = null;
    };
  }, [input, isConnecting, isStreaming]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDebugPanelOpen) return;
    const main = splitContainerRef.current;
    const stacked = main ? isSplitStackedLayout(main) : isMobileDebugSplit;
    isResizingRef.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = stacked ? "row-resize" : "col-resize";
    // Avoid scrolling the pane while dragging the splitter (touch / trackpads).
    e.preventDefault();
  };

  const toggleDebugPanel = () => {
    setIsDebugPanelOpen((prev) => {
      if (prev) {
        lastLeftPaneWidthPercentRef.current = leftPaneWidthPercent;
        return false;
      }
      setLeftPaneWidthPercent(lastLeftPaneWidthPercentRef.current || 65);
      return true;
    });
  };

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-center border-b border-border px-4 py-3 relative">
        <h1 className="text-lg font-semibold text-foreground">LifeTravel Chat</h1>
        <div className="absolute right-4 flex items-center gap-2">
          <button
            type="button"
            onClick={toggleDebugPanel}
            className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-hover transition-colors"
          >
            {isDebugPanelOpen ? "Hide debug" : "Show debug"}
          </button>
        </div>
      </header>

      {/* Messages Area — below `md`, debug uses a horizontal split (stacked panes); `md+` keeps left/right. */}
      <main
        ref={splitContainerRef}
        className={`flex min-h-0 flex-1 overflow-hidden ${
          isDebugPanelOpen ? "flex-col md:flex-row" : ""
        }`}
      >
        <section
          className={`flex min-h-0 flex-col ${
            isDebugPanelOpen
              ? isMobileDebugSplit
                ? "shrink-0 border-b border-border md:border-b-0 md:border-r"
                : "border-r border-border"
              : ""
          }`}
          style={
            isDebugPanelOpen
              ? isMobileDebugSplit
                ? { width: "100%", height: `${leftPaneWidthPercent}%`, minHeight: 0 }
                : { width: `${leftPaneWidthPercent}%`, minWidth: 0 }
              : { width: "100%" }
          }
        >
          <div className="shrink-0 border-b border-border px-4 py-2 text-sm font-medium text-muted">
            Trip
          </div>
          <div className="flex-1 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-8 w-8 text-muted"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p className="text-center text-lg text-muted">
                  Hi, I&apos;m your personal travel assistant.
                </p>
              </div>
            ) : (
              <div className="px-4 py-6">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`mb-6 flex ${
                      message.role === "assistant" ? "justify-center" : "justify-start"
                    }`}
                  >
                    <div
                      className={`rounded-2xl px-4 py-3 ${
                        message.role === "user"
                          ? "max-w-[85%] bg-user-bubble text-foreground"
                          : "w-full max-w-[95%] bg-assistant-bubble text-foreground"
                      }`}
                    >
                      <div className="text-sm leading-relaxed space-y-3">
                        {message.role === "user" && (
                          <div className="text-left">
                            <div className="mb-1 flex items-center justify-end">
                              <button
                                type="button"
                                onClick={() => copyPromptToClipboard(message.content, message.id)}
                                className="text-xs font-medium text-muted hover:text-foreground transition-colors"
                              >
                                {copiedPromptId === message.id ? "Copied!" : "Copy"}
                              </button>
                            </div>
                            <span className="whitespace-pre-wrap">{message.content}</span>
                          </div>
                        )}
                        {message.role === "assistant" && message.blocks && message.blocks.length > 0 && (
                          <AssistantMessageBlocks
                            message={message}
                            copiedBlockKey={copiedBlockKey}
                            copyJsonToClipboard={copyJsonToClipboard}
                            isConnecting={isConnecting}
                            isStreaming={isStreaming}
                            isDebugPanelOpen={isDebugPanelOpen}
                            onOpenTripModal={openTripModal}
                          />
                        )}
                        {message.role === "assistant" &&
                          message.missingInfoText !== undefined &&
                          message.missingInfoText !== "" && (
                            <div
                              className="rounded-lg border border-border bg-background/50 p-3 text-left"
                              role="region"
                              aria-label="Missing information"
                            >
                              <p className="mb-2 text-xs font-medium text-muted">Missing information</p>
                              <div className="whitespace-pre-wrap text-sm text-foreground">
                                {message.missingInfoText}
                              </div>
                            </div>
                          )}
                        {message.role === "assistant" &&
                          (!message.blocks || message.blocks.length === 0) && (
                            <>
                              {message.content && (
                                <span className="whitespace-pre-wrap">{message.content}</span>
                              )}
                              {(isConnecting || isStreaming) &&
                                message.missingInfoText === undefined && (
                                  <span className="inline-block animate-pulse">▊</span>
                                )}
                            </>
                          )}
                        {message.role === "assistant" && message.statusText && (
                          <div className="rounded-lg border border-border bg-background/50 p-3 text-xs">
                            <div className="flex items-center gap-2">
                              <img
                                src="/status-send-icon.svg"
                                alt=""
                                className="h-5 w-5 shrink-0"
                              />
                              <span className="text-foreground">{message.statusText}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} className="h-0 w-full shrink-0" aria-hidden />
              </div>
            )}
          </div>
        </section>

        {isDebugPanelOpen && (
          <>
            <div
              role="separator"
              aria-orientation={isMobileDebugSplit ? "horizontal" : "vertical"}
              aria-label="Resize panes"
              className={`shrink-0 touch-none bg-border transition-colors hover:bg-muted ${
                isMobileDebugSplit
                  ? "h-1.5 w-full cursor-row-resize md:h-auto md:w-1 md:cursor-col-resize"
                  : "h-auto w-1 cursor-col-resize"
              }`}
              onPointerDown={handleDividerPointerDown}
            />

            <section className="flex min-h-0 min-w-0 flex-1 flex-col md:min-w-[280px]">
              <div className="shrink-0 border-b border-border px-4 py-2 text-sm font-medium text-muted">
                Debug
              </div>
              <div ref={debugPanelScrollRef} className="flex-1 overflow-y-auto px-4 py-6">
                {debugMessages.length === 0 ? (
                  <p className="text-sm text-muted">Waiting for debug messages...</p>
                ) : (
                  debugMessages.map((entry) => {
                    const correlationId = entry.data.id ?? entry.data.request_id;
                    const messageColor = getDebugLevelColor(entry.data.level);
                    return (
                      <div
                        key={entry.id}
                        className="mb-4 rounded-xl border border-border bg-surface p-3"
                      >
                        <p className="whitespace-pre-wrap text-sm" style={{ color: messageColor }}>
                          {entry.data.message}
                        </p>
                        {(entry.data.level || entry.data.source || correlationId) && (
                          <p className="mt-2 text-xs opacity-80">
                            {[entry.data.level, entry.data.source, correlationId]
                              .filter(Boolean)
                              .join(" • ")}
                          </p>
                        )}
                        {entry.data.payload && (
                          <pre
                            className="mt-2 whitespace-pre-wrap rounded-md bg-black/5 p-2 text-xs"
                            style={{ color: messageColor }}
                          >
                            {JSON.stringify(entry.data.payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </>
        )}
      </main>

      {/* Input Area */}
      <footer className="shrink-0 border-t border-border bg-background px-4 py-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl items-end gap-3 rounded-2xl border border-border bg-surface px-4 py-3 focus-within:border-muted transition-colors"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Please describe your travel plan in a free form..."
            rows={1}
            className="max-h-48 min-h-[24px] flex-1 resize-none bg-transparent text-left text-sm text-foreground placeholder-muted outline-none"
            disabled={isConnecting}
          />
          <button
            type="submit"
            disabled={!input.trim() || isConnecting || isStreaming}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600"
            aria-label="Send message"
          >
            <img
              src="/send-icon.svg"
              alt="Send"
              className="h-6 w-6"
            />
          </button>
        </form>
        {input.trim() ? (
          <p className="mx-auto mt-2 max-w-3xl text-left text-xs text-muted">
            Press Enter to send, Shift+Enter for a new line
          </p>
        ) : null}
      </footer>

      {tripModal != null && (
        <TripModal
          data={tripModal.data}
          mountKey={tripModal.mountKey}
          onClose={() => setTripModal(null)}
          isDebugPanelOpen={isDebugPanelOpen}
          copyJsonToClipboard={copyJsonToClipboard}
          copiedBlockKey={copiedBlockKey}
        />
      )}
    </div>
  );
}
