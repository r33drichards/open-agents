import { CronExpressionParser } from "cron-parser";

/**
 * Pure scheduling helpers for scheduled tasks. No DB or SDK imports so the
 * logic can be unit-tested directly (mirrors packages/agent/skills/authoring).
 *
 * A schedule string accepted from the agent or UI can be one of:
 *   - a 5-field cron expression (recurring), e.g. "*\/5 * * * *", "0 9 * * 1-5"
 *   - an interval shorthand (recurring), e.g. "5m", "2h", "every 30 minutes"
 *   - a relative one-shot, e.g. "in 45 minutes", "in 2 hours"
 *   - an absolute one-shot ISO 8601 timestamp, e.g. "2026-06-14T15:00:00Z"
 */

/** The host's local IANA timezone, used as the default for new tasks. */
export const DEFAULT_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const CRON_FIELD_COUNT = 5;
// Extended cron syntax (L, W, ?, #, name aliases like MON/JAN) is intentionally
// unsupported, matching the documented behaviour. Plain numeric cron uses only
// digits and the separators * / - , so any letter or ? / # is a rejection.
const UNSUPPORTED_CRON = /[a-zA-Z?#]/;

// Divisors that produce an evenly-spaced `*\/n` cron step within the period.
const MINUTE_DIVISORS = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30];
const HOUR_DIVISORS = [1, 2, 3, 4, 6, 8, 12];

export interface ParsedSchedule {
  scheduleKind: "recurring" | "once";
  /** Set for recurring tasks; null for one-shot. */
  cronExpression: string | null;
  /** Set for one-shot tasks; null for recurring. */
  fireAt: Date | null;
}

export class ScheduleParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleParseError";
  }
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** True when the string looks like a 5-field cron expression. */
export function isCronExpressionShape(value: string): boolean {
  return normalizeWhitespace(value).split(" ").length === CRON_FIELD_COUNT;
}

/**
 * Validate a 5-field cron expression and return it normalized. Throws a
 * {@link ScheduleParseError} with a friendly message on invalid input.
 */
export function validateCronExpression(expression: string): string {
  const normalized = normalizeWhitespace(expression);
  if (normalized.split(" ").length !== CRON_FIELD_COUNT) {
    throw new ScheduleParseError(
      "Cron expression must have exactly 5 fields: minute hour day-of-month month day-of-week.",
    );
  }
  if (UNSUPPORTED_CRON.test(normalized)) {
    throw new ScheduleParseError(
      "Unsupported cron syntax. Use only numbers, *, /, -, and , (no L, W, ?, # or name aliases like MON/JAN).",
    );
  }
  try {
    CronExpressionParser.parse(normalized);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ScheduleParseError(`Invalid cron expression: ${detail}`);
  }
  return normalized;
}

/**
 * Compute the next occurrence of a cron expression strictly after `from`,
 * interpreted in the given IANA timezone.
 */
export function nextCronOccurrence(
  expression: string,
  from: Date,
  timezone: string,
): Date {
  const interval = CronExpressionParser.parse(expression, {
    currentDate: from,
    tz: timezone,
  });
  return interval.next().toDate();
}

function nearest(value: number, candidates: number[]): number {
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
  );
}

/**
 * Convert an interval (in seconds) to the nearest evenly-spaced cron
 * expression. Sub-minute intervals round up to one minute; intervals that
 * don't map to a clean cron step are rounded to the nearest one that does.
 */
export function intervalSecondsToCron(totalSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(totalSeconds / 60));

  if (minutes < 60) {
    const step = nearest(minutes, MINUTE_DIVISORS);
    return step === 1 ? "* * * * *" : `*/${step} * * * *`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    const step = nearest(hours, HOUR_DIVISORS);
    return step === 1 ? "0 * * * *" : `0 */${step} * * *`;
  }

  const days = Math.min(28, Math.max(1, Math.round(hours / 24)));
  return days === 1 ? "0 0 * * *" : `0 0 */${days} * *`;
}

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  d: 86_400,
  day: 86_400,
  days: 86_400,
};

// "5m", "2 hours", "every 30 minutes", "every 2h"
const INTERVAL_RE = /^(?:every\s+)?(\d+)\s*([a-z]+)$/i;
// "in 45 minutes", "in 2 hours"
const RELATIVE_RE = /^in\s+(\d+)\s*([a-z]+)$/i;

function parseUnitDuration(count: string, unit: string): number | null {
  const seconds = UNIT_SECONDS[unit.toLowerCase()];
  if (seconds === undefined) {
    return null;
  }
  return Number(count) * seconds;
}

/**
 * Parse a free-form schedule string into a normalized {@link ParsedSchedule}.
 * Throws {@link ScheduleParseError} on anything unrecognized.
 */
export function parseScheduleInput(input: {
  schedule: string;
  now: Date;
  timezone: string;
}): ParsedSchedule {
  const raw = input.schedule.trim();
  if (!raw) {
    throw new ScheduleParseError("A schedule is required.");
  }

  // Relative one-shot: "in 45 minutes"
  const relative = RELATIVE_RE.exec(raw);
  if (relative) {
    const seconds = parseUnitDuration(relative[1], relative[2]);
    if (seconds === null) {
      throw new ScheduleParseError(`Unknown time unit: "${relative[2]}".`);
    }
    return {
      scheduleKind: "once",
      cronExpression: null,
      fireAt: new Date(input.now.getTime() + seconds * 1000),
    };
  }

  // Recurring cron expression.
  if (isCronExpressionShape(raw)) {
    return {
      scheduleKind: "recurring",
      cronExpression: validateCronExpression(raw),
      fireAt: null,
    };
  }

  // Recurring interval shorthand: "5m", "every 2 hours"
  const interval = INTERVAL_RE.exec(raw);
  if (interval) {
    const seconds = parseUnitDuration(interval[1], interval[2]);
    if (seconds !== null) {
      return {
        scheduleKind: "recurring",
        cronExpression: intervalSecondsToCron(seconds),
        fireAt: null,
      };
    }
  }

  // Absolute one-shot ISO timestamp.
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      scheduleKind: "once",
      cronExpression: null,
      fireAt: parsed,
    };
  }

  throw new ScheduleParseError(
    `Could not understand the schedule "${raw}". Provide a cron expression (e.g. "0 9 * * *"), an interval (e.g. "5m"), a relative time (e.g. "in 30 minutes"), or an ISO timestamp.`,
  );
}

/** Compute the next fire time for a parsed schedule, or null if it's in the past. */
export function computeNextRun(
  schedule: Pick<ParsedSchedule, "scheduleKind" | "cronExpression" | "fireAt">,
  from: Date,
  timezone: string,
): Date | null {
  if (schedule.scheduleKind === "recurring" && schedule.cronExpression) {
    return nextCronOccurrence(schedule.cronExpression, from, timezone);
  }
  if (schedule.scheduleKind === "once" && schedule.fireAt) {
    return schedule.fireAt.getTime() > from.getTime() ? schedule.fireAt : null;
  }
  return null;
}

/** Human-readable summary of a schedule, for confirmations and the UI. */
export function describeSchedule(
  schedule: Pick<ParsedSchedule, "scheduleKind" | "cronExpression" | "fireAt">,
  timezone: string,
): string {
  if (schedule.scheduleKind === "once" && schedule.fireAt) {
    return `once at ${schedule.fireAt.toLocaleString("en-US", { timeZone: timezone })} (${timezone})`;
  }
  if (schedule.cronExpression) {
    return `on cron "${schedule.cronExpression}" (${timezone})`;
  }
  return "unscheduled";
}
