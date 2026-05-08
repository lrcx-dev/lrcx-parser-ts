import { describe, expect, test } from "@jest/globals";
import { joinLines, MODES, parseWith } from "./helpers/lrcx-test-helpers.mjs";

describe("LRCX baseline diagnostics", () => {
  test("returns InvalidFile for documents without the required separator line", async () => {
    const text = joinLines([
      "[#title] T",
      "[00:00.000]hello",
    ]);

    for (const mode of MODES) {
      const { result, errors, warnings } = await parseWith(mode, text);

      expect(result.status).toBe("Abort");
      expect(result.lines).toHaveLength(0);
      expect(warnings).toHaveLength(0);
      expect(errors[0]).toMatchObject({
        Name: "InvalidFile",
        Phase: "global",
        Mode: mode,
        Action: "abort",
        Desc: "Missing [---] v1.0 separator line",
      });
    }
  });

  test("returns VersionUnmatch for unsupported separator versions with exact source coordinates", async () => {
    const text = joinLines([
      "[#title] T",
      "[---] v2.0",
      "",
      "[00:00.000]hello",
    ]);

    for (const mode of MODES) {
      const { result, errors } = await parseWith(mode, text);

      expect(result.status).toBe("Abort");
      expect(errors[0]).toMatchObject({
        Name: "VersionUnmatch",
        Phase: "global",
        Section: "global",
        Mode: mode,
        Action: "abort",
        Line: 2,
        Column: 1,
        RawLine: "[---] v2.0",
        Snippet: "[---] v2.0",
      });
    }
  });

  test("returns head-stage diagnostics for malformed or undeclared head declarations without throwing", async () => {
    const malformedHead = joinLines([
      "[#title T",
      "[---] v1.0",
      "",
      "[00:00.000]hello",
    ]);
    const undeclaredOption = joinLines([
      "[#title] T",
      "[#option:energy.level] high",
      "[---] v1.0",
      "",
      "[00:00.000]hello",
    ]);

    for (const mode of MODES) {
      const malformed = await parseWith(mode, malformedHead);
      expect(malformed.result.status).toBe("Abort");
      expect(malformed.errors[0]).toMatchObject({
        Name: "InvalidLine",
        Phase: "head",
        Section: "head",
        Mode: mode,
        Action: "abort",
        Line: 1,
        Column: 1,
        RawLine: "[#title T",
      });

      const option = await parseWith(mode, undeclaredOption);
      expect(option.result.status).toBe("Abort");
      expect(option.errors[0]).toMatchObject({
        Name: "MarkNotFound",
        Phase: "head",
        Section: "head",
        Mode: mode,
        Action: "abort",
        Line: 2,
        Desc: "Option target is not declared: energy.level",
      });
    }
  });
});
