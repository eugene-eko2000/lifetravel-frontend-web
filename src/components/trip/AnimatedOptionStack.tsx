"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

const DURATION_MS = 220;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

type Point = { top: number; left: number };

/**
 * FLIP layout animation for a vertical stack of option cards. When `orderKey`
 * changes after a reorder, each row animates from its previous screen position.
 */
export function AnimatedOptionStack({
  orderKey,
  className = "flex flex-col gap-2",
  children,
}: {
  orderKey: string;
  className?: string;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef<Map<string, Point>>(new Map());
  const isFirstLayoutRef = useRef(true);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const els = [...root.querySelectorAll("[data-flip-id]")] as HTMLElement[];

    if (isFirstLayoutRef.current) {
      isFirstLayoutRef.current = false;
      for (const el of els) {
        const id = el.dataset.flipId;
        if (!id) continue;
        const r = el.getBoundingClientRect();
        positionsRef.current.set(id, { top: r.top, left: r.left });
      }
      return;
    }

    const toAnimate: HTMLElement[] = [];
    for (const el of els) {
      const id = el.dataset.flipId;
      if (!id) continue;
      const newRect = el.getBoundingClientRect();
      const prev = positionsRef.current.get(id);
      if (prev) {
        const dx = prev.left - newRect.left;
        const dy = prev.top - newRect.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          el.style.willChange = "transform";
          el.style.transition = "none";
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          toAnimate.push(el);
        }
      }
    }

    if (toAnimate.length === 0) {
      for (const el of els) {
        const id = el.dataset.flipId;
        if (!id) continue;
        const r = el.getBoundingClientRect();
        positionsRef.current.set(id, { top: r.top, left: r.left });
      }
      return;
    }

    void root.offsetHeight;
    for (const el of toAnimate) {
      el.style.transition = `transform ${DURATION_MS}ms ${EASE}`;
    }

    requestAnimationFrame(() => {
      for (const el of toAnimate) {
        el.style.transform = "translate(0, 0)";
      }
    });

    const t = window.setTimeout(() => {
      for (const el of els) {
        const id = el.dataset.flipId;
        if (!id) continue;
        el.style.transition = "";
        el.style.transform = "";
        el.style.willChange = "";
        const r = el.getBoundingClientRect();
        positionsRef.current.set(id, { top: r.top, left: r.left });
      }
    }, DURATION_MS + 40);

    return () => clearTimeout(t);
  }, [orderKey]);

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
