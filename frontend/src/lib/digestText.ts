/**
 * The cover shows the outlet as a label under each digest bullet. Editorial copy still
 * often leads with the same name ("Olhar Digital: …"), so the reader would see it twice.
 */
export function withoutOutletPrefix(text: string, outlet: string): string {
  const trimmed = text.trim();
  const name = outlet.trim();
  if (!trimmed || !name) return trimmed;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = new RegExp(`^${escaped}(?:\\s*[:：]\\s*|\\s+[—–-]\\s+|\\s+)`, "i");
  const stripped = trimmed.replace(prefix, "").trim();
  if (!stripped || stripped === trimmed) return trimmed;

  const first = stripped.charAt(0);
  if (first.toLocaleLowerCase("pt-BR") === first) {
    return `${first.toLocaleUpperCase("pt-BR")}${stripped.slice(1)}`;
  }
  return stripped;
}
