/**
 * Reads values out of Polaris web-component fields.
 *
 * Polaris fields are custom elements. Some are form-associated and submit
 * natively; the published custom-elements manifest only flags that on a couple
 * of them, and React 18 does not forward custom-element events to `onChange`
 * props either. Rather than depend on either behaviour, forms in this app read
 * the live `.value` off each named element at submit time. That works whether
 * or not form association is present, and it keeps the fields uncontrolled so
 * there is no event plumbing to maintain.
 */

/**
 * Passes a boolean to a Polaris web component so that `false` means false.
 *
 * React 18 sets unknown JSX props on a custom element as attributes, and it
 * stringifies booleans on the way — so `disabled={false}` renders the attribute
 * `disabled="false"`. HTML boolean attributes are presence-based, so the
 * element reads that as disabled. The result is a button that can never be
 * clicked, showing its idle label the whole time.
 *
 * Returning `undefined` instead of `false` is what fixes it: React omits an
 * attribute whose value is `undefined`, for custom elements too. React 19
 * assigns properties and does not need this, but Remix v2 peers React 18.
 *
 * Use for every boolean prop on an `s-*` element — `disabled`, `checked`,
 * `loading`, `open`, `required`. Not for `aria-*`, which really are
 * string-valued and take "false" correctly.
 */
export function boolAttr(value: boolean | undefined): true | undefined {
  return value ? true : undefined;
}

export type FieldKind = "value" | "checked" | "values" | "radio";

export interface FieldSpec {
  name: string;
  kind?: FieldKind;
}

interface FieldElement extends HTMLElement {
  value?: string;
  checked?: boolean;
  values?: string[];
}

/**
 * Collects the named fields from a container into FormData.
 *
 * Unknown or missing fields are skipped rather than submitted empty, so a
 * conditionally rendered field does not clear a stored value by accident.
 */
export function collectFields(
  container: HTMLElement,
  fields: FieldSpec[],
): FormData {
  const data = new FormData();

  for (const field of fields) {
    // A radio group has one element per option, so the first match is not
    // necessarily the selected one — find the checked member instead.
    if (field.kind === "radio") {
      const checked = container.querySelector<FieldElement>(
        `input[type="radio"][name="${CSS.escape(field.name)}"]:checked`,
      );
      if (checked?.value) data.set(field.name, String(checked.value));
      continue;
    }

    const element = container.querySelector<FieldElement>(
      `[name="${CSS.escape(field.name)}"]`,
    );
    if (!element) continue;

    switch (field.kind ?? "value") {
      case "checked":
        // Mirrors how a native checkbox submits: present when on, absent when off.
        if (element.checked) data.set(field.name, "on");
        break;

      case "values": {
        const values = element.values ?? [];
        for (const value of values) data.append(field.name, value);
        break;
      }

      default: {
        const value = element.value;
        if (value !== undefined && value !== null && value !== "") {
          data.set(field.name, String(value));
        }
      }
    }
  }

  return data;
}

/**
 * Applies initial values to Polaris fields as DOM *properties*.
 *
 * This is not optional polish — without it, saved values do not appear.
 *
 * React 18 passes unknown JSX props to a custom element as attributes, and a
 * Polaris field only reads its `value` attribute during upgrade. Because the
 * `<s-option>` children are parsed after the attribute is seen, the select
 * cannot match the value and silently falls back to its first option. React 19
 * assigns properties instead and does not have this problem, but Remix v2 peers
 * React 18.
 *
 * The failure is dangerous rather than cosmetic: a merchant reopening a product
 * would see their recorded declaration displayed as the first option, and
 * saving would overwrite the real declaration with a value they never chose.
 * Assigning the property after mount is what makes the field reflect storage.
 */
export function applyFieldValues(
  container: HTMLElement,
  values: Record<string, string | boolean | null | undefined>,
): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;

    const element = container.querySelector<FieldElement>(
      `[name="${CSS.escape(name)}"]`,
    );
    if (!element) continue;

    if (typeof value === "boolean") {
      element.checked = value;
    } else {
      element.value = value;
    }
  }
}
