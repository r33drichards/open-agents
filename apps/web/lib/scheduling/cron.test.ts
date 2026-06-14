import { describe, expect, test } from "bun:test";
import {
  computeNextRun,
  intervalSecondsToCron,
  isCronExpressionShape,
  nextCronOccurrence,
  parseScheduleInput,
  ScheduleParseError,
  validateCronExpression,
} from "./cron";

const TZ = "America/New_York";
const NOW = new Date("2026-06-14T12:02:00Z");

describe("validateCronExpression", () => {
  test("accepts a valid 5-field expression and normalizes whitespace", () => {
    expect(validateCronExpression("0   9 * * 1-5")).toBe("0 9 * * 1-5");
    expect(validateCronExpression("*/15 * * * *")).toBe("*/15 * * * *");
  });

  test("rejects wrong field count", () => {
    expect(() => validateCronExpression("* * * *")).toThrow(ScheduleParseError);
    expect(() => validateCronExpression("* * * * * *")).toThrow(
      ScheduleParseError,
    );
  });

  test("rejects unsupported extended syntax (L/W/?/aliases)", () => {
    expect(() => validateCronExpression("0 9 L * *")).toThrow(
      ScheduleParseError,
    );
    expect(() => validateCronExpression("0 9 * * MON")).toThrow(
      ScheduleParseError,
    );
    expect(() => validateCronExpression("0 9 ? * *")).toThrow(
      ScheduleParseError,
    );
  });

  test("rejects out-of-range values", () => {
    expect(() => validateCronExpression("99 9 * * *")).toThrow(
      ScheduleParseError,
    );
  });
});

describe("isCronExpressionShape", () => {
  test("detects 5-field shape", () => {
    expect(isCronExpressionShape("0 9 * * *")).toBe(true);
    expect(isCronExpressionShape("5m")).toBe(false);
    expect(isCronExpressionShape("in 30 minutes")).toBe(false);
  });
});

describe("intervalSecondsToCron", () => {
  test("sub-minute rounds up to every minute", () => {
    expect(intervalSecondsToCron(30)).toBe("* * * * *");
    expect(intervalSecondsToCron(1)).toBe("* * * * *");
  });

  test("clean sub-hour minutes map directly", () => {
    expect(intervalSecondsToCron(5 * 60)).toBe("*/5 * * * *");
    expect(intervalSecondsToCron(15 * 60)).toBe("*/15 * * * *");
  });

  test("non-clean minutes round to nearest divisor of 60", () => {
    expect(intervalSecondsToCron(7 * 60)).toBe("*/6 * * * *");
    // 90m -> rounds to hourly bucket (nearest hour divisor)
    expect(intervalSecondsToCron(90 * 60)).toBe("0 */2 * * *");
  });

  test("hours and days", () => {
    expect(intervalSecondsToCron(60 * 60)).toBe("0 * * * *");
    expect(intervalSecondsToCron(2 * 3600)).toBe("0 */2 * * *");
    expect(intervalSecondsToCron(24 * 3600)).toBe("0 0 * * *");
    expect(intervalSecondsToCron(3 * 24 * 3600)).toBe("0 0 */3 * *");
  });
});

describe("parseScheduleInput", () => {
  test("parses a cron expression as recurring", () => {
    const result = parseScheduleInput({
      schedule: "0 9 * * 1-5",
      now: NOW,
      timezone: TZ,
    });
    expect(result.scheduleKind).toBe("recurring");
    expect(result.cronExpression).toBe("0 9 * * 1-5");
    expect(result.fireAt).toBeNull();
  });

  test("parses interval shorthand as recurring", () => {
    expect(
      parseScheduleInput({ schedule: "5m", now: NOW, timezone: TZ })
        .cronExpression,
    ).toBe("*/5 * * * *");
    expect(
      parseScheduleInput({
        schedule: "every 2 hours",
        now: NOW,
        timezone: TZ,
      }).cronExpression,
    ).toBe("0 */2 * * *");
  });

  test("parses relative one-shot", () => {
    const result = parseScheduleInput({
      schedule: "in 45 minutes",
      now: NOW,
      timezone: TZ,
    });
    expect(result.scheduleKind).toBe("once");
    expect(result.fireAt?.toISOString()).toBe("2026-06-14T12:47:00.000Z");
  });

  test("parses absolute ISO one-shot", () => {
    const result = parseScheduleInput({
      schedule: "2026-06-20T15:00:00Z",
      now: NOW,
      timezone: TZ,
    });
    expect(result.scheduleKind).toBe("once");
    expect(result.fireAt?.toISOString()).toBe("2026-06-20T15:00:00.000Z");
  });

  test("throws on gibberish", () => {
    expect(() =>
      parseScheduleInput({ schedule: "soonish", now: NOW, timezone: TZ }),
    ).toThrow(ScheduleParseError);
    expect(() =>
      parseScheduleInput({ schedule: "", now: NOW, timezone: TZ }),
    ).toThrow(ScheduleParseError);
  });
});

describe("nextCronOccurrence / computeNextRun", () => {
  test("computes the next 5-minute mark", () => {
    const next = nextCronOccurrence("*/5 * * * *", NOW, TZ);
    expect(next.toISOString()).toBe("2026-06-14T12:05:00.000Z");
  });

  test("interprets daily cron in the task timezone", () => {
    // 9am America/New_York on 2026-06-14 is 13:00Z (EDT, UTC-4).
    const next = nextCronOccurrence("0 9 * * *", NOW, TZ);
    expect(next.toISOString()).toBe("2026-06-14T13:00:00.000Z");
  });

  test("recurring computeNextRun uses cron", () => {
    const next = computeNextRun(
      { scheduleKind: "recurring", cronExpression: "0 * * * *", fireAt: null },
      NOW,
      TZ,
    );
    expect(next?.toISOString()).toBe("2026-06-14T13:00:00.000Z");
  });

  test("one-shot in the past returns null", () => {
    const next = computeNextRun(
      {
        scheduleKind: "once",
        cronExpression: null,
        fireAt: new Date("2020-01-01T00:00:00Z"),
      },
      NOW,
      TZ,
    );
    expect(next).toBeNull();
  });
});
