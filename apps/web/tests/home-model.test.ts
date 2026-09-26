import { describe, expect, it } from "vitest";

import { addDays, type DateOnly, type UserData } from "@super-gongik/domain";

import {
  buildHomeModel,
  floorPercent,
  formatDdayNumber,
  relativeDays,
} from "../src/lib/home-model";
import { buildAppProjection } from "../src/lib/projections";
import {
  SCENARIO_TODAY,
  buildScenarios,
  type ScenarioKey,
} from "./fixtures/service-scenarios";

const scenarios = buildScenarios();

function data(key: ScenarioKey): UserData {
  const found = scenarios.find((scenario) => scenario.key === key);
  if (!found) throw new Error(key);
  return found.data;
}

function model(key: ScenarioKey, today: DateOnly = SCENARIO_TODAY) {
  const document = data(key);
  const profile = document.profile!;
  return buildHomeModel(
    profile,
    buildAppProjection(document, profile, today),
    today,
  );
}

describe("home hero", () => {
  it("answers 'how long is left' first for an agent in service", () => {
    const { hero } = model("mid-service");
    expect(hero).toMatchObject({
      phase: "IN_SERVICE",
      eyebrow: "소집해제까지",
      headline: "D-306",
      dateLine: "2027년 8월 16일 (월) 소집해제",
      elapsedDays: 331,
      remainingDays: 306,
      live: true,
    });
    // Floored, not rounded: 331/637 = 51.96… shows 51.9, never 52.0.
    expect(hero.percentLabel).toBe("51.9%");
  });

  it("names the nearest milestone with its meaning", () => {
    expect(model("mid-service").hero.next).toMatchObject({
      label: "D-300",
      date: "2026-10-20",
      daysUntil: 6,
      detail: "남은 복무 300일",
    });
  });

  it("prefers a nearer pay step over a later service milestone", () => {
    // Call-up 2025-11-17, no prior service: 병장 상당 from 2027-01-01.
    const next = model("mid-service", "2026-12-20").hero.next;
    expect(next).toMatchObject({
      source: "PAY_BAND",
      label: "병장 상당 급여 단계",
      date: "2027-01-01",
    });
    // 2027 has no verified pay table, so no amount is promised.
    expect(next?.detail).toContain("2027년 보수 기준이 확인되면");
  });

  it("offers no pay-step milestone before prior service is answered", () => {
    const next = model("new-recruit").hero.next;
    expect(next?.source).toBe("SERVICE");
  });

  it("marks the final stretch at D-30 and under", () => {
    const { hero } = model("near-discharge");
    expect(hero.phase).toBe("FINAL_STRETCH");
    expect(hero.headline).toBe("D-22");
    expect(hero.stateLabel).toBe("마지막 한 달");
    expect(model("near-discharge", "2026-10-30").hero.stateLabel).toBe(
      "마지막 주",
    );
  });

  it("celebrates a milestone on the day it is reached", () => {
    expect(model("mid-service", "2026-10-20").hero.reachedToday).toBe(
      "오늘 D-300 달성",
    );
    expect(model("mid-service", "2026-10-21").hero.reachedToday).toBeNull();
  });

  it("celebrates the first day of a new pay step", () => {
    expect(model("mid-service", "2027-01-01").hero.reachedToday).toBeNull();
    // 2026-07-01 is the first day of 상병 상당 for this call-up date.
    expect(model("mid-service", "2026-07-01").hero.reachedToday).toBe(
      "오늘부터 상병 상당 급여 단계",
    );
  });

  it("counts down to call-up before service starts", () => {
    const { hero } = model("pre-call-up");
    expect(hero).toMatchObject({
      phase: "PRE_SERVICE",
      eyebrow: "소집까지",
      headline: "D-19",
      live: false,
    });
    expect(hero.next?.daysUntil).toBe(657);
  });

  it("has a distinct discharge day and completed state", () => {
    const dischargeDay = model("near-discharge", "2026-11-05").hero;
    expect(dischargeDay).toMatchObject({
      phase: "DISCHARGE_DAY",
      headline: "D-Day",
      live: false,
      next: null,
    });
    const completed = model("completed").hero;
    expect(completed).toMatchObject({
      phase: "COMPLETED",
      headline: "복무 완료",
      percentLabel: "100.0%",
      next: null,
    });
    expect(completed.dateLine).toContain("163일째");
  });

  it("never shows 100% on the last day of service", () => {
    const lastDay = addDays("2026-11-05", -1);
    expect(model("near-discharge", lastDay).hero.percent).toBeLessThan(100);
  });
});

describe("home secondary cards", () => {
  it("shows remaining leave with scheduled use and attendance total", () => {
    const { leave } = model("mid-service");
    expect(leave).toEqual({
      kind: "READY",
      remaining: "8일 6시간 30분",
      caption: "예정 2일 반영",
      attendance: "근태 누계 5시간 30분",
    });
  });

  it("asks for credit confirmation instead of showing 0 days", () => {
    expect(model("incomplete-profile").leave.kind).toBe("NEEDS_CONFIRMATION");
    expect(model("pre-call-up").leave.kind).toBe("BEFORE_SERVICE");
  });

  it("shows calculated base pay without ever summing a partial total", () => {
    const { pay } = model("mid-service");
    expect(pay).toMatchObject({
      kind: "BASE_ONLY",
      amount: 1_200_000,
      band: "상병 상당",
    });
    expect(model("incomplete-profile").pay.kind).toBe("PENDING");
    expect(model("completed").pay.kind).toBe("NONE");
  });

  it("lists today's record and the next upcoming ones", () => {
    const home = model("mid-service");
    expect(home.today.map((item) => item.event.eventType)).toEqual([
      "EARLY_LEAVE",
    ]);
    expect(
      home.upcoming.map((item) => [item.event.startDate, item.daysUntil]),
    ).toEqual([
      ["2026-10-23", 9],
      ["2026-11-05", 22],
    ]);
  });
});

describe("formatting helpers", () => {
  it("formats D-day, relative days and floored percentages", () => {
    expect(formatDdayNumber(0)).toBe("D-Day");
    expect(formatDdayNumber(1234)).toBe("D-1,234");
    expect(relativeDays(1)).toBe("내일");
    expect(relativeDays(9)).toBe("9일 후");
    expect(floorPercent(636, 637)).toBe(99.8);
    expect(floorPercent(1, 1000)).toBe(0.1);
  });
});
