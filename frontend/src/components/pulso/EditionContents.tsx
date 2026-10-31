export interface ContentsEntry {
  /** Element id of the section on this page. */
  id: string;
  label: string;
  count?: number;
}

/**
 * The edition's table of contents.
 *
 * A daily edition can carry fifty items, so the page runs long; this lets the reader jump to the
 * section they came for. Plain fragment links on purpose: the browser scrolls (smoothly, unless
 * the reader asked for reduced motion), the address can be shared, and it works before any
 * JavaScript runs. Rendered twice by the page — at the top of the column on small screens, in the
 * sticky sidebar on large ones — and CSS shows one of them.
 */
export function EditionContents({
  entries,
  placement,
}: {
  entries: ContentsEntry[];
  placement: "inline" | "aside";
}) {
  if (entries.length < 2) return null;

  return (
    <nav
      className={`pulso-contents ${placement === "aside" ? "pulso-panel pulso-contents--aside" : "pulso-contents--inline"}`}
      aria-label="Seções da edição"
    >
      <p className="pulso-kicker">Seções</p>
      <ol>
        {entries.map((entry) => (
          <li key={entry.id}>
            <a href={`#${entry.id}`}>
              <span>{entry.label}</span>
              {entry.count != null ? <span className="pulso-contents-count">{entry.count}</span> : null}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
