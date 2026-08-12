/**
 * Coalesce high-frequency text_delta updates into rAF-batched flushes
 * so React does not re-render on every token.
 */

type FlushFn = (text: string) => void;

export class StreamBuffer {
  private buf = "";
  private raf: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onFlush: FlushFn;

  constructor(onFlush: FlushFn) {
    this.onFlush = onFlush;
  }

  setFlush(fn: FlushFn) {
    this.onFlush = fn;
  }

  push(chunk: string) {
    this.buf += chunk;
    if (this.raf != null) return;
    if (typeof requestAnimationFrame === "function") {
      this.raf = requestAnimationFrame(() => this.flush());
    } else {
      this.timer = setTimeout(() => this.flush(), 32);
    }
  }

  flush() {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.buf) return;
    const text = this.buf;
    this.buf = "";
    this.onFlush(text);
  }

  reset() {
    this.buf = "";
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
