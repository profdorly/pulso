/**
 * The product format of the Pulso da Semana, decided after the W40 pilot (October 2026).
 *
 * The episode is generated at the voices' natural pace and sped up once, in assembly, so the
 * published file plays faster everywhere — on the site, in a download, in a podcast app — with
 * no player setting involved. 1.15× was chosen by ear over 1.2×, which sounded rushed.
 *
 * The cap is on the published file. The script limits in `gate.ts` are derived from it: W40
 * spoke about 15.3 script characters per second (tags included), so 5,100 characters generate
 * about 333 s and publish at about 290 s, with room for a slower delivery.
 */

/** Playback speed baked into the published MP3 (`atempo`, pitch preserved). */
export const EPISODE_SPEED = 1.15;

/** Longest published episode, in seconds. Longer and `publicar` refuses it. */
export const MAX_EPISODE_SECONDS = 300;
