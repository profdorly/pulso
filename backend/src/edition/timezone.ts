import { SLOTS, TIMEZONE, type Slot } from "./schema.js";

export function calendarDateBrt(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function hourBrt(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = parts.find((part) => part.type === "hour")?.value;
  return Number.parseInt(hour ?? "0", 10);
}

/**
 * Default slot for a run that did not name one.
 *
 * The Pulso publishes one edition a day, at 07:30 BRT, under `manha`, so a run that does not
 * name a slot is that edition whatever the hour. A late manual run lands on the same slot and
 * meets the usual guard: unchanged when there is nothing new, an error asking for `force` when
 * there is.
 *
 * `tarde` and `meio-dia` stay valid Slots: editions published under the older cadences carry
 * them, the archive serves them, and a manual run can still name either explicitly.
 */
export function inferSlot(): Slot {
  return "manha";
}

export function isSlot(value: string): value is Slot {
  return (SLOTS as readonly string[]).includes(value);
}

export function editionId(calendarDate: string, slot: Slot): string {
  return `${calendarDate}-${slot}`;
}
