"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A controlled input value with debounced persistence. The local string state
 * is the source of truth for the input element; a stable `commit` function
 * fires `onCommit(parsedValue)` after the user stops typing for `delayMs`.
 *
 * Empty input and non-finite numeric values are dropped (no commit, no error
 * toast) so the user can clear a field mid-edit without the server rejecting
 * a partial value.
 *
 * Returns:
 *  - `value`: the local string state. Bind this to the input.
 *  - `setValue`: input change handler. Bind to `onChange` and to `onBlur`.
 *  - `flush()`: cancel the pending timer and commit immediately. Useful for
 *    explicit "Save" buttons or before-unload.
 */
export function useDebouncedInput(
  options: {
    initialValue?: string;
    delayMs?: number;
    onCommit: (value: number) => void;
  },
) {
  const { initialValue, delayMs = 400, onCommit } = options;
  // Seed local state from `initialValue` exactly once on the first render
  // via a lazy initializer. After the first render, the user owns the
  // value; subsequent `initialValue` changes (e.g. a refetch after a
  // successful mutation) are intentionally ignored to avoid clobbering
  // in-progress edits. The user may also legitimately clear the field
  // mid-edit; we don't want a later refetch to bring the value back.
  //
  // This replaces an earlier `useRef(seeded-from-prop)` + `useEffect` that
  // triggered the `react-hooks/set-state-in-effect` lint rule and had a
  // race: the effect runs after the first commit, so a user keystroke
  // arriving between render and effect would be clobbered. The lazy
  // initializer is evaluated synchronously during render, so there is no
  // window in which the parent state and the local state disagree.
  const [value, setValue] = useState<string>(() => initialValue ?? "");
  // Keep the latest `onCommit` in a ref so the effect doesn't need it as a
  // dependency (which would re-fire the debounce on every parent render).
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value.trim() === "") return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const timer = setTimeout(() => {
      onCommitRef.current(parsed);
    }, delayMs);
    timerRef.current = timer;
    return () => {
      clearTimeout(timer);
      timerRef.current = null;
    };
  }, [value, delayMs]);

  const flush = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (value.trim() === "") return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    onCommitRef.current(parsed);
  };

  return { value, setValue, flush };
}
