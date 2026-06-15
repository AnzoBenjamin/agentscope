"use client";

import { useEffect, useRef, useState } from "react";

export interface StreamEvent<T = Record<string, unknown>> {
  id: string;
  eventType: string;
  payload: T;
  createdAt: string;
  organizationId: string;
  resourceType?: string | null;
  resourceId?: string | null;
}

interface UseEventStreamOptions {
  organizationId: string;
  enabled?: boolean;
  onEvent?: (event: StreamEvent) => void;
  onError?: (error: Event) => void;
}

interface UseEventStreamResult {
  events: StreamEvent[];
  status: "idle" | "connecting" | "open" | "closed" | "error";
}

// No-op fallback used to keep `onEventRef.current` and `onErrorRef.current`
// always-callable, which lets the SSE listeners fire them without a
// `?.` optional chain (and without a "possibly undefined" type).
// The body is intentionally empty: the function exists only to provide a
// stable callable for the ref's initial value and for the `?? noop` fallback
// when the parent doesn't pass a callback.
// eslint-disable-next-line @typescript-eslint/no-empty-function
function noop() {}

/**
 * Subscribe to the AgentScope organization event stream via SSE.
 * Auto-reconnects on close with exponential backoff (capped at 30s).
 */
export function useEventStream(
  options: UseEventStreamOptions,
): UseEventStreamResult {
  const { organizationId, enabled = true, onEvent, onError } = options;
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [status, setStatus] = useState<UseEventStreamResult["status"]>("idle");
  // Type the refs as the non-undefined callable signature so the SSE
  // listeners can invoke `onEventRef.current(parsed)` / `onErrorRef.current(err)`
  // without a `?.` optional chain (which the lint rule flagged as
  // "unnecessary" because the chain is on a non-nullish value) and without
  // a "possibly undefined" typecheck error.
  const onEventRef = useRef<(event: StreamEvent) => void>(onEvent ?? noop);
  const onErrorRef = useRef<(error: Event) => void>(onError ?? noop);

  // Keep the latest callback in a ref so the SSE consumer inside useEffect
  // can fire it without re-running the connection effect on every render.
  useEffect(() => {
    onEventRef.current = onEvent ?? noop;
    onErrorRef.current = onError ?? noop;
  });

  useEffect(() => {
    if (!enabled || !organizationId) return;

    let source: EventSource | null = null;
    let backoff = 1000;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      setStatus("connecting");
      source = new EventSource(`/api/streams/${organizationId}`);

      source.addEventListener("ready", () => {
        backoff = 1000;
        setStatus("open");
      });

      source.addEventListener("stream", (evt) => {
        try {
          // `EventSource` message events carry their payload on `data` as a
          // JSON string. The generic `Event` type doesn't model `.data`, but
          // the lib types narrow `evt` to `MessageEvent` for the `"stream"`
          // (and any custom) listener, so we can read `data` directly and
          // only need the `as string` cast on the result (which is
          // `unknown` on `MessageEvent`).
          const data = evt.data as string;
          const parsed = JSON.parse(data) as StreamEvent;
          setEvents((prev) => [...prev.slice(-99), parsed]);
          onEventRef.current(parsed);
        } catch {
          // ignore parse errors
        }
      });

      source.addEventListener("error", (err) => {
        onErrorRef.current(err);
        setStatus("error");
        source?.close();
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 30_000);
        }
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
      setStatus("closed");
    };
  }, [organizationId, enabled]);

  return { events, status };
}
