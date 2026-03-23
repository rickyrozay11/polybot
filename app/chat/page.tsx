"use client";

import { useChat } from "@ai-sdk/react";
import { useState, useEffect, useRef, useCallback, FormEvent } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Send, Bot, User, Loader2, Search, AlertCircle, RotateCcw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

export default function ChatPage() {
  const { messages, sendMessage, status, error } = useChat({
    api: "/api/chat",
  } as any);
  const [input, setInput] = useState("");
  const [emptyResponseDetected, setEmptyResponseDetected] = useState(false);
  const prevStatusRef = useRef(status);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, emptyResponseDetected]);

  // Detect when stream finishes but produced no visible text
  useEffect(() => {
    const wasLoading = prevStatusRef.current === "submitted" || prevStatusRef.current === "streaming";
    const isNowReady = status === "ready";
    prevStatusRef.current = status;

    if (wasLoading && isNowReady && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "assistant") {
        const textParts = lastMsg.parts?.filter((p: any) => p.type === "text") ?? [];
        const hasText = textParts.some((p: any) => p.text?.trim());
        const hasLegacy = typeof (lastMsg as any).content === "string" && (lastMsg as any).content.trim().length > 0;
        if (!hasText && !hasLegacy) {
          setEmptyResponseDetected(true);
          return;
        }
      }
    }

    // Clear the flag when user sends a new message (status goes to submitted)
    if (status === "submitted") {
      setEmptyResponseDetected(false);
    }
  }, [status, messages]);

  const isLoading = status === "submitted" || status === "streaming";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    setEmptyResponseDetected(false);
    sendMessage({ text });
  }

  const handleRetry = useCallback(() => {
    // Find the last user message and resend it
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        const textParts = messages[i].parts?.filter((p: any) => p.type === "text") ?? [];
        const userText = textParts.map((p: any) => p.text).join("") || (messages[i] as any).content || "";
        if (userText.trim()) {
          setEmptyResponseDetected(false);
          sendMessage({ text: userText.trim() });
          return;
        }
      }
    }
  }, [messages, sendMessage]);

  return (
    <div className="mx-auto max-w-5xl flex h-[calc(100vh-2rem)] flex-col gap-4">
      <h1 className="text-2xl font-bold shrink-0">Chat</h1>

      <Card className="flex flex-1 flex-col overflow-hidden">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Send a message to start chatting with Grok.
            </div>
          )}
          {messages.map((msg) => {
            // Get text parts and tool parts
            const textParts = msg.parts?.filter((p: any) => p.type === "text") ?? [];
            const toolParts = msg.parts?.filter((p: any) => p.type === "tool-invocation") ?? [];
            const hasText = textParts.some((p: any) => p.text?.trim());
            const hasToolCalls = toolParts.length > 0;
            const isLastMessage = msg.id === messages[messages.length - 1]?.id;

            // Check for legacy .content field
            const legacyContent = (msg as any).content;
            const hasLegacyContent = typeof legacyContent === "string" && legacyContent.trim().length > 0;

            // Only skip truly empty assistant messages that have NOTHING (no text, no tools, no content)
            // and are not the last message while loading
            if (msg.role === "assistant" && !hasText && !hasLegacyContent && !hasToolCalls) {
              if (!isLastMessage) return null;
              if (!isLoading) return null; // skip if done loading and truly empty (the retry banner handles this)
            }

            return (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-3",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {msg.role === "assistant" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[75%] rounded-lg px-4 py-2 text-sm",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground whitespace-pre-wrap"
                      : "bg-accent text-accent-foreground prose prose-invert prose-sm max-w-none"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <>
                      {/* Show each tool invocation with its status */}
                      {hasToolCalls && toolParts.map((tp: any, idx: number) => {
                        const toolName = tp.toolInvocation?.toolName ?? tp.name ?? "tool";
                        const state = tp.toolInvocation?.state ?? tp.state ?? "calling";
                        const isRunning = state === "call" || state === "partial-call";
                        const displayName = toolName.replace(/_/g, " ").replace(/^get /, "");

                        return (
                          <div key={idx} className="flex items-center gap-2 text-muted-foreground mb-1.5">
                            {isRunning ? (
                              <Search className="h-3.5 w-3.5 animate-pulse" />
                            ) : (
                              <Search className="h-3.5 w-3.5" />
                            )}
                            <span className="text-xs">
                              {isRunning ? `Fetching ${displayName}...` : `Fetched ${displayName}`}
                            </span>
                          </div>
                        );
                      })}

                      {/* Separator between tools and text */}
                      {hasToolCalls && hasText && (
                        <div className="border-b border-border/50 mb-2 pb-0.5" />
                      )}

                      {/* Render text parts */}
                      {hasText ? (
                        textParts
                          .filter((p: any) => p.text?.trim())
                          .map((p: any, i: number) => (
                            <Streamdown
                              key={i}
                              mode={
                                status === "streaming" &&
                                isLastMessage &&
                                i === textParts.filter((x: any) => x.text?.trim()).length - 1
                                  ? "streaming"
                                  : "static"
                              }
                            >
                              {p.text}
                            </Streamdown>
                          ))
                      ) : hasLegacyContent ? (
                        <Streamdown
                          mode={
                            status === "streaming" && isLastMessage
                              ? "streaming"
                              : "static"
                          }
                        >
                          {legacyContent}
                        </Streamdown>
                      ) : null}

                      {/* Thinking indicator for completely empty last message while loading */}
                      {isLastMessage && isLoading && !hasText && !hasLegacyContent && !hasToolCalls && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span className="text-xs">Thinking...</span>
                        </div>
                      )}
                    </>
                  ) : (
                    // User message
                    msg.parts
                      ?.filter((p: any) => p.type === "text")
                      .map((p: any, i: number) => (
                        <span key={i}>{p.text}</span>
                      )) ?? legacyContent ?? ""
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Error from useChat */}
          {error && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/20">
                <AlertCircle className="h-4 w-4 text-destructive" />
              </div>
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-2 text-sm text-destructive">
                <p className="font-medium">Failed to get a response</p>
                <p className="text-xs mt-1 opacity-80">{error.message || "Connection to Grok was interrupted."}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 text-xs h-7 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={handleRetry}
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </Button>
              </div>
            </div>
          )}

          {/* Empty response detection — Grok called tools but never sent text */}
          {emptyResponseDetected && !error && !isLoading && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-500/20">
                <AlertCircle className="h-4 w-4 text-yellow-500" />
              </div>
              <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-4 py-2 text-sm text-yellow-200">
                <p className="font-medium">Response didn't come through</p>
                <p className="text-xs mt-1 opacity-80">Grok fetched the data but the response was cut off. This happens occasionally with streaming.</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 text-xs h-7 gap-1.5 border-yellow-500/30 text-yellow-200 hover:bg-yellow-500/10"
                  onClick={handleRetry}
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </Button>
              </div>
            </div>
          )}

          {/* Initial thinking indicator */}
          {status === "submitted" && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking...
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={onSubmit} className="flex items-center gap-2 border-t p-4">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about Polymarket..."
            className="flex-1 rounded-md border bg-background px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <Button type="submit" size="sm" disabled={!input.trim() || isLoading}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </Card>
    </div>
  );
}
