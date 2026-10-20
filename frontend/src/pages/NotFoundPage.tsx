import { Link } from "react-router-dom";
import { useNoindex } from "../hooks/useNoindex.js";

export function NotFoundPage({
  title = "Página não encontrada",
  message = "Esse endereço não existe no Pulso. Pode ser um link antigo ou uma edição que nunca foi publicada.",
}: {
  title?: string;
  message?: string;
}) {
  useNoindex();

  return (
    <section className="pulso-page-header flex flex-col gap-5">
      <p className="pulso-kicker">Erro 404</p>
      <h1 className="pulso-title">{title}</h1>
      <p className="pulso-lede">{message}</p>
      <nav className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-3" aria-label="Voltar para o Pulso">
        <Link to="/" className="pulso-button pulso-button--go">
          Ir para a capa
        </Link>
        <Link to="/arquivo/" className="pulso-action">
          Ver o arquivo
        </Link>
        <Link to="/modelos/" className="pulso-action">
          Ver os modelos
        </Link>
      </nav>
    </section>
  );
}
