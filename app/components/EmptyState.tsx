import type { ReactNode } from "react";

/** Subset of the Polaris icon set used by empty states. */
type EmptyStateIcon = "check-circle" | "search" | "info" | "alert-triangle" | "wand";

export interface EmptyStateProps {
  icon?: EmptyStateIcon;
  tone?: "neutral" | "success" | "info" | "warning" | "critical";
  heading: string;
  body: string;
  /** Optional second line, for the "what happens next" reassurance. */
  detail?: string;
  children?: ReactNode;
}

/**
 * Consistent empty state.
 *
 * Every empty state in this app answers the same two questions — why is this
 * empty, and what happens next — because in a compliance tool an empty screen
 * is ambiguous in a way that matters: the merchant cannot tell whether nothing
 * needs doing or nothing has run yet.
 */
export function EmptyState({
  icon = "check-circle",
  tone = "success",
  heading,
  body,
  detail,
  children,
}: EmptyStateProps) {
  return (
    <s-box padding="large">
      <s-stack direction="block" gap="base" alignItems="center">
        <s-badge tone={tone} icon={icon}>
          {heading}
        </s-badge>
        <s-paragraph>{body}</s-paragraph>
        {detail && (
          <s-paragraph>
            <s-text color="subdued">{detail}</s-text>
          </s-paragraph>
        )}
        {children}
      </s-stack>
    </s-box>
  );
}
