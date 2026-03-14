"use client";

import { useState, useCallback } from "react";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function primitiveLabel(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function primitiveClassName(value: unknown): string {
  if (value === null || value === undefined) return "text-muted";
  if (typeof value === "string") return "text-green-700 dark:text-green-400";
  if (typeof value === "number") return "text-blue-600 dark:text-blue-400";
  if (typeof value === "boolean") return "text-orange-600 dark:text-orange-400";
  return "text-foreground";
}

interface JsonViewerNodeProps {
  data: unknown;
  path: string;
  depth: number;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  label?: string;
}

function JsonViewerNode({
  data,
  path,
  depth,
  expandedPaths,
  onToggle,
  label,
}: JsonViewerNodeProps) {
  const expanded = expandedPaths.has(path);
  const toggle = useCallback(() => onToggle(path), [path, onToggle]);

  if (isArray(data)) {
    const isEmpty = data.length === 0;
    const bracket = isEmpty ? "[]" : expanded ? "[" : "[ … ]";
    return (
      <div className="flex flex-col text-sm">
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5 rounded px-0.5 -mx-0.5 py-0.5"
          aria-expanded={expanded}
        >
          <span className="text-muted select-none w-4 shrink-0" aria-hidden>
            {isEmpty ? "  " : expanded ? "▼" : "▶"}
          </span>
          {label != null && (
            <span className="text-purple-600 dark:text-purple-400 font-medium">{label}:</span>
          )}
          <span className="text-foreground">{bracket}</span>
          {!isEmpty && !expanded && (
            <span className="text-muted text-xs">({data.length} items)</span>
          )}
        </button>
        {expanded && !isEmpty && (
          <div className="pl-4 border-l border-border ml-2 mt-0.5 space-y-0.5">
            {data.map((item, i) => (
              <JsonViewerNode
                key={`${path}-${i}`}
                data={item}
                path={`${path}.${i}`}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                label={String(i)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (isObject(data)) {
    const keys = Object.keys(data);
    const isEmpty = keys.length === 0;
    const bracket = isEmpty ? "{}" : expanded ? "{" : "{ … }";
    return (
      <div className="flex flex-col text-sm">
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5 rounded px-0.5 -mx-0.5 py-0.5"
          aria-expanded={expanded}
        >
          <span className="text-muted select-none w-4 shrink-0" aria-hidden>
            {isEmpty ? "  " : expanded ? "▼" : "▶"}
          </span>
          {label != null && (
            <span className="text-purple-600 dark:text-purple-400 font-medium">{label}:</span>
          )}
          <span className="text-foreground">{bracket}</span>
          {!isEmpty && !expanded && (
            <span className="text-muted text-xs">({keys.length} keys)</span>
          )}
        </button>
        {expanded && !isEmpty && (
          <div className="pl-4 border-l border-border ml-2 mt-0.5 space-y-0.5">
            {keys.map((key) => (
              <JsonViewerNode
                key={`${path}.${key}`}
                data={data[key]}
                path={`${path}.${key}`}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                label={key}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-1.5 text-sm py-0.5">
      {label != null && (
        <span className="text-purple-600 dark:text-purple-400 font-medium shrink-0">
          {label}:
        </span>
      )}
      <span className={primitiveClassName(data)}>{primitiveLabel(data)}</span>
    </div>
  );
}

interface JsonViewerProps {
  data: unknown;
  defaultExpanded?: boolean;
  className?: string;
}

export function JsonViewer({ data, defaultExpanded = true, className = "" }: JsonViewerProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    defaultExpanded ? new Set(["root"]) : new Set()
  );

  const onToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <div className={`font-mono text-xs overflow-x-auto ${className}`}>
      <JsonViewerNode
        data={data}
        path="root"
        depth={0}
        expandedPaths={expandedPaths}
        onToggle={onToggle}
      />
    </div>
  );
}
