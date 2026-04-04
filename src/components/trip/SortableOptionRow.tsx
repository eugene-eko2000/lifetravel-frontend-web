"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

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
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-60" : undefined}>
      <div className="flex items-start gap-1">
        <button
          type="button"
          className="mt-1.5 shrink-0 inline-flex h-8 w-6 items-center justify-center rounded text-muted hover:bg-surface-hover hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
          aria-label={ariaLabel}
          {...listeners}
          {...attributes}
        >
          <span aria-hidden className="select-none text-sm leading-none">
            ⋮⋮
          </span>
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
