import { COVER, escapeXml, wrapHeadline } from "./brand.js";

export interface CoverSpec {
  headline: string;
  label: string;
  slug: string;
}

export function coverSvg(spec: CoverSpec): string {
  const lines = wrapHeadline(spec.headline);
  const startY = 300 - ((lines.length - 1) * 76) / 2;
  const text = lines
    .map(
      (line, index) =>
        `<text x="96" y="${startY + index * 76}" fill="${COVER.colors.paper}" font-family="'Playfair Display', Georgia, serif" font-weight="500" font-size="68" letter-spacing="-1.8">${escapeXml(line)}</text>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${COVER.width}" height="${COVER.height}" viewBox="0 0 ${COVER.width} ${COVER.height}" role="img" aria-label="${escapeXml(spec.headline)}">
  <defs>
    <linearGradient id="brasa" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${COVER.colors.amber}"/>
      <stop offset="45%" stop-color="${COVER.colors.coral}"/>
      <stop offset="75%" stop-color="${COVER.colors.rose}"/>
      <stop offset="100%" stop-color="${COVER.colors.plum}"/>
    </linearGradient>
    <filter id="grainFilter" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch"/>
    </filter>
    <clipPath id="lightClip"><rect x="930" y="64" width="206" height="547" rx="32"/></clipPath>
  </defs>
  <rect width="100%" height="100%" fill="${COVER.colors.night}"/>
  <rect width="100%" height="3" fill="url(#brasa)"/>
  <rect x="930" y="64" width="206" height="547" rx="32" fill="url(#brasa)"/>
  <g clip-path="url(#lightClip)" fill="none" stroke="#17120f" stroke-opacity="0.28">
    <circle cx="930" cy="100" r="130"/>
    <circle cx="1148" cy="565" r="90"/>
  </g>
  <rect width="100%" height="100%" filter="url(#grainFilter)" opacity="0.045"/>
  <text x="96" y="104" fill="${COVER.colors.warmGray}" font-family="'IBM Plex Mono', ui-monospace, monospace" font-size="14" font-weight="500" letter-spacing="3.4">${escapeXml(spec.label)}</text>
  ${text}
  <text x="96" y="604" fill="${COVER.colors.paper}" font-family="'IBM Plex Mono', ui-monospace, monospace" font-size="13" font-weight="500" letter-spacing="3.2">PULSO</text>
  <circle cx="168" cy="600" r="2" fill="${COVER.colors.coral}"/>
  <text x="184" y="604" fill="${COVER.colors.warmGray}" font-family="'IBM Plex Mono', ui-monospace, monospace" font-size="13" font-weight="500" letter-spacing="3.2">DORLY.COM.BR</text>
</svg>
`;
}
