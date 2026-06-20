import {
  cloneLyricLineContent,
  createLRCXError,
  createLrcxIns,
  createLrcxLine,
  flattenOptionTree,
  getLRCXOptStruct,
  LRCXErrorTypes,
  parseLyricTimeDetailed,
  parseTagExpression,
  resolveOption,
  splitByComma,
  unescapeLrcxText,
} from "./lrcx-utils.js";
import {
  LRCXBuiltinBodyTags,
  LyricParseStatus,
  LyricResolveMode,
  LrcxConstants,
} from "./lrcx-type.js";
import type {
  LRCXError,
  LRCXInstance,
  LRCXModeAction,
  LRCXParserOptions,
  LRCXParsePhase,
  LRCXSourceLocation,
  LRCXSourceSection,
  LyricHangingLine,
  LyricLineContent,
  LyricPhonetic,
  LyricTimingRange,
  LyricTimingToken,
  LyricTokenRange,
} from "./lrcx-type.js";

interface SourceLine {
  raw: string;
  trimmed: string;
  line: number;
  startOffset: number;
  section: LRCXSourceSection;
}

interface LineTimeInfo {
  rawTag: string;
  time: number;
  duration?: number;
  location: LRCXSourceLocation;
}

interface ContentTagInfo {
  raw: string;
  rawBase: string;
  normalizedBase: string;
  path: string[];
  argText: string;
  hasArg: boolean;
  args: string[];
  location: LRCXSourceLocation;
}

interface ParsedBodyLine {
  source: SourceLine;
  timeInfo: LineTimeInfo;
  bodyRaw: string;
  tags: ContentTagInfo[];
  text: string;
  textStartIndex: number;
  textLocation: LRCXSourceLocation;
}

interface LineBuildResult {
  flow: "ok" | "skip" | "stop";
  lineContent?: LyricLineContent;
  explicitDuration?: number;
  inferredDuration?: number;
  pendingRefTime?: number;
}

interface PendingReference {
  targetTimeMs: number;
  targetTimeTag: string;
  refTimeMs: number;
  rawRefTag: string;
  location: LRCXSourceLocation;
}

interface GroupMeta {
  timeMs: number;
  timeTag: string;
  explicitDuration?: number;
  inferredDuration?: number;
  explicitDurationLocation?: LRCXSourceLocation;
  inferredDurationLocation?: LRCXSourceLocation;
  durationConflictReported?: boolean;
  sourceLines: number[];
}

interface TimingParseResult {
  tokens: LyricTimingRange[];
  text: string;
  duration?: number;
}

interface SimpleTimingParseResult {
  tokens: LyricTimingToken[];
  duration?: number;
}

interface SupermarkParseResult {
  text: string;
  parts: LyricTokenRange[];
}

interface TrackSelection {
  type: "main" | "timing" | "trans" | "phonetic" | "back" | "ref" | "ignore";
  tag?: ContentTagInfo;
}

const HORIZONTAL_SPACES = new Set([" ", "\t"]);

export abstract class LRCXParserBase {
  protected readonly text: string;
  protected readonly options: LRCXParserOptions;
  protected readonly errors: LRCXError[] = [];
  protected readonly warnings: LRCXError[] = [];
  protected readonly headLines: SourceLine[] = [];
  protected readonly bodyLines: SourceLine[] = [];
  protected readonly pendingReferences: PendingReference[] = [];
  protected readonly groupMetaByTime = new Map<number, GroupMeta>();
  protected readonly groupIndexByTime = new Map<number, number>();
  protected readonly ins: LRCXInstance = createLrcxIns();

  protected currentPhase: LRCXParsePhase = "global";
  protected abortRequested = false;
  protected partialRequested = false;
  protected fragmentRequested = false;

  protected constructor(text: string, options: LRCXParserOptions = {}) {
    this.text = text;
    this.options = options;
    this.ins.mode = this.getMode();
  }

  protected abstract getMode(): LyricResolveMode;

  protected emitDiagnostic(
    errorType: typeof LRCXErrorTypes[keyof typeof LRCXErrorTypes],
    options: {
      action?: LRCXModeAction;
      desc?: string;
      fatal?: boolean;
      location?: LRCXSourceLocation;
      lineTag?: string;
      timeMs?: number;
      lyricPosition?: LRCXError["LyricPosition"];
      meta?: Record<string, unknown>;
    } = {},
  ): LRCXModeAction {
    const action = options.action ?? errorType.Actions[this.getMode()];
    const diagnostic = createLRCXError(errorType, {
      ...options,
      action,
      mode: this.getMode(),
      phase: this.currentPhase,
    });

    if (diagnostic.Severity === "warning") {
      this.warnings.push(diagnostic);
    } else {
      this.errors.push(diagnostic);
    }

    if (action === "abort") {
      this.abortRequested = true;
    } else if (action === "partial") {
      this.partialRequested = true;
    }

    if (
      this.getMode() === LyricResolveMode.Loose &&
      (diagnostic.Severity === "error" || action === "skip" || action === "keep-first")
    ) {
      this.fragmentRequested = true;
    }

    if (this.options.dev) {
      const location = diagnostic.Line
        ? ` at ${diagnostic.Section}:${diagnostic.Line}:${diagnostic.Column}`
        : "";
      // @ts-ignore
      console.warn(`[LRCX] ${diagnostic.Name}: ${diagnostic.Desc}${location}`);
    }

    return action;
  }

  protected isStopAction(action: LRCXModeAction): boolean {
    return action === "abort" || action === "partial";
  }

  protected buildLocation(
    line: SourceLine,
    startIndex: number,
    endIndex: number,
  ): LRCXSourceLocation {
    const safeStart = Math.max(0, Math.min(startIndex, line.raw.length));
    const safeEnd = Math.max(safeStart, Math.min(endIndex, line.raw.length));
    return {
      section: line.section,
      line: line.line,
      column: safeStart + 1,
      endColumn: safeEnd > safeStart ? safeEnd : safeStart + 1,
      offset: line.startOffset + safeStart,
      length: safeEnd - safeStart,
      rawLine: line.raw,
      snippet: line.raw.slice(safeStart, safeEnd),
    };
  }

  protected firstNonWhitespaceIndex(raw: string): number {
    for (let index = 0; index < raw.length; index += 1) {
      const char = raw[index];
      if (char !== " " && char !== "\t") {
        return index;
      }
    }
    return raw.length;
  }

  protected hasDeclaredTag(base: string): boolean {
    return (
      this.ins.voice.includes(base) ||
      this.ins.trans.includes(base) ||
      this.ins.phonetic.includes(base) ||
      this.ins.marks.includes(base) ||
      (LRCXBuiltinBodyTags as readonly string[]).includes(base.toLowerCase())
    );
  }

  protected globalScan(): boolean {
    this.currentPhase = "global";
    const sourceLines = splitSourceLines(this.text);
    let separatorFound = false;

    for (const sourceLine of sourceLines) {
      if (!sourceLine.trimmed) {
        continue;
      }

      const startIndex = this.firstNonWhitespaceIndex(sourceLine.raw);
      const location = this.buildLocation(
        sourceLine,
        startIndex,
        Math.min(sourceLine.raw.length, startIndex + sourceLine.trimmed.length),
      );

      if (!sourceLine.trimmed.startsWith("[")) {
        this.emitDiagnostic(LRCXErrorTypes.INVALID_FILE, { location });
        return false;
      }

      if (sourceLine.trimmed.startsWith("[---]")) {
        if (sourceLine.trimmed !== LrcxConstants.LRCXMarkTag) {
          this.emitDiagnostic(LRCXErrorTypes.VERSION_UNMATCH, { location });
          return false;
        }
        if (separatorFound) {
          this.emitDiagnostic(LRCXErrorTypes.MULTIPLE_SEPARATOR, { location });
          return false;
        }
        separatorFound = true;
        continue;
      }

      if (!separatorFound) {
        this.headLines.push({ ...sourceLine, section: "head" });
      } else {
        this.bodyLines.push({ ...sourceLine, section: "body" });
      }
    }

    if (!separatorFound) {
      this.emitDiagnostic(LRCXErrorTypes.INVALID_FILE, {
        desc: "Missing [---] v1.0 separator line",
      });
      return false;
    }

    return !this.abortRequested;
  }

  protected resolveHead(): boolean {
    this.currentPhase = "head";
    for (const line of this.headLines) {
      if (!line.trimmed) {
        continue;
      }
      if (!this.resolveHeadLine(line)) {
        return false;
      }
      if (this.abortRequested) {
        return false;
      }
    }
    return true;
  }

  protected resolveHeadLine(line: SourceLine): boolean {
    const startIndex = this.firstNonWhitespaceIndex(line.raw);
    if (startIndex >= line.raw.length || line.raw[startIndex] !== "[") {
      const action = this.emitDiagnostic(LRCXErrorTypes.INVALID_LINE, {
        location: this.buildLocation(line, startIndex, line.raw.length),
        action: "abort",
      });
      return !this.isStopAction(action);
    }

    const closeIndex = line.raw.indexOf("]", startIndex + 1);
    if (closeIndex === -1) {
      const action = this.emitDiagnostic(LRCXErrorTypes.INVALID_LINE, {
        location: this.buildLocation(line, startIndex, line.raw.length),
        action: "abort",
      });
      return !this.isStopAction(action);
    }

    const inner = line.raw.slice(startIndex + 1, closeIndex).trim();
    const content = line.raw.slice(closeIndex + 1).trim();

    if (!inner.startsWith("#")) {
      this.ins.lyricComment[inner] = content;
      return true;
    }

    const expression = parseTagExpression(inner);
    switch (expression.normalizedBase) {
      case "title":
        this.resolveTitleTag(content);
        return true;
      case "titlesort":
      case "artistsort":
      case "date":
      case "releasetype":
      case "label":
      case "copyright":
      case "language":
        this.ins.songInfo.more[expression.normalizedBase] = content;
        return true;
      case "album":
        this.ins.songInfo.album = content;
        return true;
      case "artist":
      case "composer":
      case "lyricist":
      case "arranger":
      case "recording":
      case "mixing":
      case "mastering":
      case "instrumentalists":
      case "producer":
        this.appendArrayMeta(expression.normalizedBase as keyof typeof this.ins.songInfo, content);
        return true;
      case "offset":
        this.ins.offset = Number.parseFloat(content) || 0;
        return true;
      case "more":
        if (expression.args[0]) {
          this.ins.songInfo.more[expression.args[0]] = content;
        }
        return true;
      case "by":
        return this.resolveByTag(expression, content, line, startIndex, closeIndex + 1);
      case "note":
        return this.resolveNoteTag(expression, content, line, startIndex, closeIndex + 1);
      case "voice":
        return this.resolveDeclaredTagList("voice", expression.args, content, line, startIndex, closeIndex + 1);
      case "trans":
        return this.resolveDeclaredTagList("trans", expression.args, content, line, startIndex, closeIndex + 1);
      case "phonetic":
        return this.resolvePhoneticTag(expression.args, content, line, startIndex, closeIndex + 1);
      case "marks":
        return this.resolveDeclaredTagList("marks", expression.args, content, line, startIndex, closeIndex + 1);
      case "option":
        return this.resolveOptionTag(expression.args, content, line, startIndex, closeIndex + 1);
      case "easing":
        return this.resolveEasingTag(expression.args, content, line, startIndex, closeIndex + 1);
      default:
        this.ins.lyricComment[expression.rawBase || expression.raw] = content;
        return true;
    }
  }

  protected resolveTitleTag(content: string): void {
    const songInfo = this.ins.songInfo;
    const titleEnd = content.search(/[\[{(]/);
    songInfo.title = titleEnd < 0 ? content : content.slice(0, titleEnd).trim();

    const coverMatch = content.match(/\[Cover:(.*?)\]/i);
    if (coverMatch) {
      songInfo.titleProps.cover = coverMatch[1].trim();
    }

    const versionMatch = content.match(/\{(.*?)\}/);
    if (versionMatch) {
      songInfo.titleProps.version = versionMatch[1].trim();
    }

    const featMatch = content.match(/\[feat:(.*?)\]/i);
    if (featMatch) {
      songInfo.titleProps.feat = splitByComma(featMatch[1]);
    }

    if (/\[Explicit\]/i.test(content)) {
      songInfo.titleProps.explicit = true;
    }

    const noteMatches = content.matchAll(/\((.*?)\)/g);
    for (const match of noteMatches) {
      songInfo.titleProps.notes.push(match[1].trim());
    }
  }

  protected appendArrayMeta(
    key: keyof LRCXInstance["songInfo"],
    content: string,
  ): void {
    const target = this.ins.songInfo[key];
    if (Array.isArray(target)) {
      target.push(...splitByComma(content).filter(Boolean));
    }
  }

  protected resolveByTag(
    expression: ReturnType<typeof parseTagExpression>,
    content: string,
    line: SourceLine,
    startIndex: number,
    endIndex: number,
  ): boolean {
    const location = this.buildLocation(line, startIndex, endIndex);
    const values = splitByComma(content).filter(Boolean);
    if (expression.args.length === 0) {
      this.ins.lyricInfo.by[""] = values;
      return true;
    }

    for (const rawTarget of expression.args) {
      const normalized = rawTarget.replace(/^trans(?=\.|$)/, "tran");
      const path = normalized.split(".").filter(Boolean);
      if (path.length === 0) {
        continue;
      }
      const assigned = setNestedStringArray(this.ins.lyricInfo.by as Record<string, unknown>, path, values);
      if (!assigned) {
        const action = this.emitDiagnostic(LRCXErrorTypes.INVALID_LINE, {
          location,
          action: "abort",
          desc: `Unsupported #by target: ${rawTarget}`,
        });
        return !this.isStopAction(action);
      }
    }

    return true;
  }

  protected resolveNoteTag(
    expression: ReturnType<typeof parseTagExpression>,
    content: string,
    line: SourceLine,
    startIndex: number,
    endIndex: number,
  ): boolean {
    const location = this.buildLocation(line, startIndex, endIndex);
    if (expression.args.length === 0) {
      this.ins.lyricComment.note[""] = content;
      return true;
    }

    if (expression.args[0] === "by") {
      this.ins.lyricComment.note.by[""] = content;
      return true;
    }

    const assigned = setNestedString(this.ins.lyricComment.note as Record<string, unknown>, expression.args[0].split("."), content);
    if (!assigned) {
      const action = this.emitDiagnostic(LRCXErrorTypes.INVALID_LINE, {
        location,
        action: "abort",
        desc: `Unsupported #note target: ${expression.args[0]}`,
      });
      return !this.isStopAction(action);
    }
    return true;
  }

  protected resolveDeclaredTagList(
    kind: "voice" | "trans" | "marks",
    names: string[],
    content: string,
    line: SourceLine,
    startIndex: number,
    endIndex: number,
  ): boolean {
    const location = this.buildLocation(line, startIndex, endIndex);
    const target = this.ins[kind];

    for (const name of names) {
      if (target.includes(name)) {
        const action = this.emitDiagnostic(LRCXErrorTypes.MARK_REDUNDANT, {
          location,
          meta: { tag: name, kind },
        });
        if (this.isStopAction(action)) {
          return false;
        }
      } else {
        target.push(name);
      }
    }

    const matched = resolveOption(names, content, this.ins.marksOpt, undefined, {
      allowShort: true,
    });
    if (!matched) {
      const action = this.emitDiagnostic(LRCXErrorTypes.OPTION_UNMATCH, {
        location,
        meta: { kind },
      });
      if (this.isStopAction(action)) {
        return false;
      }
    }
    return true;
  }

  protected resolvePhoneticTag(
    names: string[],
    content: string,
    line: SourceLine,
    startIndex: number,
    endIndex: number,
  ): boolean {
    const location = this.buildLocation(line, startIndex, endIndex);
    const validModes = new Set(["", "brief", "full", "supermark"]);

    for (const name of names) {
      if (this.ins.phonetic.includes(name)) {
        const action = this.emitDiagnostic(LRCXErrorTypes.MARK_REDUNDANT, {
          location,
          meta: { tag: name, kind: "phonetic" },
        });
        if (this.isStopAction(action)) {
          return false;
        }
      } else {
        this.ins.phonetic.push(name);
      }
    }

    const matched = resolveOption(
      names,
      content,
      this.ins.marksOpt,
      (value) => {
        const normalized = value.trim().toLowerCase();
        if (validModes.has(normalized)) {
          return normalized;
        }
        this.emitDiagnostic(LRCXErrorTypes.UNKNOWN_PHENOTIC, {
          location,
          meta: { value },
        });
        return "";
      },
    );

    if (!matched) {
      const action = this.emitDiagnostic(LRCXErrorTypes.OPTION_UNMATCH, {
        location,
        meta: { kind: "phonetic" },
      });
      if (this.isStopAction(action)) {
        return false;
      }
    }

    return true;
  }

  protected resolveOptionTag(
    tagPaths: string[],
    content: string,
    line: SourceLine,
    startIndex: number,
    endIndex: number,
  ): boolean {
    const location = this.buildLocation(line, startIndex, endIndex);
    for (const path of tagPaths) {
      const base = path.split(".")[0];
      if (!this.hasDeclaredTag(base) && !(LRCXBuiltinBodyTags as readonly string[]).includes(base.toLowerCase())) {
        const action = this.emitDiagnostic(LRCXErrorTypes.MARK_NOTFOUND, {
          location,
          action: "abort",
          desc: `Option target is not declared: ${path}`,
        });
        return !this.isStopAction(action);
      }
    }

    const matched = resolveOption(tagPaths, content, this.ins.marksOpt);
    if (!matched) {
      const action = this.emitDiagnostic(LRCXErrorTypes.OPTION_UNMATCH, {
        location,
      });
      if (this.isStopAction(action)) {
        return false;
      }
    }
    return true;
  }

  protected resolveEasingTag(
    names: string[],
    content: string,
    line: SourceLine,
    startIndex: number,
    endIndex: number,
  ): boolean {
    const location = this.buildLocation(line, startIndex, endIndex);
    const values = splitByComma(content, ";");

    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const definition = values[index];
      if (!definition) {
        continue;
      }

      const match = definition.match(/^besi?er\s*\((.*)\)$/i);
      if (!match) {
        const action = this.emitDiagnostic(LRCXErrorTypes.SYNTAX_ERROR, {
          location,
          desc: `Invalid easing declaration: ${definition}`,
        });
        if (this.isStopAction(action)) {
          return false;
        }
        continue;
      }

      const points = splitByComma(match[1]).map((value) => Number.parseFloat(value));
      if (points.length < 4 || points.length % 2 !== 0 || points.some((value) => Number.isNaN(value))) {
        const action = this.emitDiagnostic(LRCXErrorTypes.SYNTAX_ERROR, {
          location,
          desc: `Invalid easing control points: ${definition}`,
        });
        if (this.isStopAction(action)) {
          return false;
        }
        continue;
      }

      if (points.length > 14) {
        this.emitDiagnostic(LRCXErrorTypes.INFERIOR_BESIER, {
          location,
          meta: { name },
        });
      }

      const x: number[] = [];
      const y: number[] = [];
      for (let pointIndex = 0; pointIndex < points.length; pointIndex += 2) {
        x.push(points[pointIndex]);
        y.push(points[pointIndex + 1]);
      }
      this.ins.easing[name] = { x, y };
    }

    return true;
  }
  protected resolveBody(): void {
    this.currentPhase = "body";

    for (const line of this.bodyLines) {
      if (!line.trimmed) {
        continue;
      }

      const parsed = this.parseBodyLine(line);
      if (!parsed) {
        if (this.abortRequested || this.partialRequested) {
          break;
        }
        continue;
      }

      const built = this.buildLineContent(parsed);
      if (built.flow === "stop") {
        break;
      }
      if (built.flow === "skip" || !built.lineContent) {
        continue;
      }

      const groupIndex = this.addOrGetGroup(parsed.timeInfo);
      if (groupIndex === -1) {
        if (this.abortRequested || this.partialRequested) {
          break;
        }
        continue;
      }

      if (!this.mergeContribution(groupIndex, parsed, built)) {
        break;
      }
      if (this.abortRequested || this.partialRequested) {
        break;
      }
    }
  }

  protected parseBodyLine(line: SourceLine): ParsedBodyLine | null {
    const startIndex = this.firstNonWhitespaceIndex(line.raw);
    if (startIndex >= line.raw.length || line.raw[startIndex] !== "[") {
      const action = this.emitDiagnostic(LRCXErrorTypes.INVALID_LINE, {
        location: this.buildLocation(line, startIndex, line.raw.length),
      });
      return this.isStopAction(action) ? null : null;
    }

    const closeIndex = line.raw.indexOf("]", startIndex + 1);
    if (closeIndex === -1) {
      const action = this.emitDiagnostic(LRCXErrorTypes.INVALID_LINE, {
        location: this.buildLocation(line, startIndex, line.raw.length),
      });
      return this.isStopAction(action) ? null : null;
    }

    const timeTagRaw = line.raw.slice(startIndex + 1, closeIndex).trim();
    const timeInfo = this.parseTimeTag(line, timeTagRaw, startIndex + 1, closeIndex);
    if (!timeInfo) {
      return null;
    }

    let cursor = closeIndex + 1;
    const tags: ContentTagInfo[] = [];

    while (cursor < line.raw.length) {
      let probe = cursor;
      while (probe < line.raw.length && HORIZONTAL_SPACES.has(line.raw[probe])) {
        probe += 1;
      }

      if (probe < line.raw.length && line.raw[probe] === "[" && line.raw[probe + 1] === "#") {
        const tagClose = line.raw.indexOf("]", probe + 1);
        if (tagClose === -1) {
          const action = this.emitDiagnostic(LRCXErrorTypes.INVALID_LINE, {
            location: this.buildLocation(line, probe, line.raw.length),
            lineTag: timeInfo.rawTag,
            timeMs: timeInfo.time,
          });
          if (this.isStopAction(action)) {
            return null;
          }
          break;
        }

        const inner = line.raw.slice(probe + 1, tagClose);
        const expression = parseTagExpression(inner);
        tags.push({
          ...expression,
          location: this.buildLocation(line, probe, tagClose + 1),
        });
        cursor = tagClose + 1;
        continue;
      }
      break;
    }

    const textStartIndex = cursor;
    return {
      source: line,
      timeInfo,
      bodyRaw: line.raw.slice(closeIndex + 1),
      tags,
      text: line.raw.slice(textStartIndex),
      textStartIndex,
      textLocation: this.buildLocation(line, textStartIndex, line.raw.length),
    };
  }

  protected parseTimeTag(
    line: SourceLine,
    rawTag: string,
    startIndex: number,
    endIndex: number,
  ): LineTimeInfo | null {
    const plusIndex = rawTag.indexOf("+");
    const timePart = (plusIndex === -1 ? rawTag : rawTag.slice(0, plusIndex)).trim();
    const durationPart = plusIndex === -1 ? "" : rawTag.slice(plusIndex + 1).trim();
    const parsed = parseLyricTimeDetailed(timePart);
    const location = this.buildLocation(line, startIndex, endIndex);

    if (!parsed) {
      const action = this.emitDiagnostic(LRCXErrorTypes.INVALID_LINE, {
        location,
      });
      return this.isStopAction(action) ? null : null;
    }

    if (parsed.precision > 3) {
      const action = this.emitDiagnostic(LRCXErrorTypes.UNSUPPORTED_ACCURACY, {
        location,
        lineTag: rawTag,
        timeMs: parsed.time,
      });
      return this.isStopAction(action) ? null : null;
    }

    let duration: number | undefined;
    if (durationPart) {
      if (!/^\d+$/.test(durationPart)) {
        const action = this.emitDiagnostic(LRCXErrorTypes.INVALID_DURATION, {
          location,
          lineTag: rawTag,
          timeMs: parsed.time,
        });
        return this.isStopAction(action) ? null : null;
      }
      duration = Number.parseInt(durationPart, 10);
    }

    return {
      rawTag,
      time: parsed.time,
      duration,
      location,
    };
  }

  protected buildLineContent(parsed: ParsedBodyLine): LineBuildResult {
    const lineContent = createLrcxLine();
    const selected: TrackSelection = { type: "main" };
    const usedTagBases = new Set<string>();
    let hasExplicitTrack = false;

    if (parsed.tags.some((tag) => tag.normalizedBase === "ignore")) {
      lineContent.hangings.push(this.buildHangingLine(parsed));
      return {
        flow: "ok",
        lineContent,
        explicitDuration: parsed.timeInfo.duration,
      };
    }

    if (parsed.tags.some((tag) => tag.normalizedBase === "append")) {
      if (!this.validateDeclaredHangingTags(parsed)) {
        return { flow: "stop" };
      }
      if (parsed.tags.some((tag) => tag.normalizedBase === "hidden")) {
        this.applyHidden(lineContent);
      }
      lineContent.hangings.push(this.buildHangingLine(parsed));
      return {
        flow: "ok",
        lineContent,
        explicitDuration: parsed.timeInfo.duration,
      };
    }

    for (const tag of parsed.tags) {
      if (tag.normalizedBase === "hidden") {
        this.applyHidden(lineContent);
        continue;
      }

      const classification = this.classifyBodyTag(tag);
      if (!classification) {
        const action = this.emitDiagnostic(LRCXErrorTypes.MARK_NOTFOUND, {
          location: tag.location,
          lineTag: parsed.timeInfo.rawTag,
          timeMs: parsed.timeInfo.time,
          lyricPosition: {
            timeMs: parsed.timeInfo.time,
            timeTag: parsed.timeInfo.rawTag,
            tag: tag.rawBase,
          },
        });
        if (this.isStopAction(action)) {
          return { flow: "stop" };
        }
        continue;
      }

      if (classification.kind === "modifier") {
        this.applyModifier(lineContent, tag, usedTagBases);
        continue;
      }

      if (!hasExplicitTrack) {
        selected.type = classification.type;
        selected.tag = tag;
        hasExplicitTrack = true;
        continue;
      }

      const action = this.emitDiagnostic(LRCXErrorTypes.RETYPE_ERROR, {
        location: tag.location,
        lineTag: parsed.timeInfo.rawTag,
        timeMs: parsed.timeInfo.time,
        lyricPosition: {
          timeMs: parsed.timeInfo.time,
          timeTag: parsed.timeInfo.rawTag,
          track: selected.type,
          tag: tag.rawBase,
        },
      });
      if (this.isStopAction(action)) {
        return { flow: "stop" };
      }
    }

    this.applyDefaultOptions(lineContent, usedTagBases);

    switch (selected.type) {
      case "main": {
        lineContent.text = unescapeLrcxText(parsed.text);
        return {
          flow: "ok",
          lineContent,
          explicitDuration: parsed.timeInfo.duration,
        };
      }
      case "timing": {
        const result = this.parseFullTiming(parsed, selected.tag!);
        if (!result) {
          return this.abortRequested || this.partialRequested ? { flow: "stop" } : { flow: "skip" };
        }
        lineContent.text = result.text;
        lineContent.timing = result.tokens;
        return {
          flow: "ok",
          lineContent,
          explicitDuration: parsed.timeInfo.duration,
          inferredDuration: result.duration,
        };
      }
      case "trans": {
        const lang = selected.tag!.normalizedBase === "trans"
          ? selected.tag!.args[0] ?? ""
          : selected.tag!.rawBase;
        lineContent.trans[lang] = unescapeLrcxText(parsed.text);
        // Add implicit key
        if(lang===''){
          const keySet = this.ins.trans;
          if(!keySet.includes(lang)) keySet.push(lang);
        }
        return {
          flow: "ok",
          lineContent,
          explicitDuration: parsed.timeInfo.duration,
        };
      }
      case "phonetic": {
        const phoneticLine = this.parsePhoneticLine(parsed, selected.tag!, lineContent);
        if (!phoneticLine) {
          return this.abortRequested || this.partialRequested ? { flow: "stop" } : { flow: "skip" };
        }
        return {
          flow: "ok",
          lineContent,
          explicitDuration: parsed.timeInfo.duration,
          inferredDuration: phoneticLine.inferredDuration,
        };
      }
      case "back": {
        const offsetRaw = selected.tag!.args[0] ?? selected.tag!.argText;
        if (!/^-?\d+$/.test(offsetRaw)) {
          const action = this.emitDiagnostic(LRCXErrorTypes.INVALID_DURATION, {
            location: selected.tag!.location,
            lineTag: parsed.timeInfo.rawTag,
            timeMs: parsed.timeInfo.time,
            desc: `Invalid #back offset: ${offsetRaw}`,
          });
          return this.isStopAction(action) ? { flow: "stop" } : { flow: "skip" };
        }
        const result = this.parseSimpleTiming(parsed, selected.tag!);
        if (!result) {
          return this.abortRequested || this.partialRequested ? { flow: "stop" } : { flow: "skip" };
        }
        const offset = Number.parseInt(offsetRaw, 10);
        lineContent.back = [
          result.tokens.map((token) => ({
            begin: token.begin + offset,
            end: token.end + offset,
            token: token.token,
          })),
        ];
        return {
          flow: "ok",
          lineContent,
          explicitDuration: parsed.timeInfo.duration,
        };
      }
      case "ref": {
        const refRaw = selected.tag!.argText || selected.tag!.args[0];
        const refTime = refRaw ? parseLyricTimeDetailed(refRaw) : null;
        if (!refTime) {
          const action = this.emitDiagnostic(LRCXErrorTypes.INVALID_REFERENCE, {
            location: selected.tag!.location,
            lineTag: parsed.timeInfo.rawTag,
            timeMs: parsed.timeInfo.time,
            desc: `Invalid reference tag: ${selected.tag!.raw}`,
          });
          return this.isStopAction(action) ? { flow: "stop" } : { flow: "skip" };
        }
        lineContent.attr = lineContent.attr ?? {};
        lineContent.attr.ref = refRaw;
        return {
          flow: "ok",
          lineContent,
          explicitDuration: parsed.timeInfo.duration,
          pendingRefTime: refTime.time,
        };
      }
      case "ignore":
        return { flow: "skip" };
    }
  }

  protected validateDeclaredHangingTags(parsed: ParsedBodyLine): boolean {
    for (const tag of parsed.tags) {
      if (this.hasDeclaredTag(tag.rawBase)) {
        continue;
      }

      const action = this.emitDiagnostic(LRCXErrorTypes.MARK_NOTFOUND, {
        location: tag.location,
        lineTag: parsed.timeInfo.rawTag,
        timeMs: parsed.timeInfo.time,
        lyricPosition: {
          timeMs: parsed.timeInfo.time,
          timeTag: parsed.timeInfo.rawTag,
          tag: tag.rawBase,
        },
      });
      if (this.isStopAction(action)) {
        return false;
      }
    }
    return true;
  }

  protected buildHangingLine(parsed: ParsedBodyLine): LyricHangingLine {
    const hanging: LyricHangingLine = {
      raw: parsed.bodyRaw,
      text: unescapeLrcxText(parsed.text),
      marks: parsed.tags.map((tag) => tag.rawBase || tag.raw),
    };

    for (const tag of parsed.tags) {
      this.applyHangingAttribute(hanging, tag);
    }

    return hanging;
  }

  protected applyHangingAttribute(
    hanging: LyricHangingLine,
    tag: ContentTagInfo,
  ): void {
    if (!tag.hasArg || tag.path.length === 0) {
      return;
    }

    if (
      tag.normalizedBase === "append" &&
      tag.path.length === 2 &&
      /^\d+$/.test(tag.path[1])
    ) {
      const index = Number.parseInt(tag.path[1], 10);
      hanging.values = hanging.values ?? [];
      hanging.values[index] = tag.argText;
      return;
    }

    hanging.attr = hanging.attr ?? {};
    hanging.attr[tag.path.join(".")] = tag.argText;
  }

  protected applyHidden(lineContent: LyricLineContent): void {
    lineContent.attr = lineContent.attr ?? {};
    lineContent.attr.hidden = "true";
  }

  protected classifyBodyTag(tag: ContentTagInfo):
    | { kind: "modifier" }
    | { kind: "type"; type: TrackSelection["type"] }
    | null {
    if (tag.normalizedBase === "timing") {
      return { kind: "type", type: "timing" };
    }
    if (tag.normalizedBase === "back") {
      return { kind: "type", type: "back" };
    }
    if (tag.normalizedBase === "ref") {
      return { kind: "type", type: "ref" };
    }
    if (tag.normalizedBase === "ignore") {
      return { kind: "type", type: "ignore" };
    }
    if (tag.normalizedBase === "trans" || this.ins.trans.includes(tag.rawBase)) {
      return { kind: "type", type: "trans" };
    }
    if (this.ins.phonetic.includes(tag.rawBase)) {
      return { kind: "type", type: "phonetic" };
    }
    if (this.ins.voice.includes(tag.rawBase) || this.ins.marks.includes(tag.rawBase)) {
      return { kind: "modifier" };
    }
    return null;
  }

  protected applyModifier(
    lineContent: LyricLineContent,
    tag: ContentTagInfo,
    usedTagBases: Set<string>,
  ): void {
    if (!lineContent.marks.includes(tag.rawBase)) {
      lineContent.marks.push(tag.rawBase);
    }
    usedTagBases.add(tag.rawBase);

    if (tag.path.length > 1 || tag.argText) {
      lineContent.attr = lineContent.attr ?? {};
      const attrKey = tag.path.join(".");
      const attrValue = tag.argText || String(this.readOpt(attrKey) ?? "");
      if (attrValue) {
        lineContent.attr[attrKey] = attrValue;
      }
    }
  }

  protected applyDefaultOptions(
    lineContent: LyricLineContent,
    usedTagBases: Set<string>,
  ): void {
    for (const base of usedTagBases) {
      const tree = this.ins.marksOpt[base];
      if (!tree) {
        continue;
      }
      const defaults = flattenOptionTree(base, tree);
      if (Object.keys(defaults).length === 0) {
        continue;
      }
      lineContent.attr = lineContent.attr ?? {};
      for (const [key, value] of Object.entries(defaults)) {
        if (!lineContent.attr[key]) {
          lineContent.attr[key] = value;
        }
      }
    }
  }

  protected parsePhoneticLine(
    parsed: ParsedBodyLine,
    tag: ContentTagInfo,
    lineContent: LyricLineContent,
  ): { inferredDuration?: number } | null {
    const rawMode = String(this.readOpt(tag.rawBase) ?? "").trim().toLowerCase();
    const mode = ["", "brief", "full", "supermark"].includes(rawMode)
      ? rawMode
      : "";

    if (mode !== rawMode) {
      this.emitDiagnostic(LRCXErrorTypes.UNKNOWN_PHENOTIC, {
        location: tag.location,
        lineTag: parsed.timeInfo.rawTag,
        timeMs: parsed.timeInfo.time,
        meta: { value: rawMode },
      });
    }

    if (mode === "supermark") {
      const result = this.parseSupermark(parsed, tag);
      if (!result) {
        return null;
      }
      lineContent.text = result.text;
      lineContent.phonetic.push({
        type: "supermark",
        name: tag.rawBase,
        parts: result.parts,
      });
      return {};
    }

    if (mode === "brief") {
      const result = this.parseSimpleTiming(parsed, tag);
      if (!result) {
        return null;
      }
      lineContent.phonetic.push({
        type: "brief",
        name: tag.rawBase,
        timing: result.tokens,
      });
      return { inferredDuration: result.duration };
    }

    const result = this.parseFullTiming(parsed, tag);
    if (!result) {
      return null;
    }
    lineContent.phonetic.push({
      type: "full",
      name: tag.rawBase,
      timing: result.tokens,
    });
    return { inferredDuration: result.duration };
  }

  protected parseFullTiming(
    parsed: ParsedBodyLine,
    tag: ContentTagInfo,
  ): TimingParseResult | null {
    const tokens: LyricTimingRange[] = [];
    let cursor = 0;
    let textStart = 0;
    let currentTime = 0;

    while (cursor < parsed.text.length) {
      const char = parsed.text[cursor];
      if (char === "<" && !isEscaped(parsed.text, cursor)) {
        const closeIndex = findUnescaped(parsed.text, ">", cursor + 1);
        if (closeIndex === -1) {
          this.emitDiagnostic(LRCXErrorTypes.SYNTAX_ERROR, {
            location: this.buildLocation(parsed.source, parsed.textStartIndex + cursor, parsed.source.raw.length),
            lineTag: parsed.timeInfo.rawTag,
            timeMs: parsed.timeInfo.time,
          });
          return null;
        }

        const segment = unescapeLrcxText(parsed.text.slice(textStart, cursor));
        if (!segment) {
          this.emitDiagnostic(LRCXErrorTypes.SYNTAX_ERROR, {
            location: this.buildLocation(parsed.source, parsed.textStartIndex + cursor, parsed.textStartIndex + closeIndex + 1),
            lineTag: parsed.timeInfo.rawTag,
            timeMs: parsed.timeInfo.time,
            desc: "Timing tag must follow a text segment",
          });
          return null;
        }

        const marker = parsed.text.slice(cursor + 1, closeIndex).trim();
        const parsedMarker = this.parseTimingMarker(marker, parsed, cursor, closeIndex, tag);
        if (!parsedMarker) {
          return null;
        }

        tokens.push({
          start: currentTime,
          duration: parsedMarker.duration,
          token: segment,
          easing: parsedMarker.easing,
          haltperchar: parsedMarker.haltperchar,
        });
        currentTime += parsedMarker.duration;
        cursor = closeIndex + 1;
        textStart = cursor;
        continue;
      }

      if (char === ">" && !isEscaped(parsed.text, cursor)) {
        this.emitDiagnostic(LRCXErrorTypes.SYNTAX_ERROR, {
          location: this.buildLocation(parsed.source, parsed.textStartIndex + cursor, parsed.textStartIndex + cursor + 1),
          lineTag: parsed.timeInfo.rawTag,
          timeMs: parsed.timeInfo.time,
          desc: "Unexpected '>' in timing line",
        });
        return null;
      }

      cursor += 1;
    }

    const tailText = unescapeLrcxText(parsed.text.slice(textStart));
    let duration = parsed.timeInfo.duration;

    if (tailText) {
      let tailDuration = 0;
      if (duration !== undefined) {
        tailDuration = Math.max(0, duration - currentTime);
        if (duration < currentTime) {
          this.emitDiagnostic(LRCXErrorTypes.TIMING_INCONSISTENT, {
            location: parsed.timeInfo.location,
            lineTag: parsed.timeInfo.rawTag,
            timeMs: parsed.timeInfo.time,
          });
        }
      }
      tokens.push({
        start: currentTime,
        duration: tailDuration,
        token: tailText,
      });
      if (duration === undefined) {
        duration = currentTime;
      }
    } else if (duration === undefined) {
      duration = currentTime;
    } else if (currentTime !== duration) {
      this.emitDiagnostic(LRCXErrorTypes.TIMING_INCONSISTENT, {
        location: parsed.timeInfo.location,
        lineTag: parsed.timeInfo.rawTag,
        timeMs: parsed.timeInfo.time,
      });
    }

    return {
      tokens,
      text: tokens.map((token) => token.token).join(""),
      duration,
    };
  }

  protected parseSimpleTiming(
    parsed: ParsedBodyLine,
    tag: ContentTagInfo,
  ): SimpleTimingParseResult | null {
    const tokens: LyricTimingToken[] = [];
    let cursor = 0;
    let textStart = 0;
    let currentTime = 0;

    while (cursor < parsed.text.length) {
      const char = parsed.text[cursor];
      if (char === "<" && !isEscaped(parsed.text, cursor)) {
        const closeIndex = findUnescaped(parsed.text, ">", cursor + 1);
        if (closeIndex === -1) {
          this.emitDiagnostic(LRCXErrorTypes.SYNTAX_ERROR, {
            location: this.buildLocation(parsed.source, parsed.textStartIndex + cursor, parsed.source.raw.length),
            lineTag: parsed.timeInfo.rawTag,
            timeMs: parsed.timeInfo.time,
          });
          return null;
        }

        const segment = unescapeLrcxText(parsed.text.slice(textStart, cursor));
        if (!segment) {
          this.emitDiagnostic(LRCXErrorTypes.SYNTAX_ERROR, {
            location: this.buildLocation(parsed.source, parsed.textStartIndex + cursor, parsed.textStartIndex + closeIndex + 1),
            lineTag: parsed.timeInfo.rawTag,
            timeMs: parsed.timeInfo.time,
            desc: `Timing tag in ${tag.rawBase} must follow a text segment`,
          });
          return null;
        }

        const marker = parsed.text.slice(cursor + 1, closeIndex).trim();
        const parsedMarker = this.parseTimingMarker(marker, parsed, cursor, closeIndex, tag);
        if (!parsedMarker) {
          return null;
        }

        tokens.push({
          begin: currentTime,
          end: currentTime + parsedMarker.duration,
          token: segment,
        });
        currentTime += parsedMarker.duration;
        cursor = closeIndex + 1;
        textStart = cursor;
        continue;
      }

      if (char === ">" && !isEscaped(parsed.text, cursor)) {
        this.emitDiagnostic(LRCXErrorTypes.SYNTAX_ERROR, {
          location: this.buildLocation(parsed.source, parsed.textStartIndex + cursor, parsed.textStartIndex + cursor + 1),
          lineTag: parsed.timeInfo.rawTag,
          timeMs: parsed.timeInfo.time,
        });
        return null;
      }

      cursor += 1;
    }

    const tailText = unescapeLrcxText(parsed.text.slice(textStart));
    let duration = parsed.timeInfo.duration;
    if (tailText) {
      const tailEnd = duration ?? currentTime;
      tokens.push({
        begin: currentTime,
        end: tailEnd,
        token: tailText,
      });
      if (duration === undefined) {
        duration = currentTime;
      }
    } else if (duration === undefined) {
      duration = currentTime;
    }

    return { tokens, duration };
  }

  protected parseSupermark(
    parsed: ParsedBodyLine,
    tag: ContentTagInfo,
  ): SupermarkParseResult | null {
    let cursor = 0;
    let resultText = "";
    const parts: LyricTokenRange[] = [];

    while (cursor < parsed.text.length) {
      const char = parsed.text[cursor];
      if (char === "<" && !isEscaped(parsed.text, cursor)) {
        if (parsed.text[cursor + 1] !== "^") {
          this.emitDiagnostic(LRCXErrorTypes.SYNTAX_ERROR, {
            location: this.buildLocation(parsed.source, parsed.textStartIndex + cursor, parsed.textStartIndex + cursor + 1),
            lineTag: parsed.timeInfo.rawTag,
            timeMs: parsed.timeInfo.time,
            desc: `Unexpected '<' in ${tag.rawBase} supermark line`,
          });
          return null;
        }

        const closeIndex = findUnescaped(parsed.text, ">", cursor + 2);
        if (closeIndex === -1) {
          this.emitDiagnostic(LRCXErrorTypes.SYNTAX_ERROR, {
            location: this.buildLocation(parsed.source, parsed.textStartIndex + cursor, parsed.source.raw.length),
            lineTag: parsed.timeInfo.rawTag,
            timeMs: parsed.timeInfo.time,
          });
          return null;
        }

        const caretIndex = findUnescaped(parsed.text, "^", closeIndex + 1);
        if (caretIndex === -1) {
          this.emitDiagnostic(LRCXErrorTypes.SYNTAX_ERROR, {
            location: this.buildLocation(parsed.source, parsed.textStartIndex + closeIndex, parsed.source.raw.length),
            lineTag: parsed.timeInfo.rawTag,
            timeMs: parsed.timeInfo.time,
            desc: "Missing closing '^' in supermark segment",
          });
          return null;
        }

        const ruby = unescapeLrcxText(parsed.text.slice(cursor + 2, closeIndex));
        const target = unescapeLrcxText(parsed.text.slice(closeIndex + 1, caretIndex));
        if (!target) {
          this.emitDiagnostic(LRCXErrorTypes.INVALID_RANGE, {
            location: this.buildLocation(parsed.source, parsed.textStartIndex + cursor, parsed.textStartIndex + caretIndex + 1),
            lineTag: parsed.timeInfo.rawTag,
            timeMs: parsed.timeInfo.time,
            desc: "Supermark target range cannot be empty",
          });
          return null;
        }

        const offset = resultText.length;
        resultText += target;
        parts.push({ offset, len: target.length, token: ruby });
        cursor = caretIndex + 1;
        continue;
      }

      if (char === "^" && !isEscaped(parsed.text, cursor)) {
        this.emitDiagnostic(LRCXErrorTypes.SYNTAX_ERROR, {
          location: this.buildLocation(parsed.source, parsed.textStartIndex + cursor, parsed.textStartIndex + cursor + 1),
          lineTag: parsed.timeInfo.rawTag,
          timeMs: parsed.timeInfo.time,
          desc: "Unexpected '^' in supermark line",
        });
        return null;
      }

      const nextOpen = findUnescaped(parsed.text, "<", cursor);
      const chunkEnd = nextOpen === -1 ? parsed.text.length : nextOpen;
      resultText += unescapeLrcxText(parsed.text.slice(cursor, chunkEnd));
      cursor = chunkEnd;
    }

    return { text: resultText, parts };
  }

  protected parseTimingMarker(
    marker: string,
    parsed: ParsedBodyLine,
    startOffset: number,
    endOffset: number,
    _tag: ContentTagInfo,
  ): { duration: number; easing?: string; haltperchar?: number } | null {
    const colonIndex = marker.indexOf(":");
    const durationText = (colonIndex === -1 ? marker : marker.slice(0, colonIndex)).trim();
    const tail = colonIndex === -1 ? "" : marker.slice(colonIndex + 1).trim();

    if (!/^\d+$/.test(durationText)) {
      this.emitDiagnostic(LRCXErrorTypes.INVALID_DURATION, {
        location: this.buildLocation(parsed.source, parsed.textStartIndex + startOffset, parsed.textStartIndex + endOffset + 1),
        lineTag: parsed.timeInfo.rawTag,
        timeMs: parsed.timeInfo.time,
      });
      return null;
    }

    let easing: string | undefined;
    let haltperchar: number | undefined;

    if (tail) {
      if (tail.startsWith(".")) {
        const haltText = tail.slice(1).trim();
        if (!isNumeric(haltText)) {
          this.emitDiagnostic(LRCXErrorTypes.INVALID_DURATION, {
            location: this.buildLocation(parsed.source, parsed.textStartIndex + startOffset, parsed.textStartIndex + endOffset + 1),
            lineTag: parsed.timeInfo.rawTag,
            timeMs: parsed.timeInfo.time,
            desc: `Invalid halt value: ${haltText}`,
          });
          return null;
        }
        haltperchar = Number.parseFloat(haltText);
      } else {
        const dotIndex = tail.indexOf(".");
        const easingName = (dotIndex === -1 ? tail : tail.slice(0, dotIndex)).trim();
        const haltText = dotIndex === -1 ? "" : tail.slice(dotIndex + 1).trim();
        if (easingName && !this.ins.easing[easingName]) {
          this.emitDiagnostic(LRCXErrorTypes.UNKNOWN_EASING, {
            location: this.buildLocation(parsed.source, parsed.textStartIndex + startOffset, parsed.textStartIndex + endOffset + 1),
            lineTag: parsed.timeInfo.rawTag,
            timeMs: parsed.timeInfo.time,
            desc: `Unknown easing: ${easingName}`,
          });
          return null;
        }
        easing = easingName || undefined;
        if (haltText) {
          if (!isNumeric(haltText)) {
            this.emitDiagnostic(LRCXErrorTypes.INVALID_DURATION, {
              location: this.buildLocation(parsed.source, parsed.textStartIndex + startOffset, parsed.textStartIndex + endOffset + 1),
              lineTag: parsed.timeInfo.rawTag,
              timeMs: parsed.timeInfo.time,
              desc: `Invalid halt value: ${haltText}`,
            });
            return null;
          }
          haltperchar = Number.parseFloat(haltText);
        }
      }
    }

    return {
      duration: Number.parseInt(durationText, 10),
      easing,
      haltperchar,
    };
  }
  protected addOrGetGroup(timeInfo: LineTimeInfo): number {
    const existed = this.groupIndexByTime.get(timeInfo.time);
    if (existed !== undefined) {
      return existed;
    }

    let index = 0;
    while (index < this.ins.times.length && this.ins.times[index] < timeInfo.time) {
      index += 1;
    }

    if (index < this.ins.times.length) {
      const action = this.emitDiagnostic(LRCXErrorTypes.NONSEQUENTIAL, {
        location: timeInfo.location,
        lineTag: timeInfo.rawTag,
        timeMs: timeInfo.time,
      });
      if (this.isStopAction(action)) {
        return -1;
      }
    }

    for (const [time, currentIndex] of [...this.groupIndexByTime.entries()]) {
      if (currentIndex >= index) {
        this.groupIndexByTime.set(time, currentIndex + 1);
      }
    }

    this.ins.lineTags.splice(index, 0, timeInfo.rawTag);
    this.ins.times.splice(index, 0, timeInfo.time);
    this.ins.lines.splice(index, 0, createLrcxLine());
    this.ins.ends.splice(index, 0, Infinity);
    this.groupIndexByTime.set(timeInfo.time, index);
    this.groupMetaByTime.set(timeInfo.time, {
      timeMs: timeInfo.time,
      timeTag: timeInfo.rawTag,
      sourceLines: [],
    });
    return index;
  }

  protected mergeContribution(
    groupIndex: number,
    parsed: ParsedBodyLine,
    built: LineBuildResult,
  ): boolean {
    const lineContent = built.lineContent!;
    const target = this.ins.lines[groupIndex];
    const groupMeta = this.groupMetaByTime.get(parsed.timeInfo.time)!;
    groupMeta.sourceLines.push(parsed.source.line);

    if (built.explicitDuration !== undefined) {
      if (groupMeta.explicitDuration === undefined) {
        groupMeta.explicitDuration = built.explicitDuration;
        groupMeta.explicitDurationLocation = parsed.timeInfo.location;
      } else if (groupMeta.explicitDuration !== built.explicitDuration) {
        this.reportDurationConflict(groupMeta, parsed.timeInfo.location);
      }
    }

    if (built.inferredDuration !== undefined) {
      if (groupMeta.inferredDuration === undefined) {
        groupMeta.inferredDuration = built.inferredDuration;
        groupMeta.inferredDurationLocation = parsed.timeInfo.location;
      } else if (groupMeta.inferredDuration !== built.inferredDuration) {
        this.reportDurationConflict(groupMeta, parsed.timeInfo.location);
      }
    }

    if (!this.mergeLineContent(target, lineContent, parsed.textLocation, parsed.timeInfo.time, parsed.timeInfo.rawTag)) {
      return false;
    }

    if (built.pendingRefTime !== undefined) {
      this.pendingReferences.push({
        targetTimeMs: parsed.timeInfo.time,
        targetTimeTag: parsed.timeInfo.rawTag,
        refTimeMs: built.pendingRefTime,
        rawRefTag: lineContent.attr?.ref ?? "",
        location: parsed.textLocation,
      });
    }

    return !this.abortRequested && !this.partialRequested;
  }

  protected reportDurationConflict(
    groupMeta: GroupMeta,
    location: LRCXSourceLocation,
  ): void {
    if (groupMeta.durationConflictReported) {
      return;
    }
    groupMeta.durationConflictReported = true;
    this.emitDiagnostic(LRCXErrorTypes.TIMING_INCONSISTENT, {
      location,
      lineTag: groupMeta.timeTag,
      timeMs: groupMeta.timeMs,
      meta: {
        explicitDuration: groupMeta.explicitDuration,
        inferredDuration: groupMeta.inferredDuration,
      },
    });
  }

  protected mergeLineContent(
    target: LyricLineContent,
    source: LyricLineContent,
    location: LRCXSourceLocation,
    timeMs: number,
    lineTag: string,
  ): boolean {
    if (source.text) {
      const isDerivedText = Boolean(
        source.timing || source.phonetic.some((item) => item.type === "supermark"),
      );
      if (target.text && target.text !== source.text) {
        if (isDerivedText) {
          this.emitDiagnostic(LRCXErrorTypes.TIMING_INCONSISTENT, {
            location,
            lineTag,
            timeMs,
            desc: "Derived text does not exactly match the explicit main line",
          });
        } else {
          const action = this.emitDiagnostic(LRCXErrorTypes.NON_IDENTICAL_LINE, {
            location,
            lineTag,
            timeMs,
            lyricPosition: {
              timeMs,
              timeTag: lineTag,
            },
          });
          return !this.isStopAction(action);
        }
      }
      if (!target.text) {
        target.text = source.text;
      }
    }

    if (source.timing) {
      if (target.timing && !sameTimingRanges(target.timing, source.timing)) {
        const action = this.emitDiagnostic(LRCXErrorTypes.NON_IDENTICAL_LINE, {
          location,
          lineTag,
          timeMs,
          desc: "Conflicting timing track detected in the same lyric group",
        });
        if (this.isStopAction(action)) {
          return false;
        }
      } else if (!target.timing) {
        target.timing = source.timing.map((item) => ({ ...item }));
      }
    }

    for (const [lang, value] of Object.entries(source.trans)) {
      if (!value) {
        continue;
      }
      if (target.trans[lang] && target.trans[lang] !== value) {
        const action = this.emitDiagnostic(LRCXErrorTypes.NON_IDENTICAL_LINE, {
          location,
          lineTag,
          timeMs,
          desc: `Conflicting translation track detected for '${lang || "default"}'`,
        });
        if (this.isStopAction(action)) {
          return false;
        }
        continue;
      }
      target.trans[lang] = value;
    }

    for (const phonetic of source.phonetic) {
      const existed = target.phonetic.find((item) => item.name === phonetic.name);
      if (!existed) {
        target.phonetic.push(clonePhonetic(phonetic));
        continue;
      }
      if (!samePhonetic(existed, phonetic)) {
        const action = this.emitDiagnostic(LRCXErrorTypes.NON_IDENTICAL_LINE, {
          location,
          lineTag,
          timeMs,
          desc: `Conflicting phonetic track detected for '${phonetic.name}'`,
        });
        if (this.isStopAction(action)) {
          return false;
        }
      }
    }

    const backOffsetBase = target.back?.length ?? 0;
    if (source.back?.length) {
      target.back = target.back ?? [];
      for (const backTrack of source.back) {
        target.back.push(backTrack.map((token) => ({ ...token })));
      }
    }

    for (const mark of source.marks) {
      if (!target.marks.includes(mark)) {
        target.marks.push(mark);
      }
    }

    for (const hanging of source.hangings) {
      target.hangings.push(cloneHangingLine(hanging));
    }

    if (source.attr) {
      target.attr = target.attr ?? {};
      for (const [rawKey, value] of Object.entries(source.attr)) {
        const key = rawKey.replace(/^back\.(\d+)\./, (_, index) => `back.${Number(index) + backOffsetBase}.`);
        if (target.attr[key] && target.attr[key] !== value) {
          this.emitDiagnostic(LRCXErrorTypes.NON_IDENTICAL_LINE, {
            location,
            lineTag,
            timeMs,
            desc: `Conflicting attribute '${key}' detected in the same lyric group`,
          });
        }
        target.attr[key] = value;
      }
    }

    return true;
  }

  protected resolveReferences(): void {
    this.currentPhase = "finalize";

    for (const pending of this.pendingReferences) {
      const targetIndex = this.groupIndexByTime.get(pending.targetTimeMs);
      const refIndex = this.groupIndexByTime.get(pending.refTimeMs);

      if (
        targetIndex === undefined ||
        refIndex === undefined ||
        pending.refTimeMs >= pending.targetTimeMs
      ) {
        const action = this.emitDiagnostic(LRCXErrorTypes.INVALID_REFERENCE, {
          location: pending.location,
          lineTag: pending.targetTimeTag,
          timeMs: pending.targetTimeMs,
          desc: `Reference target '${pending.rawRefTag}' must point to an earlier lyric group`,
        });
        if (this.isStopAction(action)) {
          return;
        }
        continue;
      }

      const reference = this.ins.lines[refIndex];
      const target = this.ins.lines[targetIndex];
      if (!reference.text) {
        const action = this.emitDiagnostic(LRCXErrorTypes.INVALID_REFERENCE, {
          location: pending.location,
          lineTag: pending.targetTimeTag,
          timeMs: pending.targetTimeMs,
          desc: `Reference target '${pending.rawRefTag}' has no resolvable main text`,
        });
        if (this.isStopAction(action)) {
          return;
        }
        continue;
      }

      const clone = createLrcxLine(reference.text);
      clone.timing = reference.timing?.map((item) => ({ ...item }));
      clone.trans = { ...reference.trans };
      clone.phonetic = reference.phonetic.map((item) => clonePhonetic(item));
      clone.attr = { ref: pending.rawRefTag };

      if (!this.mergeLineContent(target, clone, pending.location, pending.targetTimeMs, pending.targetTimeTag)) {
        return;
      }
    }
  }

  protected finalizeDocument(): void {
    this.currentPhase = "finalize";

    for (let index = 0; index < this.ins.lines.length; index += 1) {
      const line = this.ins.lines[index];
      if (
        line.text &&
        this.ins.voice.length > 0 &&
        !line.marks.some((mark) => this.ins.voice.includes(mark))
      ) {
        line.marks.unshift(this.ins.voice[0]);
      }
    }

    this.ins.ends = this.ins.times.map((time, index) => {
      const meta = this.groupMetaByTime.get(time);
      if (meta?.explicitDuration !== undefined) {
        return time + meta.explicitDuration;
      }
      if (meta?.inferredDuration !== undefined) {
        return time + meta.inferredDuration;
      }
      if (index < this.ins.times.length - 1) {
        return this.ins.times[index + 1];
      }
      return Infinity;
    });
  }

  public parse(): LRCXInstance {
    try {
      if (!this.globalScan() || this.abortRequested) {
        return this.finish();
      }
      if (!this.resolveHead() || this.abortRequested) {
        return this.finish();
      }
      this.resolveBody();
      if (!this.abortRequested) {
        this.resolveReferences();
      }
      if (!this.abortRequested) {
        this.finalizeDocument();
      }
      return this.finish();
    } catch (error) {
      this.abortRequested = true;
      this.emitDiagnostic(LRCXErrorTypes.SYNTAX_ERROR, {
        action: "abort",
        desc: error instanceof Error ? error.message : "Unexpected parser exception",
      });
      return this.finish();
    }
  }

  protected finish(): LRCXInstance {
    if (this.abortRequested) {
      this.ins.status = LyricParseStatus.Abort;
    } else if (this.partialRequested) {
      this.ins.status = this.ins.lines.length > 0 ? LyricParseStatus.Partial : LyricParseStatus.Abort;
    } else if (this.getMode() === LyricResolveMode.Loose && this.fragmentRequested) {
      this.ins.status = this.ins.lines.length > 0 ? LyricParseStatus.Fragment : LyricParseStatus.Abort;
    } else {
      this.ins.status = LyricParseStatus.Success;
    }
    return this.ins;
  }

  public readOpt(dotPath: string): unknown {
    return getLRCXOptStruct(this.ins.marksOpt, dotPath.split(".").filter(Boolean));
  }

  public getErrors(): LRCXError[] {
    return this.errors;
  }

  public getWarnings(): LRCXError[] {
    return this.warnings;
  }
}

export class LRCXStrictParser extends LRCXParserBase {
  constructor(text:string, options:LRCXParserOptions){
    super(text, options)
  }

  protected getMode(): LyricResolveMode {
    return LyricResolveMode.Strict;
  }
}

export class LRCXStandardParser extends LRCXParserBase {
  constructor(text:string, options:LRCXParserOptions){
    super(text, options)
  }

  protected getMode(): LyricResolveMode {
    return LyricResolveMode.Standard;
  }
}

export class LRCXLooseParser extends LRCXParserBase {
  constructor(text:string, options:LRCXParserOptions){
    super(text, options)
  }
  
  protected getMode(): LyricResolveMode {
    return LyricResolveMode.Loose;
  }
}

export function createLRCXParser(
  text: string,
  mode: LyricResolveMode = LyricResolveMode.Standard,
  options: LRCXParserOptions = {},
): LRCXParserBase {
  switch (mode) {
    case LyricResolveMode.Strict:
      return new LRCXStrictParser(text, options);
    case LyricResolveMode.Loose:
      return new LRCXLooseParser(text, options);
    default:
      return new LRCXStandardParser(text, options);
  }
}

export function parseLRCX(
  text: string,
  mode: LyricResolveMode = LyricResolveMode.Standard,
  options: LRCXParserOptions = {},
): LRCXInstance {
  return createLRCXParser(text, mode, options).parse();
}

function splitSourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  if (!text) {
    return lines;
  }

  let start = 0;
  let lineNumber = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") {
      continue;
    }
    const rawLine = normalizeSourceLine(trimTrailingCarriageReturn(text.slice(start, index)), lineNumber);
    lines.push({
      raw: rawLine,
      trimmed: rawLine.trim(),
      line: lineNumber,
      startOffset: start,
      section: "global",
    });
    start = index + 1;
    lineNumber += 1;
  }

  if (start < text.length) {
    const rawLine = normalizeSourceLine(trimTrailingCarriageReturn(text.slice(start)), lineNumber);
    lines.push({
      raw: rawLine,
      trimmed: rawLine.trim(),
      line: lineNumber,
      startOffset: start,
      section: "global",
    });
  }

  return lines;
}

function trimTrailingCarriageReturn(text: string): string {
  return text.endsWith("\r") ? text.slice(0, -1) : text;
}

function normalizeSourceLine(text: string, lineNumber: number): string {
  return lineNumber === 1 && text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function setNestedStringArray(
  target: Record<string, unknown>,
  path: string[],
  value: string[],
): boolean {
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const current = cursor[key];
    if (current === undefined) {
      cursor[key] = {};
      cursor = cursor[key] as Record<string, unknown>;
      continue;
    }
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return false;
    }
    cursor = current as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
  return true;
}

function setNestedString(
  target: Record<string, unknown>,
  path: string[],
  value: string,
): boolean {
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const current = cursor[key];
    if (current === undefined) {
      cursor[key] = {};
      cursor = cursor[key] as Record<string, unknown>;
      continue;
    }
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return false;
    }
    cursor = current as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
  return true;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findUnescaped(text: string, target: string, fromIndex: number): number {
  for (let index = fromIndex; index < text.length; index += 1) {
    if (text[index] === target && !isEscaped(text, index)) {
      return index;
    }
  }
  return -1;
}

function isNumeric(text: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(text);
}

function sameTimingRanges(a: LyricTimingRange[], b: LyricTimingRange[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.start !== right.start ||
      left.duration !== right.duration ||
      left.token !== right.token ||
      left.easing !== right.easing ||
      left.haltperchar !== right.haltperchar
    ) {
      return false;
    }
  }
  return true;
}

function sameTimingTokens(a: LyricTimingToken[], b: LyricTimingToken[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left.begin !== right.begin || left.end !== right.end || left.token !== right.token) {
      return false;
    }
  }
  return true;
}

function samePhonetic(a: LyricPhonetic, b: LyricPhonetic): boolean {
  if (a.type !== b.type || a.name !== b.name) {
    return false;
  }
  if (a.type === "supermark" && b.type === "supermark") {
    if (a.parts.length !== b.parts.length) {
      return false;
    }
    return a.parts.every((part, index) => {
      const right = b.parts[index];
      return part.offset === right.offset && part.len === right.len && part.token === right.token;
    });
  }
  if (a.type === "brief" && b.type === "brief") {
    return sameTimingTokens(a.timing, b.timing);
  }
  if ((a.type === "" || a.type === "full") && (b.type === "" || b.type === "full")) {
    return sameTimingRanges(a.timing, b.timing);
  }
  return false;
}

function clonePhonetic(phonetic: LyricPhonetic): LyricPhonetic {
  const clonedLine = cloneLyricLineContent({
    text: "",
    timing: undefined,
    trans: { "": "" },
    phonetic: [phonetic],
    back: undefined,
    marks: [],
    hangings: [],
    attr: undefined,
  });
  return clonedLine.phonetic[0];
}

function cloneHangingLine(hanging: LyricHangingLine): LyricHangingLine {
  const cloned: LyricHangingLine = {
    raw: hanging.raw,
    text: hanging.text,
    marks: [...hanging.marks],
  };
  if (hanging.attr) {
    cloned.attr = { ...hanging.attr };
  }
  if (hanging.values) {
    cloned.values = [...hanging.values];
  }
  return cloned;
}
