import { pierceGet, pierceSet, is_Object, is_PlainObject } from "./utils.js";
import { LRCXSystemTags, LyricParseStatus, LyricResolveMode } from "./lrcx-type.js";
import type {
  LRCXError,
  LRCXErrorDefinition,
  LRCXInstance,
  LRCXModeAction,
  LRCXSourceLocation,
  LyricLineContent,
  LyricPhonetic,
  LyricTimingRange,
  LyricTimingToken,
  SongInfo,
} from "./lrcx-type.js";

const ACTION_ABORT_ALL: Record<LyricResolveMode, LRCXModeAction> = {
  Strict: "abort",
  Standard: "abort",
  Loose: "abort",
};

const ACTION_BODY_STOP: Record<LyricResolveMode, LRCXModeAction> = {
  Strict: "abort",
  Standard: "partial",
  Loose: "skip",
};

const ACTION_BODY_CONFLICT: Record<LyricResolveMode, LRCXModeAction> = {
  Strict: "abort",
  Standard: "partial",
  Loose: "keep-first",
};

const ACTION_WARN_CONTINUE: Record<LyricResolveMode, LRCXModeAction> = {
  Strict: "continue",
  Standard: "continue",
  Loose: "continue",
};

const ACTION_MARK_UNKNOWN: Record<LyricResolveMode, LRCXModeAction> = {
  Strict: "abort",
  Standard: "partial",
  Loose: "continue",
};

export const LRCXErrorTypes = {
  INVALID_FILE: {
    Key: "INVALID_FILE",
    Name: "InvalidFile",
    Code: 1001,
    Fatal: true,
    Desc: "Invalid LRCX file format",
    Severity: "error",
    Actions: ACTION_ABORT_ALL,
  },
  VERSION_UNMATCH: {
    Key: "VERSION_UNMATCH",
    Name: "VersionUnmatch",
    Code: 1002,
    Fatal: true,
    Desc: "LRCX version not supported",
    Severity: "error",
    Actions: ACTION_ABORT_ALL,
  },
  MULTIPLE_SEPARATOR: {
    Key: "MULTIPLE_SEPARATOR",
    Name: "MultipleSeparator",
    Code: 1003,
    Fatal: true,
    Desc: "Multiple version separator lines are not allowed",
    Severity: "error",
    Actions: ACTION_ABORT_ALL,
  },
  INVALID_LINE: {
    Key: "INVALID_LINE",
    Name: "InvalidLine",
    Code: 2001,
    Fatal: true,
    Desc: "Invalid line format",
    Severity: "error",
    Actions: ACTION_BODY_STOP,
  },
  INVALID_RANGE: {
    Key: "INVALID_RANGE",
    Name: "InvalidRange",
    Code: 2002,
    Fatal: true,
    Desc: "Target range is invalid",
    Severity: "error",
    Actions: ACTION_BODY_STOP,
  },
  INVALID_DURATION: {
    Key: "INVALID_DURATION",
    Name: "InvalidDuration",
    Code: 2003,
    Fatal: true,
    Desc: "Duration value is invalid",
    Severity: "error",
    Actions: ACTION_BODY_STOP,
  },
  INVALID_REFERENCE: {
    Key: "INVALID_REFERENCE",
    Name: "InvalidReference",
    Code: 2004,
    Fatal: true,
    Desc: "Reference target is invalid or unresolved",
    Severity: "error",
    Actions: ACTION_BODY_STOP,
  },
  SYNTAX_ERROR: {
    Key: "SYNTAX_ERROR",
    Name: "SyntaxError",
    Code: 3001,
    Fatal: true,
    Desc: "Syntax error in line content",
    Severity: "error",
    Actions: ACTION_BODY_STOP,
  },
  UNSUPPORTED_ACCURACY: {
    Key: "UNSUPPORTED_ACCURACY",
    Name: "UnsupportedAccuracy",
    Code: 3002,
    Fatal: true,
    Desc: "Unsupported time accuracy",
    Severity: "error",
    Actions: ACTION_BODY_STOP,
  },
  UNKNOWN_EASING: {
    Key: "UNKNOWN_EASING",
    Name: "UnknownEasing",
    Code: 3003,
    Fatal: true,
    Desc: "Unknown easing function",
    Severity: "error",
    Actions: ACTION_BODY_STOP,
  },
  NONSEQUENTIAL: {
    Key: "NONSEQUENTIAL",
    Name: "Nonsequential",
    Code: 4001,
    Fatal: false,
    Desc: "Non-sequential time tags",
    Severity: "warning",
    Actions: {
      Strict: "abort",
      Standard: "continue",
      Loose: "continue",
    },
  },
  NON_IDENTICAL_LINE: {
    Key: "NON_IDENTICAL_LINE",
    Name: "NonIdenticalLine",
    Code: 4002,
    Fatal: true,
    Desc: "Non-identical multi-line content",
    Severity: "error",
    Actions: ACTION_BODY_CONFLICT,
  },
  MARK_REDUNDANT: {
    Key: "MARK_REDUNDANT",
    Name: "MarkRedundant",
    Code: 4003,
    Fatal: false,
    Desc: "Tag is already declared and will be overwritten",
    Severity: "warning",
    Actions: {
      Strict: "abort",
      Standard: "continue",
      Loose: "continue",
    },
  },
  MARK_NOTFOUND: {
    Key: "MARK_NOTFOUND",
    Name: "MarkNotFound",
    Code: 4004,
    Fatal: true,
    Desc: "Tag is not declared",
    Severity: "error",
    Actions: ACTION_MARK_UNKNOWN,
  },
  OPTION_UNMATCH: {
    Key: "OPTION_UNMATCH",
    Name: "UnmatchedOption",
    Code: 4005,
    Fatal: false,
    Desc: "Tag option number does not match the declarations",
    Severity: "warning",
    Actions: ACTION_WARN_CONTINUE,
  },
  UNKNOWN_MARK: {
    Key: "UNKNOWN_MARK",
    Name: "UnknownMark",
    Code: 9001,
    Fatal: false,
    Desc: "Unknown or unsupported mark",
    Severity: "warning",
    Actions: ACTION_WARN_CONTINUE,
  },
  INFERIOR_BESIER: {
    Key: "INFERIOR_BESIER",
    Name: "InferiorBesier",
    Code: 9002,
    Fatal: false,
    Desc: "Bezier curve with more than 7 control points may affect performance",
    Severity: "warning",
    Actions: ACTION_WARN_CONTINUE,
  },
  UNKNOWN_PHENOTIC: {
    Key: "UNKNOWN_PHENOTIC",
    Name: "UnknownPhonetic",
    Code: 9003,
    Fatal: false,
    Desc: "Valid phonetic options are '' | 'brief' | 'full' | 'supermark'",
    Severity: "warning",
    Actions: ACTION_WARN_CONTINUE,
  },
  UNKNOWN_MAINMARK: {
    Key: "UNKNOWN_MAINMARK",
    Name: "UnknownMainMark",
    Code: 9004,
    Fatal: false,
    Desc: "Main track mark is unknown",
    Severity: "warning",
    Actions: ACTION_WARN_CONTINUE,
  },
  RETYPE_ERROR: {
    Key: "RETYPE_ERROR",
    Name: "RetypeError",
    Code: 7001,
    Fatal: true,
    Desc: "Conflicting main track tags found in one line",
    Severity: "error",
    Actions: ACTION_BODY_CONFLICT,
  },
  BLANK_LINE: {
    Key: "BLANK_LINE",
    Name: "BlankLine",
    Code: 7002,
    Fatal: false,
    Desc: "Blank line detected",
    Severity: "warning",
    Actions: ACTION_WARN_CONTINUE,
  },
  TIMING_INCONSISTENT: {
    Key: "TIMING_INCONSISTENT",
    Name: "TimingInconsistent",
    Code: 7003,
    Fatal: false,
    Desc: "Explicit line duration does not match inferred timing duration",
    Severity: "warning",
    Actions: {
      Strict: "abort",
      Standard: "continue",
      Loose: "continue",
    },
  },
} as const satisfies Record<string, LRCXErrorDefinition>;

export type LRCXErrorTypeKey = keyof typeof LRCXErrorTypes;

export interface LRCXErrorCreateOptions {
  action?: LRCXModeAction;
  desc?: string;
  fatal?: boolean;
  location?: LRCXSourceLocation;
  mode?: LyricResolveMode;
  phase?: "global" | "head" | "body" | "finalize";
  lineTag?: string;
  timeMs?: number;
  lyricPosition?: LRCXError["LyricPosition"];
  meta?: Record<string, unknown>;
}

export interface ParsedLyricTime {
  time: number;
  precision: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

export interface ParsedTagExpression {
  raw: string;
  rawBase: string;
  normalizedBase: string;
  path: string[];
  argText: string;
  hasArg: boolean;
  args: string[];
}

export function createLRCXError(
  errorType: LRCXErrorDefinition,
  options: LRCXErrorCreateOptions = {},
): LRCXError {
  const location = options.location;
  return {
    Name: errorType.Name,
    Code: errorType.Code,
    Fatal:
      options.fatal ??
      (options.action === "abort" || options.action === "partial"
        ? true
        : errorType.Fatal),
    Desc: options.desc ?? errorType.Desc,
    Key: errorType.Key,
    Severity: errorType.Severity,
    Phase: options.phase,
    Mode: options.mode,
    Action: options.action,
    Section: location?.section,
    Line: location?.line,
    Column: location?.column,
    EndColumn: location?.endColumn,
    Offset: location?.offset,
    Length: location?.length,
    RawLine: location?.rawLine,
    Snippet: location?.snippet,
    TimeMs: options.timeMs,
    LineTag: options.lineTag,
    LyricPosition: options.lyricPosition,
    Meta: options.meta,
  };
}

export function parseLyricTimeDetailed(timeTag: string): ParsedLyricTime | null {
  const trimmed = timeTag.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(":");
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }

  const hasHours = parts.length === 3;
  const hours = hasHours ? Number(parts[0]) : 0;
  const minutes = Number(parts[hasHours ? 1 : 0]);
  const secondPart = parts[hasHours ? 2 : 1];
  const match = secondPart.match(/^(\d+)(?:\.(\d+))?$/);

  if (!match) {
    return null;
  }

  const seconds = Number(match[1]);
  const fraction = match[2] ?? "";
  const precision = fraction.length;
  const milliseconds = Number((fraction + "000").slice(0, 3));

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    Number.isNaN(seconds) ||
    hours < 0 ||
    minutes < 0 ||
    seconds < 0 ||
    seconds >= 60 ||
    (hasHours && minutes >= 60)
  ) {
    return null;
  }

  return {
    time: (((hours * 60) + minutes) * 60 + seconds) * 1000 + milliseconds,
    precision,
    hours,
    minutes,
    seconds,
    milliseconds,
  };
}

export function parseLyricTime(
  timeTag: string,
  _workmode?: LyricResolveMode,
): -1 | number {
  const parsed = parseLyricTimeDetailed(timeTag);
  return parsed ? parsed.time : -1;
}

function splitSeparatedValues(
  content: string,
  separator: string,
  trimItem = true,
): string[] {
  const parts: string[] = [];
  let current = "";
  let inEscape = false;
  let quote = "";

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (inEscape) {
      current += char;
      inEscape = false;
      continue;
    }
    if (char === "\\") {
      inEscape = true;
      continue;
    }
    if ((char === '"' || char === "'") && quote === "") {
      quote = char;
      current += char;
      continue;
    }
    if (char === quote) {
      quote = "";
      current += char;
      continue;
    }
    if (char === separator && quote === "") {
      parts.push(trimItem ? current.trim() : current);
      current = "";
      continue;
    }
    current += char;
  }

  parts.push(trimItem ? current.trim() : current);
  return parts;
}

export function splitByComma(str: string, byChar = ","): string[] {
  return splitSeparatedValues(str, byChar);
}

export function formatLyricTimeTag(
  time: number,
  duration?: number,
  easing?: string,
): string {
  const ms = Math.max(0, Math.floor(time % 1000));
  const totalSeconds = Math.floor(time / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  let tag = "";
  if (hours > 0) {
    tag += `${hours.toString().padStart(2, "0")}:`;
  }
  tag += `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;

  if (duration !== undefined) {
    tag += `+${duration}`;
    if (easing) {
      tag += `:${easing}`;
    }
  }

  return `[${tag}]`;
}

function createLrcxSongInfo(): SongInfo {
  return {
    title: "",
    titleProps: {
      cover: "",
      version: "",
      feat: [],
      explicit: false,
      notes: [],
    },
    album: "",
    artist: [],
    composer: [],
    lyricist: [],
    arranger: [],
    recording: [],
    mixing: [],
    mastering: [],
    instrumentalists: [],
    producer: [],
    more: {},
  };
}

export function createLrcxIns(): LRCXInstance {
  return {
    status: LyricParseStatus.Success,
    mode: LyricResolveMode.Standard,
    marks: [],
    marksOpt: {},
    trans: [],
    phonetic: [],
    voice: [],
    easing: {},
    lyricInfo: {
      by: {
        "": [],
      },
    },
    songInfo: createLrcxSongInfo(),
    lyricComment: {
      note: {
        "": "",
        by: {
          "": "",
        },
      },
    },
    lineTags: [],
    times: [],
    ends: [],
    lines: [],
    offset: 0,
  };
}

export function createLrcxLine(text = ""): LyricLineContent {
  return {
    text,
    timing: undefined,
    trans: {
      "": "",
    },
    phonetic: [],
    back: undefined,
    marks: [],
    hangings: [],
    attr: undefined,
  };
}

export function resolveOption(
  tagParts: string[],
  tagContent: string,
  targetObj: object,
  processer?: (val: string, tagPath: string[]) => string,
  options: {
    allowShort?: boolean;
  } = {},
): boolean {
  const rawValues = tagContent.trim() ? splitCommaValues(tagContent) : [];
  const values = rawValues.length === 0 ? new Array(tagParts.length).fill("") : rawValues.slice(0, tagParts.length);
  while (values.length < tagParts.length) {
    values.push("");
  }

  for (let index = 0; index < tagParts.length; index += 1) {
    const tagPathes = tagParts[index].split(".").map((part) => part.trim()).filter(Boolean);
    let value = values[index] ?? "";
    if (processer) {
      value = processer(value, tagPathes);
    }
    pierceSet(targetObj as Record<string, any>, [...tagPathes, ""], value);
  }

  if (rawValues.length === 0 || rawValues.length === tagParts.length) {
    return true;
  }
  return Boolean(options.allowShort && rawValues.length < tagParts.length);
}

export function setLRCXOptStruct(
  targetObj: object,
  tagPathes: string[],
  value: string | number | Array<string | number>,
): boolean {
  return pierceSet(targetObj as Record<string, any>, [...tagPathes, ""], value);
}

export function getLRCXOptStruct(targetObj: object, tagPathes: string[]): unknown {
  return pierceGet(targetObj as Record<string, any>, [...tagPathes, ""]);
}

export function splitCommaValues(content: string): string[] {
  return splitSeparatedValues(content, ",");
}

export function parseTagExpression(inner: string): ParsedTagExpression {
  const raw = inner.trim();
  const payload = raw.startsWith("#") ? raw.slice(1).trim() : raw;
  const colonIndex = payload.indexOf(":");
  const pathText = (colonIndex === -1 ? payload : payload.slice(0, colonIndex)).trim();
  const argText = colonIndex === -1 ? "" : payload.slice(colonIndex + 1).trim();
  const path = pathText
    ? pathText
        .split(".")
        .map((part) => part.trim())
        .filter(Boolean)
    : [];

  return {
    raw,
    rawBase: path[0] ?? "",
    normalizedBase: (path[0] ?? "").toLowerCase(),
    path,
    argText,
    hasArg: colonIndex !== -1,
    args: argText ? splitByComma(argText) : [],
  };
}

export function unescapeLrcxText(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\" && index + 1 < text.length) {
      result += text[index + 1];
      index += 1;
      continue;
    }
    result += char;
  }
  return result;
}

export function flattenOptionTree(
  base: string,
  tree: unknown,
  output: Record<string, string> = {},
): Record<string, string> {
  if (!is_PlainObject(tree)) {
    return output;
  }

  for (const [key, value] of Object.entries(tree)) {
    if (key === "") {
      continue;
    }
    const fullKey = `${base}.${key}`;
    if (is_PlainObject(value)) {
      const ownValue = (value as Record<string, unknown>)[""];
      if (typeof ownValue === "string") {
        output[fullKey] = ownValue;
      }
      flattenOptionTree(fullKey, value, output);
    }
  }
  return output;
}

export function cloneTimingRanges(
  ranges: LyricTimingRange[] | undefined,
): LyricTimingRange[] | undefined {
  return ranges?.map((range) => ({ ...range }));
}

export function cloneTimingTokens(
  tokens: LyricTimingToken[] | undefined,
): LyricTimingToken[] | undefined {
  return tokens?.map((token) => ({ ...token }));
}

export function cloneLyricPhonetic(phonetic: LyricPhonetic): LyricPhonetic {
  if (phonetic.type === "supermark") {
    return {
      ...phonetic,
      parts: phonetic.parts.map((part) => ({ ...part })),
    };
  }
  return {
    ...phonetic,
    timing: phonetic.timing.map((timing) => ({ ...timing })) as any,
  };
}

export function cloneLyricLineContent(line: LyricLineContent): LyricLineContent {
  const hangings = line.hangings.map((hanging) => {
    const cloned = {
      raw: hanging.raw,
      text: hanging.text,
      marks: [...hanging.marks],
    } as LyricLineContent["hangings"][number];
    if (hanging.attr) {
      cloned.attr = { ...hanging.attr };
    }
    if (hanging.values) {
      cloned.values = [...hanging.values];
    }
    return cloned;
  });

  return {
    text: line.text,
    timing: cloneTimingRanges(line.timing),
    trans: { ...line.trans },
    phonetic: line.phonetic.map(cloneLyricPhonetic),
    back: line.back?.map((track) => track.map((token) => ({ ...token }))),
    marks: [...line.marks],
    hangings,
    attr: line.attr ? { ...line.attr } : undefined,
  };
}

export function timingTokenToRange(
  tTokens: LyricTimingToken[],
  lineBeginTime: number,
): LyricTimingRange[] {
  const result: LyricTimingRange[] = [];
  for (const tToken of tTokens) {
    const timingRange = {
      start: tToken.begin - lineBeginTime,
      duration: tToken.end - tToken.begin,
      token: tToken.token,
    };
    if (timingRange.duration >= 0) {
      result.push(timingRange);
    }
  }
  return result;
}

export function isBuiltinSystemTag(tag: string): boolean {
  return (LRCXSystemTags as readonly string[]).includes(tag.toLowerCase());
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return is_Object(value);
}


