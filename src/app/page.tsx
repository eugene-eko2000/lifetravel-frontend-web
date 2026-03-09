"use client";

import { useState, useRef, useEffect, useCallback, type FormEvent, type KeyboardEvent } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
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

const INGRESS_API = process.env.NEXT_PUBLIC_INGRESS_API ?? "ws://localhost:8080";

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

const formatJsonIfPossible = (content: string) => {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
};

const parseDebugMessage = (value: unknown, fallbackMessage: string): DebugMessage => {
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  ) {
    const data = value as Partial<DebugMessage>;
    return {
      id: typeof data.id === "string" ? data.id : undefined,
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

  return { message: fallbackMessage };
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

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [debugMessages, setDebugMessages] = useState<DebugEntry[]>([]);
  const [input, setInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [leftPaneWidthPercent, setLeftPaneWidthPercent] = useState(65);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const debugMessagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-scroll debug pane
  useEffect(() => {
    debugMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizingRef.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      if (!rect.width) return;
      const nextPercent = ((event.clientX - rect.left) / rect.width) * 100;
      const clampedPercent = Math.min(80, Math.max(25, nextPercent));
      setLeftPaneWidthPercent(clampedPercent);
    };

    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const sendMessage = useCallback(() => {
    const prompt = input.trim();
    if (!prompt || isConnecting || isStreaming) return;

    // Add user message
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsConnecting(true);

    // Create assistant placeholder for streaming response
    const assistantMessageId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
    };
    setMessages((prev) => [...prev, assistantMessage]);

    // Establish WebSocket connection
    const wsUrl = `${INGRESS_API}/api/v1/itinerary`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnecting(false);
      setIsStreaming(true);
      // Send request payload matching backend ItineraryRequest schema
      ws.send(
        JSON.stringify({
          id: null,
          prompt_id: null,
          content: prompt,
        })
      );
    };

    ws.onmessage = (event) => {
      const rawData = typeof event.data === "string" ? event.data : String(event.data);
      console.log("Itinerary websocket message:", rawData);
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
        const rawDebugPayload =
          typeof parsedData === "object" &&
          parsedData !== null &&
          "data" in parsedData
            ? (parsedData as { data: unknown }).data
            : parsedData;
        const mergedDebugPayload =
          typeof parsedData === "object" &&
          parsedData !== null &&
          typeof rawDebugPayload === "object" &&
          rawDebugPayload !== null
            ? { ...(parsedData as Record<string, unknown>), ...(rawDebugPayload as Record<string, unknown>) }
            : rawDebugPayload;
        const debugMessage = parseDebugMessage(mergedDebugPayload, rawData);
        setDebugMessages((prev) => [...prev, { id: crypto.randomUUID(), data: debugMessage }]);
        setIsStreaming(false);
        return;
      }

      const formattedData = formatJsonIfPossible(rawData);
      setIsStreaming(false);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content: msg.content ? `${msg.content}\n\n${formattedData}` : formattedData,
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
            ? { ...msg, content: msg.content || "⚠️ Connection error. Please try again." }
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

  const handleDividerMouseDown = () => {
    isResizingRef.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-center border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold text-foreground">LifeTravel Chat</h1>
      </header>

      {/* Messages Area */}
      <main ref={splitContainerRef} className="flex min-h-0 flex-1 overflow-hidden">
        <section
          className="flex min-h-0 flex-col border-r border-border"
          style={{ width: `${leftPaneWidthPercent}%` }}
        >
          <div className="shrink-0 border-b border-border px-4 py-2 text-sm font-medium text-muted">
            Itinerary
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
                  How can I help you today?
                </p>
              </div>
            ) : (
              <div className="px-4 py-6">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`mb-6 flex ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                        message.role === "user"
                          ? "bg-user-bubble text-foreground"
                          : "bg-assistant-bubble text-foreground"
                      }`}
                    >
                      {message.role === "assistant" && (
                        <div className="mb-1 flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                            AI
                          </div>
                          <span className="text-xs font-medium text-muted">Assistant</span>
                        </div>
                      )}
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">
                        {message.content}
                        {message.role === "assistant" &&
                          !message.content &&
                          (isConnecting || isStreaming) && (
                            <span className="inline-block animate-pulse">▊</span>
                          )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
          className="w-1 cursor-col-resize bg-border transition-colors hover:bg-muted"
          onMouseDown={handleDividerMouseDown}
        />

        <section className="flex min-h-0 min-w-[280px] flex-1 flex-col">
          <div className="shrink-0 border-b border-border px-4 py-2 text-sm font-medium text-muted">
            Debug
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-6">
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
            <div ref={debugMessagesEndRef} />
          </div>
        </section>
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
            placeholder="Message LifeTravel..."
            rows={1}
            className="max-h-48 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-foreground placeholder-muted outline-none"
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
        <p className="mt-2 text-center text-xs text-muted">
          Press Enter to send, Shift+Enter for a new line
        </p>
      </footer>
    </div>
  );
}
