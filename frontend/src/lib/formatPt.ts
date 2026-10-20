import { SLOT_LABEL, type Slot } from "./edition.js";

const BRT = "America/Sao_Paulo";

export function formatEditionDate(calendarDate: string): string {
  const [year, month, day] = calendarDate.split("-").map(Number);
  if (!year || !month || !day) return calendarDate;
  const date = new Date(Date.UTC(year, month - 1, day, 15));
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRT,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatCapturedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRT,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function slotLabel(slot: Slot): string {
  return SLOT_LABEL[slot];
}

/**
 * When an edition was last written, without repeating its date.
 *
 * The edition line already names the calendar day, so the time alone is enough. A revision
 * captured on a later day keeps the full date, so the reader is never told a stale time.
 */
export function formatUpdatedAt(calendarDate: string, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: BRT }).format(date) === calendarDate;
  if (!sameDay) return formatCapturedAt(iso);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: BRT, hour: "2-digit", minute: "2-digit" }).format(date);
}
