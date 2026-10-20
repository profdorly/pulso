import { describe, expect, it } from "vitest";
import { findAiTells, hasAiTells } from "./tells.js";

const ids = (text: string | undefined) => findAiTells(text).map((tell) => tell.id);

describe("findAiTells", () => {
  it.each([
    ["Não é só um guia, é um manual de operação.", "antitese"],
    ["O problema não é o modelo, mas o uso que se faz dele.", "antitese"],
    ["Não se trata apenas de tecnologia, mas de pessoas.", "antitese"],
    ["A empresa não apenas lançou o modelo, mas também abriu os pesos.", "antitese"],
    [
      "A IA muda o marketing — ao criar campanhas — e facilita o trabalho — sobretudo o braçal.",
      "travessao",
    ],
    ["A plataforma é fundamental para o setor.", "vocabulario"],
    ["O lançamento representa um marco na história da empresa.", "vocabulario"],
    ["Um passo crucial para a empresa.", "vocabulario"],
    ["O modelo configura-se como alternativa ao GPT.", "copula"],
    ["A empresa cresceu. Além disso, contratou mais gente.", "conectores"],
    ["A ação caiu. No entanto, subiu depois. Portanto, fechou estável.", "conectores"],
    ["É importante ressaltar que o teste é preliminar.", "ressalva"],
    ["Vale destacar que a pesquisa usou 1.033 professores.", "ressalva"],
    ["A empresa enfrenta uma série de desafios.", "cliche"],
    ["O drama estreou na TV chinesa, sinalizando a chegada do formato.", "gerundio"],
    ["A Mistral capta €3 bilhões, reforçando sua proposta de IA soberana.", "gerundio"],
    ["Lançamento do modelo 🚀", "emoji"],
  ])("flags %j as %s", (text, id) => {
    expect(ids(text)).toContain(id);
  });

  it.each([
    "Professores usam IA, mas 55% mantiveram a mesma jornada de trabalho.",
    "A ação cita direitos fundamentais e pesquisa fundamental.",
    "O Marco Civil da Internet e o marco regulatório da IA seguem em debate.",
    "Uma adaptação de Jornada ao Oeste estreou na Hunan TV.",
    "A OpenAI demitiu três pesquisadores — Jasmine Wang, Tomek Korbak e Mikita Balesni — por violação.",
    "A Mistral captou €3 bilhões, elevando sua avaliação para €21 bilhões.",
    "No entanto, a empresa não comentou o caso.",
    "A autoria não foi identificada, mas a empresa investiga o episódio.",
    "O chip Intel® Core™ Ultra chega em 2026–2027.",
    "Segundo especialistas ouvidos pela TechCrunch, os modelos repetem padrões.",
  ])("leaves ordinary journalism alone: %j", (text) => {
    expect(findAiTells(text)).toEqual([]);
  });

  it("returns nothing for missing or blank text", () => {
    expect(findAiTells(undefined)).toEqual([]);
    expect(findAiTells("   ")).toEqual([]);
    expect(hasAiTells(undefined)).toBe(false);
  });

  it("reports each rule once, in a stable order, with the words that tripped it", () => {
    const tells = findAiTells(
      "Além disso, é importante ressaltar que o acordo é um marco, sinalizando a virada."
    );
    expect(tells).toEqual([
      { id: "vocabulario", excerpt: "é um marco" },
      { id: "conectores", excerpt: "Além disso" },
      { id: "ressalva", excerpt: "é importante ressaltar" },
      { id: "gerundio", excerpt: ", sinalizando" },
    ]);
  });

  it("names the chain when no single connector is a tell on its own", () => {
    expect(findAiTells("A ação caiu. No entanto, subiu. Com isso, fechou.")).toEqual([
      { id: "conectores", excerpt: "No entanto … Com isso" },
    ]);
  });
});
