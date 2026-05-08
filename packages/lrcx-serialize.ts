import {
  flattenOptionTree,
  formatLyricTimeTag,
  parseLyricTimeDetailed,
} from "./lrcx-utils.js";
import { LrcxConstants } from "./lrcx-type.js";
import type {
  LRCXInstance,
  LyricLineContent,
  LyricPhonetic,
  LyricTimingRange,
  LyricTimingToken,
  LyricTokenRange,
  SongInfo,
} from "./lrcx-type.js";

export interface LRCXSerializeOptions {
  newline?: "\n" | "\r\n";
}

const STANDARD_MORE_KEYS = [
  "titlesort",
  "artistsort",
  "date",
  "releasetype",
  "label",
  "copyright",
  "language",
] as const;

const ARRAY_META_KEYS = [
  "artist",
  "lyricist",
  "composer",
  "arranger",
  "recording",
  "mixing",
  "mastering",
  "instrumentalists",
  "producer",
] as const;

const enum EscapeContext {
  BodyText,
  TagListValue,
  TimingText,
  SupermarkText,
}

export function serializeLRCX(
  instance: LRCXInstance,
  options: LRCXSerializeOptions = {},
): string {
  const newline = options.newline ?? "\n";

  // validateInstanceShape(instance);

  const lines = [
    ...serializeHead(instance),
    LrcxConstants.LRCXMarkTag,
    ...serializeBody(instance),
  ];

  return lines.join(newline);
}

export const stringifyLRCX = serializeLRCX;

function validateInstanceShape(instance: LRCXInstance): void {
  const groupCount = instance.lines.length;
  if (
    instance.times.length !== groupCount ||
    instance.ends.length !== groupCount ||
    instance.lineTags.length !== groupCount
  ) {
    throw new TypeError(
      "LRCXInstance group arrays must have identical lengths: lineTags/times/ends/lines",
    );
  }
}

function serializeHead(instance: LRCXInstance): string[] {
  const lines: string[] = [];
  const { songInfo } = instance;

  const titleContent = buildTitleContent(songInfo);
  if (titleContent) {
    pushHeadLine(lines, "#title", titleContent);
  }

  if (songInfo.album) {
    pushHeadLine(lines, "#album", songInfo.album);
  }

  for (const key of ARRAY_META_KEYS) {
    const values = songInfo[key];
    if (values.length > 0) {
      pushHeadLine(lines, `#${key}`, joinTagValues(values));
    }
  }

  for (const key of STANDARD_MORE_KEYS) {
    const value = songInfo.more[key];
    if (value) {
      pushHeadLine(lines, `#${key}`, value);
    }
  }

  const extraMetaKeys = Object.keys(songInfo.more).filter(
    (key) => !STANDARD_MORE_KEYS.includes(key as (typeof STANDARD_MORE_KEYS)[number]),
  );
  for (const key of extraMetaKeys) {
    pushHeadLine(lines, `#more:${key}`, songInfo.more[key]);
  }

  if (instance.offset !== 0) {
    pushHeadLine(lines, "#offset", formatNumber(instance.offset));
  }

  serializeDeclaredTagList(lines, "voice", instance.voice, instance);
  serializeDeclaredTagList(lines, "trans", instance.trans.filter(Boolean), instance);
  serializeDeclaredTagList(lines, "phonetic", instance.phonetic, instance);
  serializeDeclaredTagList(lines, "marks", instance.marks, instance);

  const optionEntries = collectOptionEntries(instance);
  if (optionEntries.length > 0) {
    pushHeadLine(
      lines,
      `#OPTION:${optionEntries.map(([key]) => key).join(",")}`,
      joinTagValues(optionEntries.map(([, value]) => value)),
    );
  }

  const easingNames = Object.keys(instance.easing);
  if (easingNames.length > 0) {
    pushHeadLine(
      lines,
      `#Easing:${easingNames.join(",")}`,
      easingNames.map((name) => serializeEasing(instance.easing[name])).join("; "),
    );
  }

  serializeByLines(lines, instance);
  serializeNoteLines(lines, instance);
  serializeExtraHeadComments(lines, instance);

  return lines;
}

function serializeBody(instance: LRCXInstance): string[] {
  const lines: string[] = [];

  for (let index = 0; index < instance.lines.length; index += 1) {
    const line = instance.lines[index];
    const timeMs = instance.times[index];
    const timeTag = buildBodyTimeTag(instance, index, line);
    const referenceSource = getReferenceSource(instance, line);
    const useReferenceLine = canSerializeAsReference(line, referenceSource);

    if (useReferenceLine) {
      const modifierTags = serializeModifierTags(instance, line);
      lines.push(`${timeTag}[#ref:${line.attr!.ref}]${modifierTags.join("")}`);
    } else {
      const modifierTags = serializeModifierTags(instance, line);
      lines.push(`${timeTag}${modifierTags.join("")}${escapeText(line.text, EscapeContext.BodyText)}`);
    }

    if (line.timing && !(useReferenceLine && sameTimingRanges(line.timing, referenceSource?.timing))) {
      lines.push(`${timeTag}[#timing]${serializeTimingRanges(line.timing)}`);
    }

    for (const phonetic of getOrderedPhonetics(instance, line)) {
      const sourceTrack = referenceSource?.phonetic.find((item) => item.name === phonetic.name);
      if (useReferenceLine && sourceTrack && samePhonetic(phonetic, sourceTrack)) {
        continue;
      }
      lines.push(`${timeTag}[#${phonetic.name}]${serializePhonetic(line.text, phonetic)}`);
    }

    for (const [lang, value] of getOrderedTranslations(instance, line)) {
      if (!value) {
        continue;
      }
      if (useReferenceLine && referenceSource?.trans[lang] === value) {
        continue;
      }
      const trackTag = lang ? `[#${lang}]` : "[#trans]";
      lines.push(`${timeTag}${trackTag}${escapeText(value, EscapeContext.BodyText)}`);
    }

    if (line.back) {
      for (let backIndex = 0; backIndex < line.back.length; backIndex += 1) {
        const backTrack = line.back[backIndex];
        const { offset, content } = serializeBackTrack(backTrack);
        const backTags = serializeBackAttrTags(line, backIndex);
        lines.push(`${timeTag}[#back:${offset}]${backTags.join("")}${content}`);
      }
    }

    if (!line.text && !line.attr?.ref && !line.timing && !line.back && timeMs >= 0) {
      continue;
    }

    lines.push('');
  }
  
  return lines;
}

function buildTitleContent(songInfo: SongInfo): string {
  const parts = [songInfo.title].filter(Boolean);

  if (songInfo.titleProps.cover) {
    parts.push(`[Cover:${songInfo.titleProps.cover}]`);
  }
  if (songInfo.titleProps.version) {
    parts.push(`{${songInfo.titleProps.version}}`);
  }
  if (songInfo.titleProps.feat.length > 0) {
    parts.push(`[feat:${joinTagValues(songInfo.titleProps.feat)}]`);
  }
  if (songInfo.titleProps.explicit) {
    parts.push("[Explicit]");
  }
  for (const note of songInfo.titleProps.notes) {
    parts.push(`(${note})`);
  }

  return parts.join(" ").trim();
}

function serializeDeclaredTagList(
  lines: string[],
  tagName: string,
  names: string[],
  instance: LRCXInstance,
): void {
  if (names.length === 0) {
    return;
  }

  const values = names.map((name) => getRootOption(instance, name));
  pushHeadLine(
    lines,
    `#${tagName}:${names.join(",")}`,
    values.some(Boolean) ? joinTagValues(values) : "",
  );
}

function collectOptionEntries(instance: LRCXInstance): Array<[string, string]> {
  const entries: Array<[string, string]> = [];

  for (const [base, tree] of Object.entries(instance.marksOpt)) {
    const flat = flattenOptionTree(base, tree);
    for (const [key, value] of Object.entries(flat)) {
      entries.push([key, value]);
    }
  }

  return entries;
}

function serializeEasing(easing: { x: number[]; y: number[] }): string {
  if (easing.x.length !== easing.y.length) {
    throw new RangeError("Easing x/y control point lengths must match");
  }

  const points: string[] = [];
  for (let index = 0; index < easing.x.length; index += 1) {
    points.push(formatNumber(easing.x[index]), formatNumber(easing.y[index]));
  }

  return `besier(${points.join(",")})`;
}

function serializeByLines(lines: string[], instance: LRCXInstance): void {
  const entries = collectStringArrayEntries(instance.lyricInfo.by);
  for (const [path, values] of entries) {
    pushHeadLine(lines, path ? `#by:${path}` : "#by", joinTagValues(values));
  }
}

function serializeNoteLines(lines: string[], instance: LRCXInstance): void {
  const note = instance.lyricComment.note;
  if (note[""]) {
    pushHeadLine(lines, "#note", note[""]);
  }

  const entries = collectStringEntries(note);
  for (const [path, value] of entries) {
    if (!path) {
      continue;
    }
    pushHeadLine(lines, `#note:${path}`, value);
  }
}

function serializeExtraHeadComments(lines: string[], instance: LRCXInstance): void {
  for (const [key, rawValue] of Object.entries(instance.lyricComment)) {
    if (key === "note" || rawValue === undefined || rawValue === null) {
      continue;
    }
    if (typeof rawValue === "string") {
      pushHeadLine(lines, key, rawValue);
      continue;
    }
    if (isRecord(rawValue) && typeof rawValue[""] === "string") {
      pushHeadLine(lines, key, rawValue[""]);
    }
  }
}

function collectStringArrayEntries(
  tree: unknown,
  prefix: string[] = [],
): Array<[string, string[]]> {
  const entries: Array<[string, string[]]> = [];
  if (!isRecord(tree)) {
    return entries;
  }

  if (Array.isArray(tree[""]) && (tree[""] as string[]).length > 0) {
    entries.push([prefix.join("."), tree[""] as string[]]);
  }

  for (const [key, value] of Object.entries(tree)) {
    if (key === "") {
      continue;
    }
    if (Array.isArray(value) && value.length > 0) {
      entries.push([[...prefix, key].join("."), value as string[]]);
      continue;
    }
    if (isRecord(value)) {
      entries.push(...collectStringArrayEntries(value, [...prefix, key]));
    }
  }

  return entries;
}

function collectStringEntries(
  tree: unknown,
  prefix: string[] = [],
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (!isRecord(tree)) {
    return entries;
  }

  if (typeof tree[""] === "string" && tree[""] !== "") {
    entries.push([prefix.join("."), tree[""]]);
  }

  for (const [key, value] of Object.entries(tree)) {
    if (key === "") {
      continue;
    }
    if (typeof value === "string" && value !== "") {
      entries.push([[...prefix, key].join("."), value]);
      continue;
    }
    if (isRecord(value)) {
      entries.push(...collectStringEntries(value, [...prefix, key]));
    }
  }

  return entries;
}

function buildBodyTimeTag(
  instance: LRCXInstance,
  index: number,
  line: LyricLineContent,
): string {
  const explicitDuration = parseExplicitDuration(instance.lineTags[index]);
  const duration = explicitDuration ?? getIntrinsicDuration(line);
  return formatLyricTimeTag(instance.times[index], duration);
}

function parseExplicitDuration(rawTag: string): number | undefined {
  const plusIndex = rawTag.indexOf("+");
  if (plusIndex === -1) {
    return undefined;
  }
  const durationText = rawTag.slice(plusIndex + 1).trim();
  if (!/^\d+$/.test(durationText)) {
    return undefined;
  }
  return Number.parseInt(durationText, 10);
}

function getIntrinsicDuration(line: LyricLineContent): number | undefined {
  if (line.timing) {
    return getTimingDuration(line.timing);
  }

  for (const phonetic of line.phonetic) {
    if (phonetic.type === "supermark") {
      continue;
    }
    return phonetic.type === "brief"
      ? getTokenDuration(phonetic.timing)
      : getTimingDuration(phonetic.timing);
  }

  return undefined;
}

function getTimingDuration(ranges: LyricTimingRange[]): number {
  if (ranges.length === 0) {
    return 0;
  }
  const last = ranges[ranges.length - 1];
  return last.start + last.duration;
}

function getTokenDuration(tokens: LyricTimingToken[]): number {
  if (tokens.length === 0) {
    return 0;
  }
  return tokens[tokens.length - 1].end;
}

function getReferenceSource(
  instance: LRCXInstance,
  line: LyricLineContent,
): LyricLineContent | undefined {
  const refRaw = line.attr?.ref;
  if (!refRaw) {
    return undefined;
  }

  const parsed = parseLyricTimeDetailed(refRaw);
  if (!parsed) {
    return undefined;
  }

  const index = instance.times.indexOf(parsed.time);
  return index >= 0 ? instance.lines[index] : undefined;
}

function canSerializeAsReference(
  line: LyricLineContent,
  referenceSource: LyricLineContent | undefined,
): boolean {
  if (!line.attr?.ref || !referenceSource) {
    return false;
  }

  if (line.text !== referenceSource.text) {
    return false;
  }

  if (referenceSource.timing && !sameTimingRanges(line.timing, referenceSource.timing)) {
    return false;
  }

  for (const [lang, sourceValue] of Object.entries(referenceSource.trans)) {
    if (!sourceValue) {
      continue;
    }
    if (line.trans[lang] !== sourceValue) {
      return false;
    }
  }

  for (const sourcePhonetic of referenceSource.phonetic) {
    const current = line.phonetic.find((item) => item.name === sourcePhonetic.name);
    if (!current || !samePhonetic(current, sourcePhonetic)) {
      return false;
    }
  }

  return true;
}

function serializeModifierTags(
  instance: LRCXInstance,
  line: LyricLineContent,
): string[] {
  const tags: string[] = [];
  const attrs = line.attr ? Object.entries(line.attr) : [];
  const grouped = new Map<string, Array<[string, string]>>();

  for (const [key, value] of attrs) {
    if (!value || key === "ref" || key.startsWith("back.")) {
      continue;
    }
    const base = key.split(".")[0];
    const bucket = grouped.get(base);
    if (bucket) {
      bucket.push([key, value]);
    } else {
      grouped.set(base, [[key, value]]);
    }
  }

  const renderedAttrKeys = new Set<string>();

  for (const mark of line.marks) {
    tags.push(`[#${mark}]`);
    const related = grouped.get(mark) ?? [];
    for (const [key, value] of related) {
      if (shouldOmitAttr(instance, line, key, value)) {
        renderedAttrKeys.add(key);
        continue;
      }
      tags.push(renderAttrTag(key, value));
      renderedAttrKeys.add(key);
    }
  }

  for (const [base, entries] of grouped.entries()) {
    if (line.marks.includes(base)) {
      continue;
    }
    for (const [key, value] of entries) {
      if (renderedAttrKeys.has(key)) {
        continue;
      }
      tags.push(renderAttrTag(key, value));
    }
  }

  return tags;
}

function shouldOmitAttr(
  instance: LRCXInstance,
  line: LyricLineContent,
  key: string,
  value: string,
): boolean {
  if (!key.includes(".")) {
    return false;
  }

  const base = key.split(".")[0];
  if (!line.marks.includes(base)) {
    return false;
  }

  return getNestedOption(instance.marksOpt, key.split(".")) === value;
}

function renderAttrTag(key: string, value: string): string {
  validateInlineTagArg(value, key);
  return `[#${key}:${value}]`;
}

function serializeBackAttrTags(
  line: LyricLineContent,
  backIndex: number,
): string[] {
  if (!line.attr) {
    return [];
  }

  const tags: string[] = [];
  const prefix = `back.${backIndex}.`;
  for (const [key, value] of Object.entries(line.attr)) {
    if (!key.startsWith(prefix) || !value) {
      continue;
    }
    const localKey = key.slice(prefix.length);
    tags.push(renderAttrTag(localKey, value));
  }
  return tags;
}

function getOrderedTranslations(
  instance: LRCXInstance,
  line: LyricLineContent,
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const lang of instance.trans.filter(Boolean)) {
    if (line.trans[lang]) {
      entries.push([lang, line.trans[lang]]);
      seen.add(lang);
    }
  }

  for (const [lang, value] of Object.entries(line.trans)) {
    if (!lang || !value || seen.has(lang)) {
      continue;
    }
    entries.push([lang, value]);
    seen.add(lang);
  }

  if (line.trans[""]) {
    entries.push(["", line.trans[""]]);
  }

  return entries;
}

function getOrderedPhonetics(
  instance: LRCXInstance,
  line: LyricLineContent,
): LyricPhonetic[] {
  const phoneticByName = new Map(line.phonetic.map((item) => [item.name, item]));
  const ordered: LyricPhonetic[] = [];
  const seen = new Set<string>();

  for (const name of instance.phonetic) {
    const item = phoneticByName.get(name);
    if (!item) {
      continue;
    }
    ordered.push(item);
    seen.add(name);
  }

  for (const item of line.phonetic) {
    if (!seen.has(item.name)) {
      ordered.push(item);
    }
  }

  return ordered;
}

function serializePhonetic(text: string, phonetic: LyricPhonetic): string {
  if (phonetic.type === "supermark") {
    return serializeSupermark(text, phonetic.parts);
  }
  if (phonetic.type === "brief") {
    return serializeTimingTokens(phonetic.timing);
  }
  return serializeTimingRanges(phonetic.timing);
}

function serializeTimingRanges(ranges: LyricTimingRange[]): string {
  let currentStart = 0;
  let output = "";

  for (const range of ranges) {
    if (range.start !== currentStart) {
      throw new RangeError(
        `Timing ranges must be contiguous from 0, received ${range.start} after ${currentStart}`,
      );
    }
    output += escapeText(range.token, EscapeContext.TimingText);
    output += `<${serializeTimingMarker(range.duration, range.easing, range.haltperchar)}>`;
    currentStart += range.duration;
  }

  return output;
}

function serializeTimingTokens(tokens: LyricTimingToken[]): string {
  if (tokens.length === 0) {
    return "";
  }

  let currentTime = tokens[0].begin;
  let output = "";

  for (const token of tokens) {
    if (token.begin !== currentTime) {
      throw new RangeError(
        `Timing tokens must be contiguous, received ${token.begin} after ${currentTime}`,
      );
    }
    output += escapeText(token.token, EscapeContext.TimingText);
    output += `<${token.end - token.begin}>`;
    currentTime = token.end;
  }

  return output;
}

function serializeBackTrack(
  tokens: LyricTimingToken[],
): { offset: number; content: string } {
  if (tokens.length === 0) {
    return { offset: 0, content: "" };
  }

  const offset = tokens[0].begin;
  let currentTime = offset;
  let content = "";

  for (const token of tokens) {
    if (token.begin !== currentTime) {
      throw new RangeError(
        `Backing track tokens must be contiguous, received ${token.begin} after ${currentTime}`,
      );
    }
    content += escapeText(token.token, EscapeContext.TimingText);
    content += `<${token.end - token.begin}>`;
    currentTime = token.end;
  }

  return { offset, content };
}

function serializeTimingMarker(
  duration: number,
  easing?: string,
  haltperchar?: number,
): string {
  let marker = String(duration);

  if (easing || haltperchar !== undefined) {
    marker += ":";
  }
  if (easing) {
    marker += easing;
  }
  if (haltperchar !== undefined) {
    marker += `${easing ? "." : "."}${formatNumber(haltperchar)}`;
  }

  return marker;
}

function serializeSupermark(text: string, parts: LyricTokenRange[]): string {
  let cursor = 0;
  let output = "";

  for (const part of parts) {
    if (part.offset < cursor || part.len < 0 || part.offset + part.len > text.length) {
      throw new RangeError("Supermark ranges must be ordered and stay inside the main text");
    }

    output += escapeText(text.slice(cursor, part.offset), EscapeContext.SupermarkText);
    output += `<^${escapeText(part.token, EscapeContext.SupermarkText)}>`;
    output += escapeText(
      text.slice(part.offset, part.offset + part.len),
      EscapeContext.SupermarkText,
    );
    output += "^";
    cursor = part.offset + part.len;
  }

  output += escapeText(text.slice(cursor), EscapeContext.SupermarkText);
  return output;
}

function escapeText(text: string, context: EscapeContext): string {
  let escaped = text.replace(/\\/g, "\\\\");

  switch (context) {
    case EscapeContext.TagListValue:
      escaped = escaped.replace(/,/g, "\\,");
      return escaped;
    case EscapeContext.SupermarkText:
      return escaped.replace(/[[\]<>^]/g, "\\$&");
    case EscapeContext.TimingText:
      return escaped.replace(/[[\]<>^]/g, "\\$&");
    case EscapeContext.BodyText:
    default:
      return escaped.replace(/[[\]<>^]/g, "\\$&");
  }
}

function joinTagValues(values: string[]): string {
  return values.map((value) => escapeText(value, EscapeContext.TagListValue)).join(", ");
}

function pushHeadLine(lines: string[], tag: string, content: string): void {
  lines.push(content ? `[${tag}] ${content}` : `[${tag}]`);
}

function getRootOption(instance: LRCXInstance, key: string): string {
  const tree = instance.marksOpt[key];
  if (!isRecord(tree)) {
    return "";
  }
  const value = tree[""];
  return typeof value === "string" ? value : "";
}

function getNestedOption(
  tree: Record<string, unknown>,
  path: string[],
): string | undefined {
  let current: unknown = tree;

  for (const part of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }

  if (!isRecord(current)) {
    return undefined;
  }
  return typeof current[""] === "string" ? current[""] : undefined;
}

function validateInlineTagArg(value: string, key: string): void {
  if (value.includes("]")) {
    throw new RangeError(`Attribute '${key}' cannot be serialized because it contains ']'`);
  }
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(value)
    .replace(/(\.\d*?[1-9])0+$/u, "$1")
    .replace(/\.0+$/u, "");
}

function sameTimingRanges(
  left: LyricTimingRange[] | undefined,
  right: LyricTimingRange[] | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (
      left[index].start !== right[index].start ||
      left[index].duration !== right[index].duration ||
      left[index].token !== right[index].token ||
      left[index].easing !== right[index].easing ||
      left[index].haltperchar !== right[index].haltperchar
    ) {
      return false;
    }
  }

  return true;
}

function sameTimingTokens(
  left: LyricTimingToken[] | undefined,
  right: LyricTimingToken[] | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (
      left[index].begin !== right[index].begin ||
      left[index].end !== right[index].end ||
      left[index].token !== right[index].token
    ) {
      return false;
    }
  }

  return true;
}

function samePhonetic(left: LyricPhonetic, right: LyricPhonetic): boolean {
  if (left.type !== right.type || left.name !== right.name) {
    return false;
  }

  if (left.type === "supermark" && right.type === "supermark") {
    if (left.parts.length !== right.parts.length) {
      return false;
    }
    return left.parts.every((part, index) => {
      const target = right.parts[index];
      return (
        part.offset === target.offset &&
        part.len === target.len &&
        part.token === target.token
      );
    });
  }

  if (left.type === "brief" && right.type === "brief") {
    return sameTimingTokens(left.timing, right.timing);
  }

  if (
    (left.type === "" || left.type === "full") &&
    (right.type === "" || right.type === "full")
  ) {
    return sameTimingRanges(left.timing, right.timing);
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
