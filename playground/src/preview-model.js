const graphemeSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("ja", { granularity: "grapheme" })
  : null;

const EMPTY_TIMED_TEXT = {
  plainText: "",
  chars: [],
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function segmentGraphemes(text) {
  if (!text) {
    return [];
  }

  if (graphemeSegmenter) {
    return [...graphemeSegmenter.segment(text)].map((item) => item.segment);
  }

  return Array.from(text);
}

export function formatTime(ms) {
  const safeMs = Math.max(0, Math.floor(ms));
  const milliseconds = safeMs % 1000;
  const totalSeconds = Math.floor(safeMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const base = `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;

  return hours > 0 ? `${hours.toString().padStart(2, "0")}:${base}` : base;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) {
    return "Infinity";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
}

export function progressForChar(charTiming, timeMs) {
  const duration = charTiming.end - charTiming.start;
  if (duration <= 0) {
    return timeMs >= charTiming.end ? 1 : 0;
  }
  return clamp((timeMs - charTiming.start) / duration, 0, 1);
}

export function createPreviewModel(document, diagnostics) {
  const lines = document.lines.map((line, index) =>
    buildPreviewLine(document, line, index),
  );
  const gaps = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    if (next.start <= current.end) {
      continue;
    }

    gaps.push({
      id: `${index}-${index + 1}`,
      afterLineIndex: index,
      beforeLineIndex: index + 1,
      start: current.end,
      end: next.start,
      duration: next.start - current.end,
    });
  }

  const totalEnd = lines.at(-1)?.end ?? 0;

  return {
    title: document.songInfo.title,
    artist: document.songInfo.artist.join(" / "),
    album: document.songInfo.album,
    mode: document.mode,
    status: document.status,
    warnings: diagnostics.warnings,
    errors: diagnostics.errors,
    easing: document.easing,
    voice: document.voice,
    trans: document.trans,
    phonetic: document.phonetic,
    marks: document.marks,
    lines,
    gaps,
    totalEnd,
  };
}

function buildPreviewLine(document, line, index) {
  const start = document.times[index] ?? 0;
  const nextBoundary = document.ends[index];
  const fallbackDuration = getFallbackDuration(line.text);
  const end = Number.isFinite(nextBoundary) ? nextBoundary : start + fallbackDuration;
  const voiceMark = line.marks.find((mark) => document.voice.includes(mark)) ?? "";
  const extraMarks = line.marks.filter((mark) => mark !== voiceMark);
  const mainTimedText = line.timing?.length
    ? buildTimedTextFromRanges(line.timing, document.easing)
    : buildFallbackTimedText(line.text, Math.max(end - start, 800));

  return {
    index,
    id: `line-${index}`,
    start,
    end,
    duration: Math.max(0, end - start),
    timeTag: document.lineTags[index] ?? formatTime(start),
    text: line.text,
    voiceMark,
    extraMarks,
    translations: Object.entries(line.trans)
      .filter(([, value]) => Boolean(value))
      .map(([lang, value]) => ({
        lang: lang || "default",
        label: lang || "trans",
        value,
      })),
    phoneticTracks: line.phonetic.map((track) => buildPhoneticTrack(track, document.easing, line.text)),
    backTracks: (line.back ?? []).map((track, backIndex) => ({
      name: `back ${backIndex + 1}`,
      offsetLabel: track.length > 0 ? `+${formatDuration(track[0].begin)}` : "+0ms",
      timedText: buildTimedTextFromTokens(track),
    })),
    attr: line.attr ?? {},
    mainTimedText,
  };
}

function buildPhoneticTrack(track, easingMap, lineText) {
  if (track.type === "supermark") {
    return {
      type: "supermark",
      name: track.name,
      annotations: track.parts.map((part) => ({
        token: part.token,
        target: lineText.slice(part.offset, part.offset + part.len),
      })),
    };
  }

  if (track.type === "brief") {
    return {
      type: "brief",
      name: track.name,
      timedText: buildTimedTextFromTokens(track.timing),
    };
  }

  return {
    type: "full",
    name: track.name,
    timedText: buildTimedTextFromRanges(track.timing, easingMap),
  };
}

function buildTimedTextFromRanges(ranges, easingMap) {
  const chars = [];
  let plainText = "";

  for (const range of ranges) {
    plainText += range.token;
    chars.push(...expandTimingRange(range, easingMap));
  }

  return {
    plainText,
    chars,
  };
}

function buildTimedTextFromTokens(tokens) {
  const chars = [];
  let plainText = "";

  for (const token of tokens) {
    plainText += token.token;
    chars.push(...expandTokenTiming(token.begin, token.end, token.token));
  }

  return {
    plainText,
    chars,
  };
}

function buildFallbackTimedText(text, duration) {
  if (!text) {
    return EMPTY_TIMED_TEXT;
  }

  const graphemes = segmentGraphemes(text);
  const chars = [];
  const safeDuration = Math.max(duration, graphemes.length * 120);

  for (let index = 0; index < graphemes.length; index += 1) {
    chars.push({
      char: graphemes[index],
      start: (safeDuration / graphemes.length) * index,
      end: (safeDuration / graphemes.length) * (index + 1),
    });
  }

  return {
    plainText: text,
    chars,
  };
}

function expandTimingRange(range, easingMap) {
  const graphemes = segmentGraphemes(range.token);
  if (graphemes.length === 0) {
    return [];
  }

  const pausePerChar = Number.isFinite(range.haltperchar) ? Math.max(0, range.haltperchar) : 0;
  const totalPause = pausePerChar * Math.max(0, graphemes.length - 1);
  const activeDuration = Math.max(0, range.duration - totalPause);
  const easing = range.easing ? easingMap[range.easing] : null;
  const boundaries = [];

  for (let index = 0; index <= graphemes.length; index += 1) {
    const progressRatio = graphemes.length === 0 ? 0 : index / graphemes.length;
    const timeRatio = easing ? invertProgressOnBezier(easing, progressRatio) : progressRatio;
    boundaries.push(activeDuration * timeRatio);
  }

  return graphemes.map((char, index) => ({
    char,
    start: range.start + boundaries[index] + pausePerChar * index,
    end: range.start + boundaries[index + 1] + pausePerChar * index,
  }));
}

function expandTokenTiming(start, end, text) {
  const graphemes = segmentGraphemes(text);
  if (graphemes.length === 0) {
    return [];
  }

  const duration = Math.max(0, end - start);
  const unit = graphemes.length > 0 ? duration / graphemes.length : 0;

  return graphemes.map((char, index) => ({
    char,
    start: start + unit * index,
    end: index === graphemes.length - 1 ? end : start + unit * (index + 1),
  }));
}

function getFallbackDuration(text) {
  const graphemes = segmentGraphemes(text);
  return Math.max(1200, graphemes.length * 180);
}

function invertProgressOnBezier(easing, progress) {
  if (progress <= 0) {
    return 0;
  }
  if (progress >= 1) {
    return 1;
  }

  let low = 0;
  let high = 1;

  for (let index = 0; index < 18; index += 1) {
    const mid = (low + high) / 2;
    const value = evaluateBezierAtTime(easing, mid);
    if (value < progress) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

function evaluateBezierAtTime(easing, time) {
  const xPoints = [0, ...easing.x, 1];
  const yPoints = [0, ...easing.y, 1];
  let low = 0;
  let high = 1;

  for (let index = 0; index < 20; index += 1) {
    const mid = (low + high) / 2;
    const x = evaluateBezierCoordinate(xPoints, mid);
    if (x < time) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return evaluateBezierCoordinate(yPoints, (low + high) / 2);
}

function evaluateBezierCoordinate(points, t) {
  let working = points.slice();

  for (let step = working.length - 1; step > 0; step -= 1) {
    for (let index = 0; index < step; index += 1) {
      working[index] = working[index] + (working[index + 1] - working[index]) * t;
    }
  }

  return working[0] ?? 0;
}
