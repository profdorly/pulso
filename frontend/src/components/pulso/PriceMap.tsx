import { useId } from "react";
import { priceFrontier, pricedModels, splitModelLabel, type PricedModel } from "../../lib/modelPicks.js";
import type { ModelRecord } from "../../lib/modelCatalog.js";

/**
 * Price against intelligence, one dot per model, drawn as static SVG.
 *
 * Price runs on a log scale — the list spans three orders of magnitude, and on a linear axis
 * every model but the priciest would sit in one corner. The line joins the value frontier: the
 * most intelligent model at each price or below. Only frontier models are named; the rest are
 * in the table underneath.
 */

const WIDTH = 880;
const HEIGHT = 440;
const MARGIN = { top: 16, right: 20, bottom: 40, left: 40 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

function priceLabel(value: number): string {
  return value < 1 ? `US$ ${value.toFixed(value < 0.1 ? 2 : 1)}` : `US$ ${value.toFixed(0)}`;
}

export function PriceMap({ models }: { models: readonly ModelRecord[] }) {
  const titleId = useId();
  const descId = useId();
  const points = pricedModels(models);
  const frontier = priceFrontier(models);
  if (points.length < 3) return null;

  const logMin = Math.floor(Math.log10(Math.min(...points.map((point) => point.price))));
  const logMax = Math.max(logMin + 1, Math.ceil(Math.log10(Math.max(...points.map((point) => point.price)))));
  const yMin = Math.floor(Math.min(...points.map((point) => point.index)) / 10) * 10;
  const yMax = Math.max(yMin + 10, Math.ceil(Math.max(...points.map((point) => point.index)) / 10) * 10);

  const x = (price: number) => MARGIN.left + ((Math.log10(price) - logMin) / (logMax - logMin)) * PLOT_W;
  const y = (index: number) => MARGIN.top + (1 - (index - yMin) / (yMax - yMin)) * PLOT_H;

  const xTicks = Array.from({ length: logMax - logMin + 1 }, (_, step) => 10 ** (logMin + step));
  const yTicks = Array.from({ length: (yMax - yMin) / 10 + 1 }, (_, step) => yMin + step * 10);
  const onFrontier = new Set(frontier.map((point) => point.model.id));

  // Name frontier models, skipping a label that would sit on top of the previous one.
  const labels: Array<{ point: PricedModel; lx: number; ly: number; anchor: "start" | "end" }> = [];
  for (const point of frontier) {
    const px = x(point.price);
    const py = y(point.index);
    const anchor = px > WIDTH - 160 ? "end" : "start";
    const lx = anchor === "start" ? px + 8 : px - 8;
    const ly = py + 4;
    if (labels.some((label) => Math.abs(label.ly - ly) < 14 && Math.abs(label.lx - lx) < 120)) continue;
    labels.push({ point, lx, ly, anchor });
  }

  return (
    <figure className="pulso-panel pulso-chart">
      <figcaption>
        <span className="pulso-chart-title" id={titleId}>
          Preço × inteligência
        </span>
        <span className="pulso-note">
          Dos {models.length} modelos de maior índice, os {points.length} com preço publicado. Preço por milhão de
          tokens (3 de entrada para 1 de saída), em escala logarítmica. A linha liga a fronteira: o mais inteligente
          por cada faixa de preço.
        </span>
      </figcaption>
      {/* On a phone the chart keeps a legible size and scrolls sideways, like the tables. */}
      <div className="pulso-map-wrap">
        <svg
          className="pulso-map"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby={titleId}
          aria-describedby={descId}
        >
          <desc id={descId}>
            {`Na fronteira, do mais barato ao mais caro: ${frontier
              .map((point) => `${point.model.name}, índice ${point.index.toFixed(1)} por ${priceLabel(point.price)}`)
              .join("; ")}.`}
          </desc>
          <g className="pulso-map-grid">
            {yTicks.map((tick) => (
              <g key={`y${tick}`}>
                <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(tick)} y2={y(tick)} />
                <text x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end">
                  {tick}
                </text>
              </g>
            ))}
            {xTicks.map((tick) => (
              <g key={`x${tick}`}>
                <line x1={x(tick)} x2={x(tick)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
                {/* The outer ticks sit on the plot's edges; anchoring them inward keeps them on the canvas. */}
                <text
                  x={x(tick)}
                  y={HEIGHT - MARGIN.bottom + 18}
                  textAnchor={tick === xTicks[0] ? "start" : tick === xTicks[xTicks.length - 1] ? "end" : "middle"}
                >
                  {priceLabel(tick)}
                </text>
              </g>
            ))}
            <text x={WIDTH - MARGIN.right} y={HEIGHT - 4} textAnchor="end">
              preço (US$/1M tokens) →
            </text>
            <text x={MARGIN.left} y={MARGIN.top - 4}>
              ↑ índice
            </text>
          </g>
          <polyline
            className="pulso-map-front"
            points={frontier.map((point) => `${x(point.price).toFixed(1)},${y(point.index).toFixed(1)}`).join(" ")}
          />
          {points.map((point) => (
            <circle
              key={point.model.id}
              className={onFrontier.has(point.model.id) ? "pulso-map-dot pulso-map-dot--front" : "pulso-map-dot"}
              cx={x(point.price).toFixed(1)}
              cy={y(point.index).toFixed(1)}
              r={onFrontier.has(point.model.id) ? 5 : 3.5}
            />
          ))}
          {labels.map(({ point, lx, ly, anchor }) => (
            <text key={point.model.id} className="pulso-map-label" x={lx.toFixed(1)} y={ly.toFixed(1)} textAnchor={anchor}>
              {splitModelLabel(point.model.name).name}
            </text>
          ))}
        </svg>
      </div>
    </figure>
  );
}
