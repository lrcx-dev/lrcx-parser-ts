export const LyricResolveMode = {
  Standard: "Standard",
  Strict: "Strict",
  Loose: "Loose",
} as const;

export type LyricResolveMode =
  (typeof LyricResolveMode)[keyof typeof LyricResolveMode];

export const LyricParseStatus = {
  Success: "Success",
  Partial: "Partial",
  Fragment: "Fragment",
  Abort: "Abort",
} as const;

export type LyricParseStatus =
  (typeof LyricParseStatus)[keyof typeof LyricParseStatus];

export type LRCXDiagnosticSeverity = "error" | "warning";
export type LRCXParsePhase = "global" | "head" | "body" | "finalize";
export type LRCXSourceSection = "global" | "head" | "body";
export type LRCXModeAction =
  | "abort"
  | "partial"
  | "skip"
  | "continue"
  | "keep-first";

export interface LRCXSourceLocation {
  section: LRCXSourceSection;
  line: number;
  column: number;
  endColumn: number;
  offset: number;
  length: number;
  rawLine: string;
  snippet: string;
}

export interface LRCXLyricPosition {
  timeMs?: number;
  timeTag?: string;
  track?: string;
  tag?: string;
  tokenIndex?: number;
}

export interface LRCXError {
  Name: string;
  Code: number;
  Fatal: boolean;
  Desc: string;
  Key?: string;
  Severity?: LRCXDiagnosticSeverity;
  Phase?: LRCXParsePhase;
  Mode?: LyricResolveMode;
  Action?: LRCXModeAction;
  Section?: LRCXSourceSection;
  Line?: number;
  Column?: number;
  EndColumn?: number;
  Offset?: number;
  Length?: number;
  RawLine?: string;
  Snippet?: string;
  TimeMs?: number;
  LineTag?: string;
  LyricPosition?: LRCXLyricPosition;
  Meta?: Record<string, unknown>;
}

export interface LRCXErrorDefinition {
  Key: string;
  Name: string;
  Code: number;
  Fatal: boolean;
  Desc: string;
  Severity: LRCXDiagnosticSeverity;
  Actions: Record<LyricResolveMode, LRCXModeAction>;
}

export interface LRCXParserOptions {
  dev?: boolean;
}

export type LrcxOptStruct<T> = {
  "": T;
} & Record<string, any>;

export interface LyricTimingRange {
  start: number;
  duration: number;
  token: string;
  easing?: string;
  haltperchar?: number;
}

export interface LyricTokenRange {
  offset: number;
  len: number;
  token: string;
}

export interface LyricTimingToken {
  begin: number;
  end: number;
  token: string;
}

export type LyricPhonetic =
  | {
      type: "" | "full";
      name: string;
      timing: LyricTimingRange[];
    }
  | {
      type: "brief";
      name: string;
      timing: LyricTimingToken[];
    }
  | {
      type: "supermark";
      name: string;
      parts: LyricTokenRange[];
    };

export type LyricPhoneticTemp = LyricPhonetic & {
  text: "" | string;
};

export interface LyricLineContent {
  text: string;
  timing?: LyricTimingRange[];
  trans: {
    "": string;
    [lang: string]: string;
  };
  phonetic: LyricPhonetic[];
  back?: LyricTimingToken[][];
  marks: string[];
  hangings: LyricHangingLine[];
  attr?: {
    [key: string]: string;
  };
}
export interface LyricHangingLine {
  raw: string;
  text: string;
  marks: string[];
  attr?: {
    [key: string]: string;
  };
  values?: Array<string | undefined>;
}

export interface LyricInfo {
  by: {
    "": string[];
    tran?: {
      "": string[];
      [lang: string]: undefined | string[];
    };
    phonetic?: {
      "": string[];
      [type: string]: undefined | string[];
    };
    timing?: {
      "": string[];
      phonetic?: string[];
      tran?: string[];
      [more: string]: undefined | string[];
    };
  };
}

export interface SongInfo {
  title: string;
  titleProps: {
    cover: string;
    version: string;
    feat: string[];
    explicit: boolean;
    notes: string[];
  };
  album: string;
  artist: string[];
  composer: string[];
  lyricist: string[];
  arranger: string[];
  recording: string[];
  mixing: string[];
  mastering: string[];
  instrumentalists: string[];
  producer: string[];
  more: Record<string, string>;
}

export interface LyricComment {
  note: {
    "": string;
    by: LrcxOptStruct<string>;
  };
  [key: string]: any;
}

interface ContentParserResult {
  status: LyricParseStatus;
  lineTags: string[];
  times: number[];
  ends: number[];
  lines: LyricLineContent[];
  offset: number;
}

export interface LRCXInstance extends ContentParserResult {
  mode: LyricResolveMode;
  marks: string[];
  marksOpt: Record<string, LrcxOptStruct<string>>;
  trans: string[];
  phonetic: string[];
  voice: string[];
  lyricInfo: LyricInfo;
  songInfo: SongInfo;
  easing: Record<
    string,
    {
      x: number[];
      y: number[];
    }
  >;
  lyricComment: LyricComment;
}

export const LRCXSystemTags = ["voice", "trans", "phonetic"] as const;

export const LRCXBuiltinBodyTags = [
  "timing",
  "back",
  "ref",
  "ignore",
  "append",
  "hidden",
  "trans",
] as const;

export const LrcxConstants = {
  LRCXVersion: "v1.0",
  LRCXMarkTag: "[---] v1.0",
} as const;
