import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MEASUREMENT_CONTRACT,
  MEASUREMENT_STAGES,
  SYNTHETIC_FUNNEL_FIXTURE,
  summarizeSyntheticFunnel,
} from "../../src/components/marketing/measurement-model";

describe("MR-10B synthetic conversion measurement", () => {
  it("defines a single canonical four-stage educational journey", () => {
    expect(MEASUREMENT_STAGES).toEqual([
      "discovery", "education", "assessment", "trial-information",
    ]);
    expect(MEASUREMENT_CONTRACT.map((item) => item.stage)).toEqual(MEASUREMENT_STAGES);
    expect(MEASUREMENT_CONTRACT[3].definition).toContain("no interest is registered");
  });

  it("computes counts and honest denominators from synthetic fixtures", () => {
    const report = summarizeSyntheticFunnel(SYNTHETIC_FUNNEL_FIXTURE);
    expect(report.mode).toBe("synthetic-only");
    expect(report.syntheticJourneyCount).toBe(4);
    expect(report.stages.map((item) => item.count)).toEqual([4, 3, 2, 1]);
    expect(report.stages.map((item) => item.fromPreviousRate)).toEqual([
      1, 0.75, 2 / 3, 0.5,
    ]);
    expect(report.stages[3].fromDiscoveryRate).toBe(0.25);
  });

  it("marks rates with missing denominators as undefined, not 0% conversion", () => {
    const empty = summarizeSyntheticFunnel([]);
    expect(empty.syntheticJourneyCount).toBe(0);
    expect(empty.stages[0].fromPreviousRate).toBeNull();
    expect(empty.stages.every((item) => item.fromDiscoveryRate === null)).toBe(true);
  });

  it("does not count repeated synthetic journey identifiers twice", () => {
    expect(() => summarizeSyntheticFunnel([
      { id: "synthetic-duplicate", stages: ["discovery"] },
      { id: "synthetic-duplicate", stages: ["discovery"] },
    ])).toThrow(/Duplicate synthetic journey/);
  });

  it("rejects identifiers that are not explicitly synthetic fixtures", () => {
    expect(() => summarizeSyntheticFunnel([
      { id: "email@example.com", stages: ["discovery"] },
    ])).toThrow(/Only explicit synthetic/);
  });

  it("rejects skipped, out-of-order or repeated journey stages", () => {
    expect(() => summarizeSyntheticFunnel([
      { id: "synthetic-skip", stages: ["discovery", "assessment"] },
    ])).toThrow(/ordered, contiguous/);
    expect(() => summarizeSyntheticFunnel([
      { id: "synthetic-repeat", stages: ["discovery", "discovery"] },
    ])).toThrow(/ordered, contiguous/);
    expect(() => summarizeSyntheticFunnel([
      { id: "synthetic-reverse", stages: ["education", "discovery"] },
    ])).toThrow(/ordered, contiguous/);
  });

  it("keeps existing runtime tracking disabled and introduces no collector", () => {
    const root = path.resolve(__dirname, "../..");
    const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
    const tracker = read("src/components/marketing/funnel.ts");
    const model = read("src/components/marketing/measurement-model.ts");

    expect(tracker).toContain("No analytics, logging, transmission, cookies, or storage");
    expect(model).not.toMatch(/fetch\(|sendBeacon|localStorage|sessionStorage|document\.cookie|indexedDB|supabase|navigator\.geolocation/);
    expect(model).toContain('mode: "synthetic-only"');
  });
});
