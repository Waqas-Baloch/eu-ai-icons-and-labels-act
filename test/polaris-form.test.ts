import { describe, expect, it } from "vitest";

import { boolAttr } from "~/lib/polaris-form";

/**
 * The regression: `<s-button disabled={false}>` rendered `disabled="false"`,
 * which a custom element reads as disabled because HTML boolean attributes are
 * presence-based. Every primary button in the app was permanently unclickable,
 * showing its idle label the whole time.
 *
 * The contract that prevents it: false must become `undefined`, which React
 * omits entirely, and never `false`, which React stringifies.
 */
describe("boolAttr", () => {
  it("returns undefined for false, so React omits the attribute", () => {
    expect(boolAttr(false)).toBeUndefined();
  });

  it("returns true for true, so the attribute is present", () => {
    expect(boolAttr(true)).toBe(true);
  });

  it("never returns false, which React would render as disabled=\"false\"", () => {
    for (const input of [false, true, undefined]) {
      expect(boolAttr(input)).not.toBe(false);
    }
  });

  it("treats a missing value as absent", () => {
    expect(boolAttr(undefined)).toBeUndefined();
  });

  // The call sites pass expressions, not plain booleans:
  //   disabled={boolAttr(!confirmed || busy)}
  it("gates on a composed condition the way the call sites use it", () => {
    const gate = (confirmed: boolean, busy: boolean) =>
      boolAttr(!confirmed || busy);

    expect(gate(false, false)).toBe(true); // unticked  -> disabled
    expect(gate(true, false)).toBeUndefined(); // ticked -> clickable
    expect(gate(true, true)).toBe(true); // submitting  -> disabled
  });
});
