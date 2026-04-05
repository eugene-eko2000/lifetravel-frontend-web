"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

/**
 * Wraps a fare/hotel option card for drag-and-drop reordering.
 * Drag is activated by press-and-hold (~250ms) then move; the whole card is the drag surface
 * so quick taps still reach inner controls (expand/collapse).
 */
export function SortableOptionRow({
  id,
  ariaLabel,
  children,
}: {
  id: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    transition: null,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        isDragging
          ? "opacity-60 cursor-grabbing touch-manipulation"
          : "cursor-grab touch-manipulation"
      }
      {...attributes}
      {...listeners}
      role="group"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}
