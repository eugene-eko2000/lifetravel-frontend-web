"use client";

import { useState, useRef, useEffect, useCallback, type FormEvent, type KeyboardEvent } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const INGRESS_API = process.env.NEXT_PUBLIC_INGRESS_API ?? "ws://localhost:8080";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    const wsUrl = `${INGRESS_API}/api/v1/prompt`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnecting(false);
      setIsStreaming(true);
      // Send the prompt
      ws.send(JSON.stringify({ prompt }));
    };

    ws.onmessage = (event) => {
      const data = event.data;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, content: msg.content + data }
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

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-center border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold text-foreground">LifeTravel Chat</h1>
      </header>

      {/* Messages Area */}
      <main className="flex-1 overflow-y-auto">
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
          <div className="mx-auto max-w-3xl px-4 py-6">
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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40 disabled:hover:bg-accent"
            aria-label="Send message"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4"
            >
              <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
            </svg>
          </button>
        </form>
        <p className="mt-2 text-center text-xs text-muted">
          Press Enter to send, Shift+Enter for a new line
        </p>
      </footer>
    </div>
  );
}
