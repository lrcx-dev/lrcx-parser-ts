import { describe, expect, test } from "@jest/globals";
import {
  joinLines,
  parseShowcase,
  parseWith,
} from "./helpers/lrcx-test-helpers.mjs";

function expectSameRoundTripContent(actual, expected) {
  expect(actual).toEqual({
    ...expected,
    ends: actual.ends,
    lineTags: actual.lineTags,
  });
}

describe("LRCX serializer", () => {
  test("exports the serializer and keeps the showcase content stable after round-trip", async () => {
    const showcase = await parseShowcase();
    const { mod, result } = showcase;

    expect(mod.serializeLRCX).toBeInstanceOf(Function);
    expect(mod.stringifyLRCX).toBe(mod.serializeLRCX);

    const serialized = mod.serializeLRCX(result);
    const reparsed = await parseWith("Standard", serialized);

    expect(reparsed.errors).toHaveLength(0);
    expectSameRoundTripContent(reparsed.result, result);
  });

  test("omits line duration for serialized timing rows unless the option is enabled", async () => {
    const text = joinLines([
      "[#title] T",
      "[---] v1.0",
      "",
      "[00:01.000+600]Source",
      "[00:01.000+600][#timing]So<300>urce<300>",
    ]);

    const parsed = await parseWith("Standard", text);
    const serialized = parsed.mod.serializeLRCX(parsed.result);
    const verbose = parsed.mod.serializeLRCX(parsed.result, {
      includeLineDurationWithTiming: true,
    });
    const reparsed = await parseWith("Standard", serialized);

    expect(serialized).toContain("[00:01.000]Source");
    expect(serialized).toContain("[00:01.000][#timing]So<300>urce<300>");
    expect(serialized).not.toContain("[00:01.000+600]");
    expect(verbose).toContain("[00:01.000+600]Source");
    expect(verbose).toContain("[00:01.000+600][#timing]So<300>urce<300>");
    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.result.ends).toEqual(parsed.result.ends);
    expectSameRoundTripContent(reparsed.result, parsed.result);
  });

  test("keeps reference lines compact when local additions do not conflict with inherited tracks", async () => {
    const text = joinLines([
      "[#title] T",
      "[#voice:A]",
      "[#trans:zh,en] Chinese, English",
      "[#phonetic:romaji_full] full",
      "[---] v1.0",
      "",
      "[00:00.000+600]Source",
      "[00:00.000+600][#timing]So<300>urce<300>",
      "[00:00.000+600][#zh]source zh",
      "[00:00.000+600][#romaji_full]so<300> urce<300>",
      "[00:01.000+600][#ref:00:00.000][#A]",
      "[00:01.000+600][#en]local en",
      "[00:01.000+600][#back:50]ha<150> rm<150>",
    ]);

    const parsed = await parseWith("Standard", text);
    const serialized = parsed.mod.serializeLRCX(parsed.result);
    const reparsed = await parseWith("Standard", serialized);

    expect(serialized).toContain("[00:01.000+600][#ref:00:00.000][#A]");
    expect(serialized).toContain("[00:01.000+600][#en]local en");
    expect(serialized).toContain("[00:01.000+600][#back:50]ha<150> rm<150>");
    expect(serialized).not.toContain("[00:01.000+600][#timing]");
    expect(serialized).not.toContain("[00:01.000+600][#romaji_full]");
    expect(reparsed.errors).toHaveLength(0);
    expectSameRoundTripContent(reparsed.result, parsed.result);
  });

  test("expands conflicting reference overrides instead of emitting an invalid shorthand ref line", async () => {
    const text = joinLines([
      "[#title] T",
      "[#voice:A]",
      "[#trans:zh] Chinese",
      "[#phonetic:romaji_full] full",
      "[---] v1.0",
      "",
      "[00:00.000+600]Source",
      "[00:00.000+600][#timing]So<300>urce<300>",
      "[00:00.000+600][#zh]source zh",
      "[00:00.000+600][#romaji_full]so<300> urce<300>",
      "[00:01.000+600][#ref:00:00.000][#A]",
      "[00:01.000+600][#zh]local zh",
    ]);

    const parsed = await parseWith("Standard", text);
    expect(parsed.result.status).toBe("Partial");

    const serialized = parsed.mod.serializeLRCX(parsed.result);
    const reparsed = await parseWith("Standard", serialized);

    expect(serialized).not.toContain("[00:01.000+600][#ref:00:00.000][#A]");
    expect(serialized).toContain("[00:01.000][#A]Source");
    expect(serialized).toContain("[00:01.000][#timing]So<300>urce<300>");
    expect(serialized).toContain("[00:01.000][#zh]local zh");
    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.result.status).toBe("Success");
    expect(reparsed.result.lines[1]).toMatchObject({
      text: parsed.result.lines[1].text,
      marks: parsed.result.lines[1].marks,
      trans: parsed.result.lines[1].trans,
    });
  });

  test("serializes generic translations without emitting a HEAD declaration and escapes plain body text", async () => {
    const text = joinLines([
      "[#title] T",
      "[---] v1.0",
      "",
      "[00:00.000]A[<^>\\\\]B",
      "[00:00.000][#trans]T[<^>\\\\]R",
    ]);

    const parsed = await parseWith("Standard", text);
    const serialized = parsed.mod.serializeLRCX(parsed.result);
    const reparsed = await parseWith("Standard", serialized);
    const [head] = serialized.split("[---] v1.0");

    expect(head).not.toContain("[#trans");
    expect(head.trim()).toBe("[#title] T");
    expect(serialized).toContain("[00:00.000]A\\[\\<\\^\\>\\\\\\]B");
    expect(serialized).toContain("[00:00.000][#trans]T\\[\\<\\^\\>\\\\\\]R");
    expect(reparsed.errors).toHaveLength(0);
    expectSameRoundTripContent(reparsed.result, parsed.result);
  });
});
