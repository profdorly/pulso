import { splitModelLabel } from "../../lib/modelPicks.js";

export interface BarRow {
  id: string;
  label: string;
  value: number;
  display: string;
}

/**
 * A ranked bar chart drawn with HTML and CSS: a list a screen reader reads as a list, bars a
 * printer prints, and nothing to download or run. The longest bar is the highest value; the
 * axis starts at zero, so lengths compare honestly.
 */
export function BarList({ title, note, rows }: { title: string; note?: string; rows: BarRow[] }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((row) => row.value));
  return (
    <figure className="pulso-panel pulso-chart">
      <figcaption>
        <span className="pulso-chart-title">{title}</span>
        {note ? <span className="pulso-note">{note}</span> : null}
      </figcaption>
      <ol className="pulso-bars">
        {rows.map((row) => {
          const { name, variant } = splitModelLabel(row.label);
          return (
            <li key={row.id}>
              <span className="pulso-bars-name">
                {name}
                {variant ? <span>{variant}</span> : null}
              </span>
              {/* SVG geometry rather than an inline style: nothing here depends on the CSP allowing styles. */}
              <svg className="pulso-bars-track" viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <rect width={max > 0 ? (row.value / max) * 100 : 0} height="1" />
              </svg>
              <span className="pulso-bars-value">{row.display}</span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
