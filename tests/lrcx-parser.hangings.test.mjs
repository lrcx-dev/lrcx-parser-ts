import { describe, expect, test } from "@jest/globals";
import { joinLines, MODES, parseWith } from "./helpers/lrcx-test-helpers.mjs";

describe("LRCX hanging lines", () => {
  test("#ignore preserves undeclared tag information without affecting standard tracks", async () => {
    const text = joinLines([
      "[#title] T",
      "[---] v1.0",
      "",
      "[00:00.000][#ignore][#ghost.foo:bar]raw \\[note\\]",
    ]);

    for (const mode of MODES) {
      const { result, errors, warnings } = await parseWith(mode, text);

      expect(result.status).toBe("Success");
      expect(errors).toHaveLength(0);
      expect(warnings).toHaveLength(0);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toMatchObject({
        text: "",
        hangings: [
          {
            raw: "[#ignore][#ghost.foo:bar]raw \\[note\\]",
            text: "raw [note]",
            marks: ["ignore", "ghost"],
            attr: {
              "ghost.foo": "bar",
            },
          },
        ],
      });
    }
  });

  test("#append stores declared hanging tags, flat attributes and sparse anonymous values", async () => {
    const text = joinLines([
      "[#title] T",
      "[#marks:energy,custom] energy,custom",
      "[---] v1.0",
      "",
      "[00:00.000][#append][#custom][#energy.level:low][#append.0:first][#append.2:third]payload",
    ]);

    const { result, errors } = await parseWith("Standard", text);
    const hanging = result.lines[0].hangings[0];

    expect(result.status).toBe("Success");
    expect(errors).toHaveLength(0);
    expect(result.lines[0].text).toBe("");
    expect(hanging).toMatchObject({
      raw: "[#append][#custom][#energy.level:low][#append.0:first][#append.2:third]payload",
      text: "payload",
      marks: ["append", "custom", "energy", "append", "append"],
      attr: {
        "energy.level": "low",
      },
    });
    expect(hanging.values).toHaveLength(3);
    expect(hanging.values[0]).toBe("first");
    expect(hanging.values[1]).toBeUndefined();
    expect(hanging.values[2]).toBe("third");
  });

  test("#append still validates undeclared non-ignore tags according to parser mode", async () => {
    const text = joinLines([
      "[#title] T",
      "[---] v1.0",
      "",
      "[00:00.000][#append][#ghost]payload",
      "[00:00.500]tail",
    ]);
    const expectedByMode = {
      Strict: { status: "Abort", action: "abort", lineCount: 0 },
      Standard: { status: "Abort", action: "partial", lineCount: 0 },
      Loose: { status: "Fragment", action: "continue", lineCount: 2 },
    };

    for (const mode of MODES) {
      const { result, errors } = await parseWith(mode, text);

      expect(result.status).toBe(expectedByMode[mode].status);
      expect(result.lines).toHaveLength(expectedByMode[mode].lineCount);
      expect(errors[0]).toMatchObject({
        Name: "MarkNotFound",
        Mode: mode,
        Action: expectedByMode[mode].action,
        Line: 4,
        LineTag: "00:00.000",
        TimeMs: 0,
      });
    }
  });

  test("#hidden applies to the lyric group except when it appears inside an #ignore row", async () => {
    const text = joinLines([
      "[#title] T",
      "[---] v1.0",
      "",
      "[00:00.000][#hidden]secret",
      "[00:00.000][#ignore][#hidden]comment",
    ]);

    const { result, errors } = await parseWith("Standard", text);

    expect(result.status).toBe("Success");
    expect(errors).toHaveLength(0);
    expect(result.lines[0]).toMatchObject({
      text: "secret",
      attr: {
        hidden: "true",
      },
      hangings: [
        {
          raw: "[#ignore][#hidden]comment",
          text: "comment",
          marks: ["ignore", "hidden"],
        },
      ],
    });
  });

  test("#ref does not inherit source hanging lines but keeps local hanging lines", async () => {
    const text = joinLines([
      "[#title] T",
      "[---] v1.0",
      "",
      "[00:00.000]source",
      "[00:00.000][#ignore]source note",
      "[00:01.000][#ref:00:00.000]",
      "[00:01.000][#ignore]local note",
    ]);

    const { result, errors } = await parseWith("Standard", text);

    expect(result.status).toBe("Success");
    expect(errors).toHaveLength(0);
    expect(result.lines[0].hangings).toEqual([
      {
        raw: "[#ignore]source note",
        text: "source note",
        marks: ["ignore"],
      },
    ]);
    expect(result.lines[1]).toMatchObject({
      text: "source",
      attr: {
        ref: "00:00.000",
      },
      hangings: [
        {
          raw: "[#ignore]local note",
          text: "local note",
          marks: ["ignore"],
        },
      ],
    });
  });
});
