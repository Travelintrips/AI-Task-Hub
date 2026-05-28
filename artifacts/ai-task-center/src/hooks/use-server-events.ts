import { useEffect, useRef } from "react";

export type SseEventHandler = (data: Record<string, unknown>) => void;

/**
 * Subscribes to the server-sent events stream at /api/events.
 * Automatically reconnects on disconnect (native EventSource behaviour).
 *
 * @param handlers  Map of SSE event name → callback.
 * @param companyId Optional company filter sent as query param.
 */
export function useServerEvents(
  handlers: Record<string, SseEventHandler>,
  companyId = "default",
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const url  = `${base}/api/events?companyId=${encodeURIComponent(companyId)}`;

    let es: EventSource;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource(url);

      es.onopen = () => {
        console.debug("[SSE] connected to", url);
      };

      es.onerror = () => {
        // EventSource reconnects automatically; log once
        console.debug("[SSE] connection lost — will reconnect");
      };

      // Attach named-event listeners dynamically
      for (const eventName of Object.keys(handlersRef.current)) {
        es.addEventListener(eventName, (e: Event) => {
          const msgEvent = e as MessageEvent<string>;
          try {
            const data = JSON.parse(msgEvent.data) as Record<string, unknown>;
            handlersRef.current[eventName]?.(data);
          } catch {
            console.warn("[SSE] failed to parse event data", msgEvent.data);
          }
        });
      }
    };

    connect();

    return () => {
      closed = true;
      es?.close();
    };
  }, [companyId]);
}
