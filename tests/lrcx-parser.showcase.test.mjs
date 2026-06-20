import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  joinLines,
  loadParserModule,
  parseShowcase,
  parseWith,
} from "./helpers/lrcx-test-helpers.mjs";

let showcaseParse;

beforeAll(async () => {
  showcaseParse = await parseShowcase();
});

describe("LRCX showcase draft compliance", () => {
  test("exposes only the intended public parser surface", async () => {
    const mod = await loadParserModule();

    expect(mod.LRCXParserBase).toBeInstanceOf(Function);
    expect(mod.LRCXStrictParser).toBeInstanceOf(Function);
    expect(mod.LRCXStandardParser).toBeInstanceOf(Function);
    expect(mod.LRCXLooseParser).toBeInstanceOf(Function);
    expect(mod.createLRCXParser).toBeInstanceOf(Function);
    expect(mod.parseLRCX).toBeInstanceOf(Function);
    expect(mod.LyricResolveMode.Standard).toBe("Standard");
    expect(mod.LyricParseStatus.Success).toBe("Success");
    expect(mod.createLRCXError).toBeUndefined();
    expect(mod.splitByComma).toBeUndefined();
    expect(mod.flattenOptionTree).toBeUndefined();
  });

  test("parses HEAD metadata, declarations and option defaults from the showcase draft", () => {
    const { mod, parser, result, errors, warnings } = showcaseParse;

    expect(result.status).toBe(mod.LyricParseStatus.Success);
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(4);

    expect(result.songInfo).toMatchObject({
      title: "夏霞",
      album: "夏霞",
      artist: ["あたらよ"],
      lyricist: ["ひとみ"],
      composer: ["ひとみ"],
      more: {
        titlesort: "Natsugasumi",
        artistsort: "Atarayo",
        date: "2021-08-11",
        releasetype: "single",
        label: "あたらよRecords",
        copyright: "℗ あたらよRecords",
        language: "ja",
      },
    });
    expect(result.offset).toBe(550);
    expect(result.voice).toEqual(["A", "B", "C"]);
    expect(result.trans).toEqual(["zh", "en"]);
    expect(result.phonetic).toEqual(["pho1", "romaji", "romaji_full"]);
    expect(result.marks).toEqual(["chorus", "energy"]);
    expect(result.lyricInfo.by).toEqual({ "": ["loyuri"] });
    expect(result.lyricComment.note).toEqual({
      "": "Copyright reserved by XXX.",
      by: { "": "annoymouse" },
    });
    expect(result.easing).toEqual({
      eo1: {
        x: [0.25, 0.75],
        y: [0, 1],
      },
      eo3: {
        x: [0.1, 0.6],
        y: [0.7, 1],
      },
    });
    expect(parser.readOpt("energy.level")).toBe("high");
    expect(parser.readOpt("chorus.role")).toBe("hook");
    expect(parser.readOpt("romaji")).toBe("supermark");
    expect(parser.readOpt("romaji_full")).toBe("full");
  });

  test("assembles BODY groups, derived tracks, back vocals and references from the showcase draft", () => {
    const { result, warnings } = showcaseParse;
    const [
      opening,
      chorusLead,
      verse,
      bridge,
      backVocalLine,
      chant,
      sourceLine,
      referenceLine,
    ] = result.lines;

    expect(result.lineTags).toEqual([
      "00:00.164+1786",
      "00:20.339+7945",
      "00:57.765+5184",
      "01:45.269+6384",
      "02:09.719+8016",
      "02:28.843+8010",
      "02:37.502+2119",
      "02:39.901+2032",
    ]);
    expect(result.times).toEqual([
      164,
      20339,
      57765,
      105269,
      129719,
      148843,
      157502,
      159901,
    ]);
    expect(result.ends).toEqual([
      1950,
      28284,
      62949,
      111653,
      137735,
      156853,
      159621,
      161933,
    ]);

    expect(opening.text).toBe("夏霞 - あたらよ");
    expect(opening.marks).toEqual(["A"]);
    expect(opening.timing).toHaveLength(7);
    expect(opening.timing?.[0]).toMatchObject({ start: 0, duration: 377, token: "夏" });
    expect(opening.timing?.[1]).toMatchObject({ start: 377, duration: 491, token: "霞" });
    expect(opening.timing?.[2]).toMatchObject({ start: 868, duration: 100, token: " - " });

    expect(chorusLead).toMatchObject({
      text: "空の青さに目を奪われて",
      marks: ["A", "chorus", "energy"],
      trans: {
        "": "",
        zh: "被湛蓝的天空 夺走了所有的视线",
        en: "My eyes were stolen by the blue of the sky",
      },
      attr: {
        "chorus.role": "hook",
        "energy.level": "high",
      },
    });
    expect(chorusLead.phonetic).toHaveLength(3);
    expect(chorusLead.phonetic[0]).toMatchObject({
      type: "brief",
      name: "pho1",
    });
    expect(chorusLead.phonetic[0]?.timing?.[0]).toMatchObject({
      begin: 0,
      end: 240,
      token: "so ",
    });
    expect(chorusLead.phonetic[0]?.timing?.[1]).toMatchObject({
      begin: 240,
      end: 584,
      token: "ra ",
    });
    expect(chorusLead.phonetic[1]).toMatchObject({
      type: "supermark",
      name: "romaji",
    });
    expect(chorusLead.phonetic[1]?.parts?.[0]).toMatchObject({
      offset: 0,
      len: 1,
      token: "so ra",
    });
    expect(chorusLead.phonetic[1]?.parts?.[1]).toMatchObject({
      offset: 2,
      len: 1,
      token: "a o",
    });
    expect(chorusLead.phonetic[2]).toMatchObject({
      type: "full",
      name: "romaji_full",
    });
    expect(chorusLead.phonetic[2]?.timing?.[0]).toMatchObject({
      start: 0,
      duration: 240,
      token: "so",
    });
    expect(chorusLead.phonetic[2]?.timing?.[1]).toMatchObject({
      start: 240,
      duration: 344,
      token: " ra",
    });

    expect(verse).toMatchObject({
      text: "ねぇ 今更になって思い出す",
      marks: ["A"],
      trans: {
        "": "",
        zh: "呐 事到如今才回想起",
      },
    });

    expect(bridge.timing).toHaveLength(4);
    expect(bridge.timing?.[0]).toMatchObject({
      start: 0,
      duration: 1912,
      token: "今更",
      easing: "eo1",
    });
    expect(bridge.timing?.[1]).toMatchObject({
      start: 1912,
      duration: 424,
      token: " ",
    });
    expect(bridge.timing?.[2]).toMatchObject({
      start: 2336,
      duration: 1785,
      token: "思い",
      easing: "eo1",
    });
    expect(bridge.timing?.[3]).toMatchObject({
      start: 4121,
      duration: 2263,
      token: "出すなよ",
      easing: "eo3",
    });

    expect(backVocalLine.back).toHaveLength(2);
    expect(backVocalLine.back?.[0]?.[0]).toMatchObject({
      begin: 2853,
      end: 3756,
      token: "き",
    });
    expect(backVocalLine.back?.[1]?.[0]).toMatchObject({
      begin: 7469,
      end: 8353,
      token: "ぼ",
    });

    expect(chant).toMatchObject({
      text: "Wu~~~ Wu~~ Oh~ Yeah~~~!",
      marks: ["A"],
    });
    expect(chant.hangings).toEqual([
      {
        raw: "[#ignore]本行用于词测试异常，#timing行与主行内容空格不一致。正确的#timin行如下：",
        text: "本行用于词测试异常，#timing行与主行内容空格不一致。正确的#timin行如下：",
        marks: ["ignore"],
      },
      {
        raw: "[#ignore][#timing]Wu~~~<3612> <360>Wu~~<1378> <396>Oh~ <548>Yeah~~~!<1716>",
        text: "Wu~~~<3612> <360>Wu~~<1378> <396>Oh~ <548>Yeah~~~!<1716>",
        marks: ["ignore", "timing"],
      },
    ]);

    expect(referenceLine).toMatchObject({
      text: "きっと今なら",
      marks: ["A"],
      attr: { ref: "02:37.502" },
      trans: {
        "": "",
        zh: "如今 定已明白",
      },
    });
    expect(referenceLine.timing).toEqual(sourceLine.timing);
    expect(referenceLine.back).toBeUndefined();

    expect(warnings.map((warning) => [warning.Name, warning.Line, warning.Action])).toEqual([
      ["TimingInconsistent", 25, "continue"],
      ["TimingInconsistent", 33, "continue"],
      ["TimingInconsistent", 46, "continue"],
      ["TimingInconsistent", 57, "continue"],
    ]);
  });

  test("reuses only reference-safe tracks and keeps explicit tags local to the reference line", async () => {
    const text = joinLines([
      "[#title] T",
      "[#voice:A,B]",
      "[#trans:zh] 中文",
      "[#phonetic:romaji_full] full",
      "[---] v1.0",
      "",
      "[00:00.000+600][#B]前文",
      "[00:00.000+600][#timing]前<300>文<300>",
      "[00:00.000+600][#zh]source zh",
      "[00:00.000+600][#romaji_full]zen<300> bun<300>",
      "[00:00.000+600][#back:120]啊<200>哦<200>",
      "[00:01.000+600][#ref:00:00.000][#A]",
      "[00:01.000+600][#back:50]和<150>声<150>",
    ]);
    const { result, errors } = await parseWith("Standard", text);

    expect(result.status).toBe("Success");
    expect(errors).toHaveLength(0);

    const source = result.lines[0];
    const reference = result.lines[1];

    expect(source.marks).toEqual(["B"]);
    expect(source.back).toHaveLength(1);

    expect(reference).toMatchObject({
      text: "前文",
      marks: ["A"],
      attr: { ref: "00:00.000" },
      trans: {
        "": "",
        zh: "source zh",
      },
    });
    expect(reference.timing).toEqual(source.timing);
    expect(reference.phonetic).toEqual(source.phonetic);
    expect(reference.back).toEqual([
      [
        { begin: 50, end: 200, token: "和" },
        { begin: 200, end: 350, token: "声" },
      ],
    ]);
  });
});
