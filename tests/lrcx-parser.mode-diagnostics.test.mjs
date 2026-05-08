import { describe, expect, test } from "@jest/globals";
import { joinLines, MODES, parseWith } from "./helpers/lrcx-test-helpers.mjs";

describe("LRCX mode-specific diagnostics", () => {
  test("resolves conflicting explicit main lines according to strict, standard and loose policies", async () => {
    const text = joinLines([
      "[#title] T",
      "[---] v1.0",
      "",
      "[00:00.000]A",
      "[00:00.000]B",
    ]);
    const expectedByMode = {
      Strict: { status: "Abort", action: "abort" },
      Standard: { status: "Partial", action: "partial" },
      Loose: { status: "Fragment", action: "keep-first" },
    };

    for (const mode of MODES) {
      const { result, errors } = await parseWith(mode, text);

      expect(result.status).toBe(expectedByMode[mode].status);
      expect(result.lines.map((line) => line.text)).toEqual(["A"]);
      expect(errors[0]).toMatchObject({
        Name: "NonIdenticalLine",
        Phase: "body",
        Section: "body",
        Mode: mode,
        Action: expectedByMode[mode].action,
        Line: 5,
        Column: 12,
        RawLine: "[00:00.000]B",
        Snippet: "B",
        LineTag: "00:00.000",
        TimeMs: 0,
        LyricPosition: {
          timeMs: 0,
          timeTag: "00:00.000",
        },
      });
    }
  });

  test("treats unsupported time precision according to each parser mode", async () => {
    const text = joinLines([
      "[#title] T",
      "[---] v1.0",
      "",
      "[00:00.000]ok",
      "[00:00.1234]bad",
      "[00:00.500]tail",
    ]);
    const expectedByMode = {
      Strict: { status: "Abort", action: "abort", texts: ["ok"] },
      Standard: { status: "Partial", action: "partial", texts: ["ok"] },
      Loose: { status: "Fragment", action: "skip", texts: ["ok", "tail"] },
    };

    for (const mode of MODES) {
      const { result, errors } = await parseWith(mode, text);

      expect(result.status).toBe(expectedByMode[mode].status);
      expect(result.lines.map((line) => line.text)).toEqual(expectedByMode[mode].texts);
      expect(errors[0]).toMatchObject({
        Name: "UnsupportedAccuracy",
        Mode: mode,
        Action: expectedByMode[mode].action,
        Line: 5,
        Snippet: "00:00.1234",
        TimeMs: 123,
        LineTag: "00:00.1234",
      });
    }
  });

  test("handles undeclared BODY tags according to each parser mode", async () => {
    const text = joinLines([
      "[#title] T",
      "[---] v1.0",
      "",
      "[00:00.000]ok",
      "[00:00.500][#ghost]bad",
      "[00:01.000]tail",
    ]);
    const expectedByMode = {
      Strict: { status: "Abort", action: "abort", texts: ["ok"] },
      Standard: { status: "Partial", action: "partial", texts: ["ok"] },
      Loose: { status: "Fragment", action: "continue", texts: ["ok", "bad", "tail"] },
    };

    for (const mode of MODES) {
      const { result, errors } = await parseWith(mode, text);

      expect(result.status).toBe(expectedByMode[mode].status);
      expect(result.lines.map((line) => line.text)).toEqual(expectedByMode[mode].texts);
      expect(errors[0]).toMatchObject({
        Name: "MarkNotFound",
        Mode: mode,
        Action: expectedByMode[mode].action,
        Line: 5,
        LineTag: "00:00.500",
        TimeMs: 500,
        LyricPosition: {
          timeMs: 500,
          timeTag: "00:00.500",
          tag: "ghost",
        },
      });
    }
  });

  test("keeps the first explicit track in loose mode when one line mixes multiple main track tags", async () => {
    const text = joinLines([
      "[#title] T",
      "[#trans:zh] Chinese",
      "[---] v1.0",
      "",
      "[00:00.000]ok",
      "[00:00.500][#timing][#zh]ab<100>c",
      "[00:01.000]tail",
    ]);
    const expectedByMode = {
      Strict: { status: "Abort", action: "abort", texts: ["ok"] },
      Standard: { status: "Partial", action: "partial", texts: ["ok"] },
      Loose: { status: "Fragment", action: "keep-first", texts: ["ok", "abc", "tail"] },
    };

    for (const mode of MODES) {
      const { result, errors } = await parseWith(mode, text);

      expect(result.status).toBe(expectedByMode[mode].status);
      expect(result.lines.map((line) => line.text)).toEqual(expectedByMode[mode].texts);
      expect(errors[0]).toMatchObject({
        Name: "RetypeError",
        Mode: mode,
        Action: expectedByMode[mode].action,
        Line: 6,
        LineTag: "00:00.500",
        TimeMs: 500,
        LyricPosition: {
          timeMs: 500,
          timeTag: "00:00.500",
          track: "timing",
          tag: "zh",
        },
      });
    }
  });

  test("keeps invalid references observable while varying the recovery action by mode", async () => {
    const text = joinLines([
      "[#title] T",
      "[---] v1.0",
      "",
      "[00:00.000]ok",
      "[00:00.500][#ref:00:01.000]",
      "[00:01.000]tail",
    ]);
    const expectedByMode = {
      Strict: { status: "Abort", action: "abort" },
      Standard: { status: "Partial", action: "partial" },
      Loose: { status: "Fragment", action: "skip" },
    };

    for (const mode of MODES) {
      const { result, errors } = await parseWith(mode, text);

      expect(result.status).toBe(expectedByMode[mode].status);
      expect(result.lines.map((line) => line.text)).toEqual(["ok", "", "tail"]);
      expect(result.lines[1]?.attr).toEqual({ ref: "00:01.000" });
      expect(errors[0]).toMatchObject({
        Name: "InvalidReference",
        Mode: mode,
        Action: expectedByMode[mode].action,
        Line: 5,
        LineTag: "00:00.500",
        TimeMs: 500,
        Desc: "Reference target '00:01.000' must point to an earlier lyric group",
      });
    }
  });

  test("escalates timing inconsistency warnings only in strict mode", async () => {
    const text = joinLines([
      "[#title] T",
      "[#voice:A]",
      "[---] v1.0",
      "",
      "[00:00.000+200][#timing]A<100>",
      "[00:00.500]tail",
    ]);
    const expectedByMode = {
      Strict: { status: "Abort", action: "abort", texts: ["A"] },
      Standard: { status: "Success", action: "continue", texts: ["A", "tail"] },
      Loose: { status: "Success", action: "continue", texts: ["A", "tail"] },
    };

    for (const mode of MODES) {
      const { result, errors, warnings } = await parseWith(mode, text);

      expect(result.status).toBe(expectedByMode[mode].status);
      expect(result.lines.map((line) => line.text)).toEqual(expectedByMode[mode].texts);
      expect(errors).toHaveLength(0);
      expect(warnings[0]).toMatchObject({
        Name: "TimingInconsistent",
        Mode: mode,
        Action: expectedByMode[mode].action,
        Line: 5,
        LineTag: "00:00.000+200",
        TimeMs: 0,
      });
    }
  });
});
