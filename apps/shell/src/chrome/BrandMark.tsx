import { useId } from "react";

/**
 * Forge brand mark — inline vector (teardrop nucleus, cyan -> violet
 * gradient), sourced from apps/shell/public/brand-mark.svg. Same shape as
 * the desktop icon / favicon masters for one brand identity. Inlined (not
 * an <img>) so the existing glow/breathe CSS on `.brand-mark` keeps working
 * on real DOM content.
 *
 * Gradient/filter ids are scoped per instance via useId() so two marks
 * rendered at once never fight over the same <defs> reference.
 *
 * Callers that still pass the old `className="brand-mark brand-mark-lg"`
 * pattern keep working unchanged; `size` is the source of truth for the
 * rendered pixel size regardless of which classes end up applied.
 *
 * `title` renders as a plain HTML `title` attribute on a wrapper span (a
 * native hover tooltip), not an SVG `<title>` child — every caller renders
 * a sibling "Forge" text node right next to this mark, and an in-SVG
 * `<title>Forge</title>` would be a second DOM match for it.
 */
export function BrandMark({
  className,
  size = className?.includes("brand-mark-lg") ? 44 : 28,
  title = "Forge",
}: {
  className?: string;
  size?: 18 | 28 | 44;
  title?: string;
}) {
  const uid = useId();
  const core = `aeonCore-${uid}`;
  const sheen = `aeonSheen-${uid}`;
  const glow = `aeonGlow-${uid}`;
  const cls =
    className ?? (size >= 44 ? "brand-mark brand-mark-lg" : "brand-mark");
  return (
    <span
      className={cls}
      style={{ width: size, height: size, display: "block" }}
      title={title}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={core}
            x1="14"
            y1="10"
            x2="52"
            y2="54"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#b8fff4" />
            <stop offset="38%" stopColor="#7dffe8" />
            <stop offset="72%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#c4b5fd" />
          </linearGradient>
          <radialGradient
            id={sheen}
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(24 20) rotate(55) scale(28 22)"
          >
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <filter id={glow} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Soft halo */}
        <ellipse cx="32" cy="34" rx="22" ry="24" fill="#7dffe8" opacity="0.12" />
        <ellipse cx="32" cy="34" rx="18" ry="20" fill="#c4b5fd" opacity="0.1" />
        {/* Living nucleus: teardrop-orb hybrid (Aeon mark) */}
        <path
          filter={`url(#${glow})`}
          fill={`url(#${core})`}
          d="M32 8
             C42 8 52 18 52 30
             C52 44 40 54 32 56
             C24 54 12 44 12 30
             C12 18 22 8 32 8Z"
        />
        {/* Inner fluid wave */}
        <path
          fill="#c4b5fd"
          opacity="0.35"
          d="M18 34
             C22 28 28 30 32 33
             C36 36 42 38 48 34
             C48 44 40 52 32 53.5
             C24 52 16 44 16 34
             C16.5 34 17 34 18 34Z"
        />
        {/* Specular */}
        <ellipse
          cx="25"
          cy="22"
          rx="7"
          ry="5"
          fill={`url(#${sheen})`}
          transform="rotate(-28 25 22)"
        />
        <path
          stroke="#ffffff"
          strokeOpacity="0.45"
          strokeWidth="1.2"
          strokeLinecap="round"
          d="M22 18 C26 14 34 13 40 17"
        />
      </svg>
    </span>
  );
}
