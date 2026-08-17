import { useEffect, useState, type RefObject } from "react";

import { applyFieldValues } from "~/lib/polaris-form";

/**
 * Seeds Polaris web-component fields with their stored values after mount.
 *
 * Required because React 18 sets JSX props on custom elements as attributes,
 * which Polaris fields ignore once upgraded — see applyFieldValues() for the
 * full explanation. Without this, a select silently shows its first option
 * instead of what is saved.
 *
 * Runs whenever `values` changes so a loader revalidation after a save is
 * reflected in the form.
 */
export function useFieldValues(
  containerRef: RefObject<HTMLElement | null>,
  values: Record<string, string | boolean | null | undefined>,
): void {
  // Values are compared by content rather than identity: callers build the
  // object inline on every render, so an identity check would run every time.
  const signature = JSON.stringify(values);

  useEffect(() => {
    if (!containerRef.current) return;
    applyFieldValues(containerRef.current, JSON.parse(signature));
  }, [containerRef, signature]);
}

/**
 * Tracks the current value of one named field, for progressive disclosure.
 *
 * Listens on the container in the capture phase rather than binding to the
 * field itself: Polaris fields are custom elements whose events React 18 does
 * not forward to `onChange` props, and capture-phase delegation also keeps
 * working when the field is conditionally rendered — which is the whole point
 * of asking for the value in the first place.
 */
export function useLiveFieldValue(
  containerRef: RefObject<HTMLElement | null>,
  name: string,
  initialValue: string,
): string {
  const [value, setValue] = useState(initialValue);

  useEffect(() => setValue(initialValue), [initialValue]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const handler = (event: Event) => {
      const target = event.target as (HTMLElement & { value?: string }) | null;
      if (!target?.getAttribute) return;
      if (target.getAttribute("name") !== name) return;
      setValue(target.value ?? "");
    };

    root.addEventListener("change", handler, true);
    root.addEventListener("input", handler, true);
    return () => {
      root.removeEventListener("change", handler, true);
      root.removeEventListener("input", handler, true);
    };
  }, [containerRef, name]);

  return value;
}

/**
 * Tracks whether one named checkbox is ticked, for gating an action on it.
 *
 * The checked counterpart of useLiveFieldValue, and capture-phase for the same
 * reason: React 18 does not forward a custom element's events to `onChange`.
 *
 * Unlike that hook this one listens to `change` ONLY, never `input`. Measured
 * against the real s-checkbox from Shopify's CDN, `input` fires first carrying
 * the value from *before* the toggle:
 *
 *   ticking    input -> checked false, then change -> checked true
 *   unticking  input -> checked true,  then change -> checked false
 *
 * Handling both happens to end on the right value only because change fires
 * second. Listening to change alone is correct rather than accidentally
 * correct. (For a text field `input` is the live value, which is why the value
 * hook does want it — the two are not interchangeable.)
 *
 * Polaris dispatches change on the host element, so it reaches a listener on
 * an ancestor even though change is composed: false and would not otherwise
 * escape a shadow root.
 */
export function useLiveFieldChecked(
  containerRef: RefObject<HTMLElement | null>,
  name: string,
  initialChecked = false,
): boolean {
  const [checked, setChecked] = useState(initialChecked);

  useEffect(() => setChecked(initialChecked), [initialChecked]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const handler = (event: Event) => {
      const target = event.target as
        | (HTMLElement & { checked?: boolean })
        | null;
      if (!target?.getAttribute) return;
      if (target.getAttribute("name") !== name) return;
      setChecked(Boolean(target.checked));
    };

    root.addEventListener("change", handler, true);
    return () => root.removeEventListener("change", handler, true);
  }, [containerRef, name]);

  return checked;
}
