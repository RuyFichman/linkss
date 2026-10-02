/**
 * Reporting-day arithmetic (ADR 0011). A "day" is a calendar day in the reporting timezone, written
 * `YYYY-MM-DD`. The timezone is a setting that the database returns with every report; this module
 * never reads the clock, so every function is deterministic. Mirror of private.analytics_local_day.
 */
export const DEFAULT_REPORTING_TIME_ZONE = "America/Sao_Paulo";

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function utcMillis(day: string): number {
  const match = DAY_PATTERN.exec(day);
  if (!match) return Number.NaN;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const millis = Date.UTC(year, month - 1, date);
  const check = new Date(millis);
  // Date.UTC rolls 2026-02-31 over to March; such a value is not a day.
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === date ? millis : Number.NaN;
}

export function isDay(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(utcMillis(value));
}

/** The reporting day an instant falls on. */
export function localDay(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

export function addDays(day: string, amount: number): string {
  return new Date(utcMillis(day) + amount * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMillis(to) - utcMillis(from)) / MS_PER_DAY);
}

/** Every day of the window, oldest first. Empty when the window is inverted. */
export function daysInWindow(from: string, to: string): string[] {
  const count = daysBetween(from, to) + 1;
  return count > 0 ? Array.from({ length: count }, (_, index) => addDays(from, index)) : [];
}

export const PERIOD_PRESETS = ["today", "7d", "30d", "90d"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_DAYS: Record<PeriodPreset, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };
export const DEFAULT_PERIOD: PeriodPreset = "7d";

export function parsePeriod(value: unknown): PeriodPreset {
  return typeof value === "string" && (PERIOD_PRESETS as readonly string[]).includes(value) ? (value as PeriodPreset) : DEFAULT_PERIOD;
}

export interface DayWindow {
  from: string;
  to: string;
}

/** "Last N days" is the N reporting days that end today, today included (today is partial). */
export function periodWindow(preset: PeriodPreset, today: string): DayWindow {
  return { from: addDays(today, 1 - PERIOD_DAYS[preset]), to: today };
}

/** A preset is available when the plan's history depth covers it. */
export function periodIsAvailable(preset: PeriodPreset, historyDays: number): boolean {
  return PERIOD_DAYS[preset] <= historyDays;
}

const DISPLAY = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const DISPLAY_SHORT = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });

/** "02/10/2026". The day is already a reporting day, so it is formatted without conversion. */
export function formatDay(day: string): string {
  return isDay(day) ? DISPLAY.format(new Date(utcMillis(day))) : "";
}

/** "02/10". */
export function formatDayShort(day: string): string {
  return isDay(day) ? DISPLAY_SHORT.format(new Date(utcMillis(day))) : "";
}

/** "02/10/2026, 14:05" in the reporting timezone. */
export function formatInstant(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(instant);
}
