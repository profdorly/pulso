import { publicAssetUrl } from "../../lib/paths.js";

/**
 * The page's closing light block: the one place where Brasa colour fills a surface.
 *
 * It closes the page instead of sitting in the hero, so the cover keeps a single primary
 * action and the subscription is offered once the reader has seen what they would get.
 */
export function SubscribeCta() {
  return (
    <section className="pulso-light-block pulso-subscribe" aria-labelledby="assinar">
      <div>
        <h2 id="assinar" className="pulso-section-title">
          Receba cada edição no seu leitor
        </h2>
        <p className="mt-3 max-w-[52ch]">
          Uma edição por dia, às 07:30, pelo feed RSS. Sem cadastro e sem e-mail: você assina no leitor
          que já usa.
        </p>
      </div>
      <a href={publicAssetUrl("feed.xml")} className="pulso-button pulso-button--go">
        Assinar via RSS
      </a>
    </section>
  );
}
