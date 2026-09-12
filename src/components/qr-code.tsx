import qrcode from "qrcode-generator";

/**
 * Server-rendered QR code.
 *
 * Built as a single SVG `<path>` from the module matrix rather than via the library's
 * `createSvgTag()`, for two reasons: it costs zero client JavaScript, and it avoids
 * `dangerouslySetInnerHTML` entirely.
 *
 * Rendered light-on-dark is NOT safe — scanners expect dark modules on a light field — so the
 * quiet zone is always painted white even in the dark theme.
 */
export function QrCode({
  value,
  size = 208,
  label,
}: {
  value: string;
  /** Rendered edge length in CSS pixels. */
  size?: number;
  label: string;
}) {
  // Type 0 = auto-select the smallest version that fits; "M" = ~15% error correction, the
  // level authenticator apps are tuned for.
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();

  const count = qr.getModuleCount();
  // 4 modules of quiet zone on each side is the spec minimum; without it scanners struggle.
  const quiet = 4;
  const extent = count + quiet * 2;

  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${extent} ${extent}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="rounded-lg"
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
