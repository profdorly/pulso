# Contribuindo

O Pulso é um projeto pessoal e um portfólio. Issues com defeito, correção de notícia ou dúvida são bem-vindas. Pull requests também, mas abra uma issue antes de qualquer mudança grande: a linha editorial e o desenho do produto não são decididos por PR.

## Ambiente

Node 24.

```bash
npm ci
npm run dev            # site em http://localhost:4311/, com as edições de exemplo de fixtures/editions
```

Para rodar uma edição de verdade, copie `backend/.env.example` para `backend/.env` e preencha `OPENAI_API_KEY` (e `ARTIFICIAL_ANALYSIS_API_KEY` para o catálogo de modelos). Cada corrida custa cerca de US$ 0,35 em API.

```bash
npm run edition -- --slot=manha     # grava data/editions/
npm run edition -- --benchmarks     # grava data/editions/models.json
```

## Antes de abrir o PR

```bash
npm run typecheck && npm run lint && npm test
npm run build:site && npm run verify:site && npm run budget:bundle && npm run a11y
```

O CI roda os mesmos comandos, sem segredo nenhum, sobre `fixtures/editions`.

## Convenções

- Texto para o leitor em português do Brasil, sem jargão de IA; as regras estão em `.cursor/skills/humanizador` e `.cursor/rules/pulso-copy.mdc`.
- Código e comentários em inglês. Comentário explica o porquê, não o quê.
- Número sem fonte não entra: dado ausente é "—", nunca zero.
- Mudança de comportamento vem com teste.

Ao contribuir, você concorda que a sua contribuição é licenciada sob a [Apache License 2.0](LICENSE), como o resto do código. A marca não entra nisso; veja [TRADEMARKS.md](TRADEMARKS.md).
