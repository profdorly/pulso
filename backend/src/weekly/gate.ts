import { buildEvidenceIndex, fold, normalizeNumber, unsupportedClaims, type RiskyClaim, type SupportSet } from "../edition/evidence.js";
import type { WeeklyInput, WeeklyStory } from "./input.js";
import { ALLOWED_TAGS, allTurns, SPEAKER_ROLE, spokenText, tagsIn, type EpisodeScript } from "./script.js";

/**
 * Deterministic checks on the script, run before the auditor and again after any revision.
 *
 * The same rule as the edition gate: money, percentages, precise numbers and model versions
 * must appear in the published text of the stories the line cites. A line with no citation has
 * no evidence, so any such claim in it fails. Cheap, unbribable, and blind to everything else —
 * the semantic audit covers the rest.
 *
 * One allowance the edition gate does not make: speech rounds. "Quase 70%" for 67,24% is how a
 * person says it, and reading "sessenta e sete vírgula vinte e quatro por cento" aloud is what
 * makes a conversation sound read. A figure passes when a hedge word sits right before it and a
 * cited figure lies within a few percent, on the side the hedge promises.
 */

/**
 * Sized for an episode of at most five minutes as published (`episodeFormat.ts`): 5,100
 * characters, tags included, is about 333 s at the voices' pace and about 290 s at 1.15×.
 */
export const SCRIPT_LIMITS = {
  minChars: 3_800,
  maxChars: 5_100,
  /** One turn has to fit, with neighbours, inside a 2,000-character request. */
  maxTurnChars: 650,
  maxTagsPerTurn: 2,
  maxTags: 20,
  minShare: 0.3,
} as const;

export interface GateProblem {
  turnId?: string;
  problem: string;
}

export interface GateReport {
  passed: boolean;
  chars: number;
  spokenChars: number;
  tags: number;
  share: { host: number; analyst: number };
  problems: GateProblem[];
}

const ALLOWED = new Set<string>(ALLOWED_TAGS);

/** Relative distance a hedged figure may have from the cited one. */
const HEDGE_TOLERANCE = 0.06;
/**
 * Percentages are judged in points, not proportion: the auditor rejected "quase 70%" for
 * 67,24%, and a listener would too. "Dois terços" is the spoken form for that one.
 */
const PERCENT_POINTS = 1.5;
const HEDGE = /(quase|mais de|menos de|cerca de|perto de|uns|umas|aproximadamente|em torno de|por volta de|praticamente)\s*$/;

export function storiesByRef(input: WeeklyInput): Map<string, WeeklyStory> {
  return new Map(input.stories.map((story) => [story.ref, story]));
}

function supportValues(claim: RiskyClaim, support: SupportSet): number[] {
  const pool = claim.kind === "percent" ? support.percents : claim.kind === "currency" ? support.currencies : support.numbers;
  return [...pool].map(Number).filter(Number.isFinite);
}

const SCALE: Array<[RegExp, number]> = [
  [/^\s*mil\b/, 1e3],
  [/^\s*milh(ao|oes)\b/, 1e6],
  [/^\s*bilh(ao|oes)\b/, 1e9],
  [/^\s*trilh(ao|oes)\b/, 1e12],
];

/** True when every occurrence of the claim is a hedged rounding of a cited figure. */
function isHedgedRounding(claim: RiskyClaim, text: string, support: SupportSet): boolean {
  if (claim.kind === "model") return false;
  const said = normalizeNumber(claim.raw);
  if (said === null || said === 0) return false;
  const folded = fold(text);
  const needle = fold(claim.raw);
  let index = folded.indexOf(needle);
  if (index < 0) return false;
  while (index >= 0) {
    const hedge = folded.slice(Math.max(0, index - 28), index).match(HEDGE)?.[1];
    if (!hedge) return false;
    // "120 mil" is extracted as 120; the source may state 121.680 or "121 mil".
    const after = folded.slice(index + needle.length, index + needle.length + 14);
    const scale = SCALE.find(([pattern]) => pattern.test(after))?.[1] ?? 1;
    const candidates = scale === 1 ? [said] : [said, said * scale];
    const fits = supportValues(claim, support).some((cited) =>
      candidates.some((value) => {
        const distance = Math.abs(cited - value);
        if (claim.kind === "percent" ? distance > PERCENT_POINTS : distance / value > HEDGE_TOLERANCE) return false;
        if (hedge === "quase" || hedge === "menos de") return cited <= value;
        if (hedge === "mais de") return cited >= value;
        return true;
      })
    );
    if (!fits) return false;
    index = folded.indexOf(needle, index + needle.length);
  }
  return true;
}

/**
 * Total length, tags included, and each voice's share of the spoken text: the two numbers the
 * gate judges the whole script by. The director gets them too, since a model cannot count.
 */
export function scriptStats(script: EpisodeScript): Pick<GateReport, "chars" | "spokenChars" | "share"> {
  let chars = 0;
  const bySpeaker = { host: 0, analyst: 0 };
  for (const turn of allTurns(script)) {
    chars += turn.text.length;
    bySpeaker[turn.speaker] += spokenText(turn.text).length;
  }
  const spokenChars = bySpeaker.host + bySpeaker.analyst;
  return {
    chars,
    spokenChars,
    share: {
      host: spokenChars ? bySpeaker.host / spokenChars : 0,
      analyst: spokenChars ? bySpeaker.analyst / spokenChars : 0,
    },
  };
}

export function gateScript(script: EpisodeScript, input: WeeklyInput): GateReport {
  const refs = storiesByRef(input);
  const problems: GateProblem[] = [];
  const turns = allTurns(script);
  const { chars, spokenChars, share } = scriptStats(script);
  let tags = 0;

  for (const turn of turns) {
    if (turn.text.length > SCRIPT_LIMITS.maxTurnChars) {
      problems.push({ turnId: turn.id, problem: `fala com ${turn.text.length} caracteres (máx. ${SCRIPT_LIMITS.maxTurnChars})` });
    }
    const turnTags = tagsIn(turn.text);
    tags += turnTags.length;
    if (turnTags.length > SCRIPT_LIMITS.maxTagsPerTurn) {
      problems.push({ turnId: turn.id, problem: `${turnTags.length} tags numa fala (máx. ${SCRIPT_LIMITS.maxTagsPerTurn})` });
    }
    for (const tag of turnTags) {
      if (!ALLOWED.has(tag)) problems.push({ turnId: turn.id, problem: `tag fora da lista: [${tag}]` });
    }
    if (!spokenText(turn.text)) problems.push({ turnId: turn.id, problem: "fala sem texto, só tags" });
    const missing = turn.refs.filter((ref) => !refs.has(ref));
    if (missing.length) problems.push({ turnId: turn.id, problem: `referência inexistente: ${missing.join(", ")}` });

    const cited = turn.refs.map((ref) => refs.get(ref)).filter((story): story is WeeklyStory => Boolean(story));
    const support = buildEvidenceIndex({
      items: cited.map((story) => story.item),
      pageText: new Map(cited.map((story) => [story.item.url, story.publishedText])),
    }).global();
    const spoken = spokenText(turn.text);
    for (const claim of unsupportedClaims(spoken, support)) {
      if (isHedgedRounding(claim, spoken, support)) continue;
      problems.push({
        turnId: turn.id,
        problem: `"${claim.raw}" não aparece no texto publicado das matérias citadas${turn.refs.length ? "" : " (fala sem citação)"}`,
      });
    }
  }

  if (chars < SCRIPT_LIMITS.minChars || chars > SCRIPT_LIMITS.maxChars) {
    problems.push({ problem: `roteiro com ${chars} caracteres (faixa ${SCRIPT_LIMITS.minChars}–${SCRIPT_LIMITS.maxChars})` });
  }
  if (tags > SCRIPT_LIMITS.maxTags) {
    problems.push({ problem: `${tags} tags no episódio (máx. ${SCRIPT_LIMITS.maxTags})` });
  }
  if (Math.min(share.host, share.analyst) < SCRIPT_LIMITS.minShare) {
    problems.push({
      problem:
        `vozes desequilibradas: ${SPEAKER_ROLE.host.label.toLowerCase()} ${(share.host * 100).toFixed(0)}%, ` +
        `${SPEAKER_ROLE.analyst.label.toLowerCase()} ${(share.analyst * 100).toFixed(0)}%`,
    });
  }
  const opening = spokenText(script.segments[0]?.turns.map((turn) => turn.text).join(" ") ?? "");
  if (!/sint[eé]tic/i.test(opening)) {
    problems.push({ problem: "a abertura não avisa que as vozes são sintéticas" });
  }
  if (!/Professor Dorly/.test(opening)) {
    problems.push({ problem: "a abertura não diz que as vozes foram criadas pelo Professor Dorly" });
  }
  for (let i = 1; i < turns.length; i += 1) {
    if (turns[i].speaker === turns[i - 1].speaker) {
      problems.push({ problem: `mesma voz em duas falas seguidas (${turns[i].id})` });
    }
  }

  return { passed: problems.length === 0, chars, spokenChars, tags, share, problems };
}
