# Marcas

O código deste repositório é aberto sob a [Apache License 2.0](LICENSE). A marca não é.

A licença Apache [não concede direito de uso de marca](LICENSE) (seção 6). Ficam reservados, com todos os direitos:

- os nomes **Pulso** (como nome deste jornal) e **Professor Dorly**;
- os logotipos e marcas visuais em `frontend/public/brand/`, `frontend/public/favicon.svg` e `frontend/public/og-pulso.svg` / `og-pulso.png`;
- o domínio `pulso.dorly.com.br` e a identidade do jornal publicado nele.

## O que você pode fazer

- Ler, estudar, copiar e modificar o código, inclusive para uso comercial, nos termos da licença.
- Rodar um fork para você ou para a sua organização.
- Dizer, com verdade, que o seu projeto é baseado no Pulso ("feito a partir do código do Pulso, de Professor Dorly").

## O que pede autorização

- Publicar um site, newsletter ou produto com o nome Pulso, ou com nome, logo ou visual que se confunda com ele.
- Usar o nome ou a imagem de Professor Dorly para promover outro trabalho.
- Apresentar um fork como se fosse o Pulso ou tivesse o endosso de quem o faz.

## Antes de publicar um fork

Troque a identidade, que mora em poucos lugares:

- `frontend/src/lib/siteBase.ts`: nome, slogan, endereço, publicador, links e o ID do Google Analytics;
- `frontend/index.html`: título provisório e o snippet do Google Analytics (apague-o, ou use o seu ID);
- `frontend/public/brand/`, `favicon.svg`, `og-pulso.svg`: logo e cartão social;
- `backend/src/edition/cover/`: o nome e o domínio desenhados na capa de cada edição;
- `backend/src/fetchers/rss.ts`: o User-Agent, que identifica quem está lendo os feeds.

Dúvidas sobre marca: abra uma issue no repositório.
