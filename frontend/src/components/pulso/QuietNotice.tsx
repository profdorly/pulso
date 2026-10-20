import type { PulsoEdition } from "../../lib/edition.js";

/**
 * Shown when an edition carries no items.
 *
 * A cover with nothing on it should say why. Silence here would read as a broken page,
 * and the honest reason — nothing could be confirmed at the source — is the product's
 * whole promise working as intended.
 */
export function QuietNotice({ edition }: { edition: PulsoEdition }) {
  if (edition.items.length > 0) return null;

  const gate = edition.gate;
  const rejected = gate ? gate.bulletsDropped + gate.blurbsDropped : 0;

  return (
    <section className="pulso-panel pulso-quiet" aria-label="Por que esta capa está vazia">
      <p className="pulso-kicker">Nada confirmado</p>
      <p className="mt-3 max-w-[60ch] leading-relaxed">
        Esta edição não traz itens porque nada passou na verificação. O Pulso só publica o que
        consegue confirmar na fonte: link que abre na matéria certa e número que aparece no
        original.
      </p>
      {rejected > 0 ? (
        <p className="pulso-note mt-3">
          {rejected} {rejected === 1 ? "afirmação foi descartada" : "afirmações foram descartadas"} por
          falta de suporte na fonte.
        </p>
      ) : null}
      <p className="pulso-note mt-1">
        Os números dos modelos seguem valendo, com a data em que foram medidos.
      </p>
    </section>
  );
}
