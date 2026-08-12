import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
 * Lightweight windowed list — no extra deps.
 * Good enough for hundreds of chat sessions.
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
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 400);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rafScroll = useRef<number | null>(null);
  const onScroll = useCallback(() => {
    if (rafScroll.current != null) return;
    rafScroll.current = requestAnimationFrame(() => {
      rafScroll.current = null;
      const el = scrollerRef.current;
      if (!el) return;
      setScrollTop(el.scrollTop);
    });
  }, []);
  useEffect(() => {
    return () => {
      if (rafScroll.current != null) cancelAnimationFrame(rafScroll.current);
    };
  }, []);

  const total = items.length;
  const { start, end, offsetY, height } = useMemo(() => {
    if (total === 0) {
      return { start: 0, end: 0, offsetY: 0, height: 0 };
    }
    // Short lists: render all (no virtualization overhead)
    if (total <= 40) {
      return { start: 0, end: total, offsetY: 0, height: total * rowHeight };
    }
    const visible = Math.ceil(viewport / rowHeight) + overscan * 2;
    let s = Math.floor(scrollTop / rowHeight) - overscan;
    if (s < 0) s = 0;
    let e = s + visible;
    if (e > total) e = total;
    return {
      start: s,
      end: e,
      offsetY: s * rowHeight,
      height: total * rowHeight,
    };
  }, [total, scrollTop, viewport, rowHeight, overscan]);

  if (total === 0) {
    return (
      <div className={className} ref={scrollerRef}>
        {empty}
      </div>
    );
  }

  const slice = items.slice(start, end);

  return (
    <div
      className={className}
      ref={scrollerRef}
      onScroll={onScroll}
      style={{ overflow: "auto", position: "relative" }}
    >
      <div style={{ height, position: "relative" }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {slice.map((item, i) => {
            const index = start + i;
            return (
              <div
                key={getKey(item, index)}
                style={{ minHeight: rowHeight, contentVisibility: "auto" }}
              >
                {renderItem(item, index)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}) as <T>(props: Props<T>) => React.ReactElement;
