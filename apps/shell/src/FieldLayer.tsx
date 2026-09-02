/**
 * GPU-friendly Aeon constellation field.
 * Single full-screen canvas on its own compositor layer; pauses when hidden
 * or when motion is calm / reduced. Paints nothing at all unless the
 * `field` preference is "stars" — the default "aurora" look is a static
 * CSS background on `body` (see tokens.css), so the canvas stays blank and
 * lets it show through.
 */
import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  r: number;
  a: number;
  phase: number;
  speed: number;
  tint: 0 | 1 | 2; // white | plasma | mind
};

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function isCalmDom(): boolean {
  return document.documentElement.dataset.motion === "calm";
}

function isStarsDom(): boolean {
  return document.documentElement.dataset.field === "stars";
}

export function FieldLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!ctx) return;

    let stars: Star[] = [];
    let raf = 0;
    let running = true;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const seed = () => {
      const count = Math.min(72, Math.floor((w * h) / 28000) + 28);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + Math.random() * 1.35,
        a: 0.15 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.9,
        tint: (Math.random() < 0.45 ? 0 : Math.random() < 0.5 ? 1 : 2) as
          | 0
          | 1
          | 2,
      }));
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Resizing the canvas already clears it; skip seeding/painting when
      // the static aurora (CSS) is what should show through instead.
      if (!isStarsDom()) return;
      seed();
      paint(performance.now(), true);
    };

    const color = (t: Star["tint"], a: number) => {
      if (t === 1) return `rgba(125,255,232,${a})`;
      if (t === 2) return `rgba(196,181,253,${a})`;
      return `rgba(255,255,255,${a})`;
    };

    const paint = (t: number, forceStatic = false) => {
      ctx.clearRect(0, 0, w, h);
      // Soft nebula washes (cheap, no blur filter)
      const g1 = ctx.createRadialGradient(
        w * 0.5,
        0,
        0,
        w * 0.5,
        0,
        Math.max(w, h) * 0.55,
      );
      g1.addColorStop(0, "rgba(100,80,255,0.12)");
      g1.addColorStop(1, "rgba(100,80,255,0)");
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, w, h);

      const g2 = ctx.createRadialGradient(
        w * 0.82,
        h * 0.78,
        0,
        w * 0.82,
        h * 0.78,
        Math.max(w, h) * 0.35,
      );
      g2.addColorStop(0, "rgba(0,255,200,0.07)");
      g2.addColorStop(1, "rgba(0,255,200,0)");
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);

      const staticMode = forceStatic || prefersReducedMotion() || isCalmDom();
      for (const s of stars) {
        const twinkle = staticMode
          ? s.a
          : s.a * (0.55 + 0.45 * Math.sin(t * 0.001 * s.speed + s.phase));
        ctx.beginPath();
        ctx.fillStyle = color(s.tint, Math.max(0.05, twinkle));
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = (t: number) => {
      if (!running) return;
      if (!isStarsDom()) {
        ctx.clearRect(0, 0, w, h);
        raf = 0;
        return;
      }
      if (document.hidden || prefersReducedMotion() || isCalmDom()) {
        paint(t, true);
        raf = 0;
        return;
      }
      paint(t);
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (!isStarsDom()) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        // Leave the canvas blank so the static aurora background painted
        // on `body` (tokens.css) shows through underneath.
        ctx.clearRect(0, 0, w, h);
        return;
      }
      if (stars.length === 0) seed();
      if (raf) return;
      if (prefersReducedMotion() || isCalmDom()) {
        paint(performance.now(), true);
        return;
      }
      raf = requestAnimationFrame(loop);
    };

    const onVis = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else {
        start();
      }
    };

    const onPrefAttr = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      start();
    };

    resize();
    start();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    const mo = new MutationObserver(onPrefAttr);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-motion", "data-field"],
    });

    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
      mo.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="aeon-field"
      aria-hidden
      width={1}
      height={1}
    />
  );
}
