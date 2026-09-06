import { memo, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface Props<T> {
  items: T[];
  /** Estimated row height in px */
  rowHeight?: number;
  /** Extra rows above/below viewport */
  overscan?: number;
  className?: string;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Empty placeholder */
  empty?: ReactNode;
}

/**
 * Windowed list. Short lists render in full; longer lists use TanStack Virtual.
 */
export const VirtualList = memo(function VirtualList<T>({
  items,
  rowHeight = 56,
  overscan = 6,
  className,
  getKey,
  renderItem,
  empty,
}: Props<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const total = items.length;
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => rowHeight,
    overscan,
    enabled: total > 40,
  });

  if (total === 0) {
    return (
      <div className={className} ref={scrollerRef}>
        {empty}
      </div>
    );
  }

  if (total <= 40) {
    return (
      <div
        className={className}
        ref={scrollerRef}
        style={{ overflow: "auto", position: "relative" }}
      >
        {items.map((item, index) => (
          <div
            key={getKey(item, index)}
            style={{ minHeight: rowHeight, contentVisibility: "auto" }}
          >
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  return (
    <div
      className={className}
      ref={scrollerRef}
      style={{ overflow: "auto", position: "relative" }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualItems.map((row) => {
          const item = items[row.index]!;
          return (
            <div
              key={getKey(item, row.index)}
              data-index={row.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${row.start}px)`,
                minHeight: rowHeight,
              }}
            >
              {renderItem(item, row.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}) as <T>(props: Props<T>) => React.ReactElement;
