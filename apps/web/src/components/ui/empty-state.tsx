import { Sunrise } from "lucide-react";

/** Quiet, reusable guidance, never styled as an error. */
export function EmptyState({
  title,
  description,
  compact = false,
}: {
  title: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={compact ? "empty-state empty-state--compact" : "empty-state"}
    >
      <Sunrise
        aria-hidden="true"
        className="empty-state__motif"
        size={28}
        strokeWidth={1.5}
      />
      <p className="empty-state__title">{title}</p>
      {description ? <p>{description}</p> : null}
    </div>
  );
}
