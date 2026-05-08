import { describe, expect, test } from "@jest/globals";
import {
  joinLines,
  parseShowcase,
  parseWith,
} from "./helpers/lrcx-test-helpers.mjs";

describe("LRCX serializer", () => {
  test("exports the serializer and keeps the showcase instance stable after round-trip", async () => {
    const showcase = await parseShowcase();
    const { mod, result } = showcase;

    expect(mod.serializeLRCX).toBeInstanceOf(Function);
    expect(mod.stringifyLRCX).toBe(mod.serializeLRCX);

    const serialized = mod.serializeLRCX(result);
    const reparsed = await parseWith("Standard", serialized);

    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.result).toEqual(result);
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
    expect(reparsed.result).toEqual(parsed.result);
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
    expect(serialized).toContain("[00:01.000+600][#A]Source");
    expect(serialized).toContain("[00:01.000+600][#zh]local zh");
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
    expect(reparsed.result).toEqual(parsed.result);
  });
});
