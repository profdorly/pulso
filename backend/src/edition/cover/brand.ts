/** Papel & Brasa cover tokens, shared conceptually with frontend/src/index.css. */
export const COVER = {
  width: 1200,
  height: 675,
  colors: {
    night: "#110d0b",
    nightRaised: "#16110e",
    paper: "#f4ede6",
    warmGray: "#a69c94",
    amber: "#f0b35a",
    coral: "#ec8f6e",
    rose: "#d97f8c",
    plum: "#b07a9e",
  },
} as const;

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function wrapHeadline(text: string, maxChars = 22, maxLines = 4): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? "";
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxChars) {
      lines.push(current);
      if (lines.length >= maxLines - 1) {
        lines.push(words.slice(i).join(" "));
        return lines.slice(0, maxLines);
      }
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}
