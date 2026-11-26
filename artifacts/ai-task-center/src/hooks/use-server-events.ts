import { useEffect, useRef, useState } from "react";
import { getStoredToken } from "@/lib/auth-api";

export type SseEventHandler = (data: Record<string, unknown>) => void;
export type SseConnectionState = "connecting" | "connected" | "disconnected";

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = "message";
  const data: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }

  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

/**
 * Authenticated SSE stream using fetch + ReadableStream so the JWT stays in
 * the Authorization header. Reconnects with bounded exponential backoff.
 */
export function useServerEvents(
  handlers: Record<string, SseEventHandler>,
  companyId = "default",
): SseConnectionState {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [state, setState] = useState<SseConnectionState>("connecting");

  useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const url = `${base}/api/events?companyId=${encodeURIComponent(companyId)}`;
    let stopped = false;
    let controller: AbortController | null = null;
    let retryMs = 1_000;

    const sleep = (ms: number) => new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });

    const connect = async () => {
      while (!stopped) {
        controller = new AbortController();
        const token = getStoredToken();
        setState((current) => current === "connected" ? current : "connecting");

        try {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "text/event-stream",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            cache: "no-store",
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            throw new Error(`SSE_HTTP_${response.status}`);
          }

          setState("connected");
          retryMs = 1_000;

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let boundary = buffer.search(/\r?\n\r?\n/);
            while (boundary >= 0) {
              const block = buffer.slice(0, boundary);
              const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
              buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
              const parsed = parseSseBlock(block);

              if (parsed) {
                try {
                  const data = JSON.parse(parsed.data) as Record<string, unknown>;
                  handlersRef.current[parsed.event]?.(data);
                } catch {
                  console.warn("[SSE] failed to parse event", parsed.event);
                }
              }

              boundary = buffer.search(/\r?\n\r?\n/);
            }
          }
        } catch (error) {
          if (stopped || controller.signal.aborted) break;
          console.debug("[SSE] disconnected", error);
        }

        if (stopped) break;
        setState("disconnected");
        await sleep(retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
      }
    };

    void connect();

    return () => {
      stopped = true;
      controller?.abort();
    };
  }, [companyId]);

  return state;
}
