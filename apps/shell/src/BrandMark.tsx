/**
 * Forge brand mark — reuses the desktop icon master (Aeon teardrop PNG).
 * Same asset as taskbar / favicon for one brand identity.
 */
export function BrandMark({
  className = "brand-mark",
  title = "Forge",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <img
      className={className}
      src="/forge-icon.png"
      width={28}
      height={28}
      alt=""
      title={title}
      draggable={false}
      decoding="async"
    />
  );
}
