import { LRCXStandardParser } from "../../builds/packages/index.js";
import showcaseText from "../showcase/lrcx-example.lrcx?raw";
import {
  clamp,
  createPreviewModel,
  formatDuration,
  formatTime,
  progressForChar,
} from "./preview-model.js";
import "./styles.css";

const parser = new LRCXStandardParser(showcaseText);
const documentResult = parser.parse();
const previewModel = createPreviewModel(documentResult, {
  warnings: parser.getWarnings(),
  errors: parser.getErrors(),
});

const app = document.querySelector("#app");

if (!app) {
  throw new Error("Preview root not found.");
}

if (previewModel.errors.length > 0) {
  app.innerHTML = `
    <section class="hero-card">
      <div class="hero-top">
        <div class="hero-info">
          <h1 class="hero-title">Preview Failed</h1>
          <p class="hero-subtitle">The renderer could not continue with the current parser output.</p>
        </div>
      </div>
      <div class="diagnostic-list">
        ${previewModel.errors
          .map(
            (error) => `
              <div class="diagnostic-item">
                <strong>${error.Name}</strong>
                <small>${error.Desc}</small>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
  throw new Error("Preview parser returned errors.");
}

const state = {
  currentTime: previewModel.lines[0]?.start ?? 0,
  playing: false,
  playbackRate: 1,
  anchorVirtualTime: 0,
  anchorRealTime: 0,
  rafId: 0,
  activeLineIndex: 0,
  activeGapId: "",
};

const lineRefs = [];
const gapRefs = new Map();

render();
refresh();

function render() {
  app.innerHTML = `
    <div class="preview-shell">
      <section class="hero-card">
        <div class="hero-top">
          <div class="hero-info">
            <h1 class="hero-title">${previewModel.title}</h1>
            <p class="hero-subtitle">${previewModel.artist} / ${previewModel.album || "Single"}</p>
            <p class="hero-caption">Virtual lyric playback with parser-resolved timing and per-character easing render.</p>
            <button class="button button-warm hero-side-action" id="jump-gap">Jump Gap</button>
          </div>
          <div class="hero-controls">
            <div class="control-row hero-toolbar">
              <button class="button button-primary" id="toggle-play">Play</button>
              <button class="button" id="restart-line">Restart Line</button>
              <label class="toolbar-select" for="playback-rate-select">
                <span>Speed</span>
                <select id="playback-rate-select">
                  ${[0.75, 1, 1.25, 1.5]
                    .map(
                      (rate) => `
                        <option value="${rate}"${rate === state.playbackRate ? " selected" : ""}>${rate}x</option>
                      `,
                    )
                    .join("")}
                </select>
              </label>
              <label class="toolbar-select toolbar-select-wide" for="line-jump-select">
                <span>Jump To</span>
                <select class="line-jump-select" id="line-jump-select">
                  ${previewModel.lines
                    .map(
                      (line) => `
                        <option value="${line.index}">${formatLineJumpLabel(line)}</option>
                      `,
                    )
                    .join("")}
                </select>
              </label>
            </div>
            <div class="range-wrap hero-range-wrap">
              <div class="range-meta">
                <div class="range-copy">
                  <span class="range-label">Virtual Timeline</span>
                  <strong id="timeline-current-time">${formatTime(state.currentTime)}</strong>
                </div>
                <span class="range-total">${formatTime(previewModel.totalEnd)}</span>
              </div>
              <input
                class="time-range"
                id="timeline-range"
                type="range"
                min="0"
                max="${previewModel.totalEnd}"
                step="1"
                value="${state.currentTime}"
                aria-label="Virtual timeline"
              />
              <div class="timeline-scale">
                <span>00:00.000</span>
                <span id="timeline-current-line">Line #1</span>
                <span>${formatTime(previewModel.totalEnd)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="layout-grid">
        <aside class="sidebar">
          <section class="sidebar-card status-panel">
            <h2 class="sidebar-title">Status</h2>
            <div class="transport-stats transport-stats-compact">
              <div class="stat-block">
                <span class="stat-label">Current Time</span>
                <strong class="stat-value" id="current-time">00:00.000</strong>
              </div>
              <div class="stat-block">
                <span class="stat-label">Current Line</span>
                <strong class="stat-value" id="current-line-label">-</strong>
              </div>
              <div class="stat-block">
                <span class="stat-label">Total Range</span>
                <strong class="stat-value">${formatTime(previewModel.totalEnd)}</strong>
              </div>
            </div>
            <div class="status-pill-row">
              <span class="meta-pill">${previewModel.mode}</span>
              <span class="meta-pill">${previewModel.status}</span>
              <span class="meta-pill">${previewModel.lines.length} lines</span>
              <span class="meta-pill">${previewModel.warnings.length} warnings</span>
            </div>
            <div class="status-copy">
              <strong id="transport-state">Paused at the first line</strong>
              <small id="transport-detail">${previewModel.lines.length} lyric groups</small>
            </div>
          </section>
          <section class="sidebar-card notes-panel">
            <h2 class="sidebar-title">Render Notes</h2>
            <div class="snapshot-list">
              <div class="snapshot-item">
                <strong>Virtual Timeline</strong>
                <span class="muted"><small>No audio is needed. The preview advances directly from lyric timing and line jumps.</small></span>
              </div>
              <div class="snapshot-item">
                <strong>Per-Char Timing</strong>
                <span class="muted"><small>Multi-character timing tokens are expanded into single-character intervals with easing-aware distribution.</small></span>
              </div>
              <div class="snapshot-item">
                <strong>Traceable References</strong>
                <span class="muted"><small>Reference lines keep their source tag and only reuse main text, translations, phonetics, and timing.</small></span>
              </div>
            </div>
          </section>
          <section class="sidebar-card">
            <h2 class="sidebar-title">Warnings</h2>
            <div class="diagnostic-list">
              ${previewModel.warnings
                .map(
                  (warning) => `
                    <div class="diagnostic-item">
                      <strong>${warning.Name}</strong>
                      <small>Line ${warning.Line} - ${warning.Desc}</small>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </section>
          <section class="sidebar-card">
            <h2 class="sidebar-title">Legend</h2>
            <div class="legend-list">
              <div class="legend-item">
                <strong>Main lyric</strong>
                <small>The main lyric advances character by character from the resolved timing track.</small>
              </div>
              <div class="legend-item">
                <strong>Gap jump</strong>
                <small>When playback falls between lines, you can jump straight to the next line start.</small>
              </div>
              <div class="legend-item">
                <strong>Reference line</strong>
                <small>Reference lines reuse only safe tracks and never inherit source backing vocals or source marks.</small>
              </div>
            </div>
          </section>
        </aside>
        <main class="lyrics-column" id="lyrics-column"></main>
      </div>
    </div>
  `;

  bindStaticControls();
  renderLyrics();
}

function bindStaticControls() {
  const togglePlayButton = app.querySelector("#toggle-play");
  const restartLineButton = app.querySelector("#restart-line");
  const jumpGapButton = app.querySelector("#jump-gap");
  const timelineRange = app.querySelector("#timeline-range");
  const playbackRateSelect = app.querySelector("#playback-rate-select");
  const lineJumpSelect = app.querySelector("#line-jump-select");

  togglePlayButton?.addEventListener("click", () => {
    setPlaying(!state.playing);
  });

  restartLineButton?.addEventListener("click", () => {
    const currentLine = previewModel.lines[state.activeLineIndex] ?? previewModel.lines[0];
    if (!currentLine) {
      return;
    }
    seek(currentLine.start, true);
  });

  jumpGapButton?.addEventListener("click", () => {
    const activeGap = previewModel.gaps.find((gap) => gap.id === state.activeGapId);
    if (activeGap) {
      seek(previewModel.lines[activeGap.beforeLineIndex].start, true);
      return;
    }

    const nextLine = previewModel.lines[state.activeLineIndex + 1];
    if (nextLine) {
      seek(nextLine.start, true);
    }
  });

  timelineRange?.addEventListener("input", (event) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    seek(Number(target.value), false);
  });

  lineJumpSelect?.addEventListener("change", (event) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const lineIndex = Number(target.value);
    if (Number.isNaN(lineIndex)) {
      return;
    }

    scrollToLine(lineIndex);
    target.blur();
  });

  playbackRateSelect?.addEventListener("change", (event) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const nextRate = Number(target.value);
    if (Number.isNaN(nextRate)) {
      return;
    }

    state.playbackRate = nextRate;
    if (state.playing) {
      state.anchorVirtualTime = state.currentTime;
      state.anchorRealTime = performance.now();
    }
    refresh();
  });
}

function renderLyrics() {
  const lyricsColumn = app.querySelector("#lyrics-column");
  if (!lyricsColumn) {
    return;
  }

  lineRefs.length = 0;
  gapRefs.clear();

  previewModel.lines.forEach((line, index) => {
    const lineCard = createLineCard(line);
    lyricsColumn.append(lineCard.element);
    lineRefs.push(lineCard);

    const gap = previewModel.gaps.find((item) => item.afterLineIndex === index);
    if (gap) {
      const gapCard = createGapCard(gap);
      lyricsColumn.append(gapCard.element);
      gapRefs.set(gap.id, gapCard);
    }
  });
}

function createLineCard(line) {
  const element = document.createElement("article");
  element.className = "line-card";
  element.id = line.id;
  element.style.animationDelay = `${line.index * 55}ms`;

  element.innerHTML = `
    <div class="line-card-header">
      <div class="line-time">
        <strong>${formatTime(line.start)}</strong>
        <div class="line-meta">
          <span class="badge">${formatDuration(line.duration)}</span>
          ${line.voiceMark ? `<span class="badge badge-voice">voice ${line.voiceMark}</span>` : ""}
          ${line.extraMarks.map((mark) => `<span class="badge badge-mark">${mark}</span>`).join("")}
          ${line.attr.ref ? `<span class="badge badge-ref">ref ${line.attr.ref}</span>` : ""}
        </div>
      </div>
      <button class="button button-primary" type="button">Start Here</button>
    </div>
    <div class="line-body">
      <div class="line-progress"><div class="line-progress-bar"></div></div>
    </div>
  `;

  const body = element.querySelector(".line-body");
  const progressBar = element.querySelector(".line-progress-bar");
  const startButton = element.querySelector("button");
  startButton?.addEventListener("click", () => {
    seek(line.start, true);
  });

  const mainRow = createTimedTextRow("main", line.mainTimedText, "lyric-line");
  body?.append(mainRow.label, mainRow.element);

  line.translations.forEach((translation) => {
    const row = document.createElement("div");
    row.className = "translation-row";
    row.innerHTML = `
      <span class="row-label">${translation.label}</span>
      <div class="translation-text">${translation.value}</div>
    `;
    body?.append(row);
  });

  const timedTrackRefs = [mainRow];

  line.phoneticTracks.forEach((track) => {
    if (track.type === "supermark") {
      const row = document.createElement("div");
      row.className = "track-row";
      row.innerHTML = `<span class="row-label">${track.name}</span>`;
      const chipList = document.createElement("div");
      chipList.className = "supermark-list";
      track.annotations.forEach((item) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.innerHTML = `${item.token} <small>${item.target}</small>`;
        chipList.append(chip);
      });
      row.append(chipList);
      body?.append(row);
      return;
    }

    const timedRow = createTimedTextRow(track.name, track.timedText, "lyric-line secondary");
    timedTrackRefs.push(timedRow);
    body?.append(timedRow.label, timedRow.element);
  });

  line.backTracks.forEach((track) => {
    const timedRow = createTimedTextRow(
      `${track.name} ${track.offsetLabel}`,
      track.timedText,
      "lyric-line backing",
    );
    timedTrackRefs.push(timedRow);
    body?.append(timedRow.label, timedRow.element);
  });

  return {
    line,
    element,
    progressBar,
    timedTrackRefs,
  };
}

function createGapCard(gap) {
  const element = document.createElement("article");
  element.className = "gap-card";
  element.id = `gap-${gap.id}`;
  element.innerHTML = `
    <div class="gap-card-header">
      <div class="gap-meta">
        <strong>Gap ${formatDuration(gap.duration)}</strong>
        <span class="badge">${formatTime(gap.start)} to ${formatTime(gap.end)}</span>
      </div>
      <button class="button button-warm" type="button">Jump To Next Line</button>
    </div>
    <div class="muted">This is silent space on the virtual timeline. Jump directly to the next lyric entry.</div>
  `;

  element.querySelector("button")?.addEventListener("click", () => {
    seek(previewModel.lines[gap.beforeLineIndex].start, true);
  });

  return { gap, element };
}

function createTimedTextRow(labelText, timedText, className) {
  const label = document.createElement("span");
  label.className = "row-label";
  label.textContent = labelText;

  const element = document.createElement("div");
  element.className = className;

  const charRefs = timedText.chars.map((charTiming) => {
    const span = document.createElement("span");
    span.className = "timed-char";
    const displayChar = charTiming.char === " " ? "\u00A0" : charTiming.char;
    span.dataset.char = displayChar;
    span.textContent = displayChar;
    span.style.setProperty("--fill", "0");
    element.append(span);
    return {
      span,
      timing: charTiming,
    };
  });

  if (charRefs.length === 0) {
    element.textContent = timedText.plainText;
  }

  return { label, element, charRefs };
}

function setPlaying(playing) {
  state.playing = playing;
  state.anchorVirtualTime = state.currentTime;
  state.anchorRealTime = performance.now();

  if (state.playing) {
    tick();
  } else if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }

  refresh();
}

function tick(now = performance.now()) {
  if (!state.playing) {
    return;
  }

  state.currentTime = clamp(
    state.anchorVirtualTime + (now - state.anchorRealTime) * state.playbackRate,
    0,
    previewModel.totalEnd,
  );

  if (state.currentTime >= previewModel.totalEnd) {
    state.currentTime = previewModel.totalEnd;
    state.playing = false;
  }

  refresh();

  if (state.playing) {
    state.rafId = requestAnimationFrame(tick);
  }
}

function seek(time, keepPlaying) {
  state.currentTime = clamp(time, 0, previewModel.totalEnd);
  state.anchorVirtualTime = state.currentTime;
  state.anchorRealTime = performance.now();

  if (keepPlaying && !state.playing) {
    setPlaying(true);
    return;
  }

  refresh();
}

function refresh() {
  const activeLineIndex = findActiveLineIndex(state.currentTime);
  const activeGap = previewModel.gaps.find(
    (gap) => state.currentTime >= gap.start && state.currentTime < gap.end,
  );

  if (activeLineIndex !== state.activeLineIndex) {
    state.activeLineIndex = activeLineIndex;
    scrollCurrentIntoView(activeGap?.id ?? "");
  }

  state.activeGapId = activeGap?.id ?? "";

  updateTransport(activeGap);
  updateLines(activeLineIndex);
  updateGaps(activeGap?.id ?? "");
}

function updateTransport(activeGap) {
  const currentLine = previewModel.lines[state.activeLineIndex];
  const togglePlayButton = app.querySelector("#toggle-play");
  const jumpGapButton = app.querySelector("#jump-gap");
  const currentTimeNode = app.querySelector("#current-time");
  const currentLineLabelNode = app.querySelector("#current-line-label");
  const transportStateNode = app.querySelector("#transport-state");
  const transportDetailNode = app.querySelector("#transport-detail");
  const timelineCurrentTimeNode = app.querySelector("#timeline-current-time");
  const timelineCurrentLineNode = app.querySelector("#timeline-current-line");
  const timelineRange = app.querySelector("#timeline-range");
  const playbackRateSelect = app.querySelector("#playback-rate-select");
  const lineJumpSelect = app.querySelector("#line-jump-select");

  if (togglePlayButton) {
    togglePlayButton.textContent = state.playing ? "Pause" : "Play";
  }

  if (jumpGapButton) {
    const nextLine = activeGap
      ? previewModel.lines[activeGap.beforeLineIndex]
      : previewModel.lines[state.activeLineIndex + 1];
    jumpGapButton.disabled = !nextLine;
    jumpGapButton.textContent = activeGap ? "Jump To Next Line" : "Next Line";
  }

  if (currentTimeNode) {
    currentTimeNode.textContent = formatTime(state.currentTime);
  }

  if (timelineCurrentTimeNode) {
    timelineCurrentTimeNode.textContent = formatTime(state.currentTime);
  }

  if (currentLineLabelNode) {
    currentLineLabelNode.textContent = currentLine ? `#${currentLine.index + 1}` : "-";
  }

  if (timelineCurrentLineNode) {
    timelineCurrentLineNode.textContent = activeGap
      ? `Gap to line #${activeGap.beforeLineIndex + 1}`
      : currentLine
        ? `Line #${currentLine.index + 1}`
        : "No active line";
  }

  if (playbackRateSelect instanceof HTMLSelectElement) {
    playbackRateSelect.value = String(state.playbackRate);
  }

  if (lineJumpSelect instanceof HTMLSelectElement && currentLine) {
    lineJumpSelect.value = String(currentLine.index);
  }

  if (transportStateNode) {
    transportStateNode.textContent = activeGap
      ? `Gap before line #${activeGap.beforeLineIndex + 1}`
      : currentLine
        ? `${state.playing ? "Playing" : "Paused"} line #${currentLine.index + 1}`
        : "Idle";
  }

  if (transportDetailNode) {
    transportDetailNode.textContent = currentLine
      ? `${formatTime(currentLine.start)} - ${formatDuration(currentLine.duration)} - rate ${state.playbackRate}x`
      : `${previewModel.lines.length} lyric groups`;
  }

  if (timelineRange instanceof HTMLInputElement) {
    timelineRange.value = String(Math.floor(state.currentTime));
    const progress = previewModel.totalEnd > 0 ? (state.currentTime / previewModel.totalEnd) * 100 : 0;
    timelineRange.style.setProperty("--progress", `${progress}%`);
  }
}

function updateLines(activeLineIndex) {
  lineRefs.forEach((lineRef, index) => {
    const { line, element, progressBar, timedTrackRefs } = lineRef;
    const relativeTime = state.currentTime - line.start;
    const lineProgress = line.duration > 0 ? clamp(relativeTime / line.duration, 0, 1) : 0;

    element.classList.toggle("is-current", index === activeLineIndex);
    element.classList.toggle("is-past", state.currentTime >= line.end && index !== activeLineIndex);
    element.classList.toggle("is-upcoming", state.currentTime < line.start);

    if (progressBar) {
      progressBar.style.width = `${lineProgress * 100}%`;
    }

    timedTrackRefs.forEach((trackRef) => {
      trackRef.charRefs.forEach(({ span, timing }) => {
        span.style.setProperty("--fill", progressForChar(timing, relativeTime).toFixed(3));
      });
    });
  });
}

function updateGaps(activeGapId) {
  gapRefs.forEach((gapRef, gapId) => {
    gapRef.element.classList.toggle("is-current-gap", gapId === activeGapId);
  });
}

function scrollCurrentIntoView(activeGapId) {
  if (activeGapId) {
    gapRefs.get(activeGapId)?.element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    return;
  }

  scrollToLine(state.activeLineIndex);
}

function scrollToLine(lineIndex) {
  lineRefs[lineIndex]?.element.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function findActiveLineIndex(time) {
  let index = previewModel.lines.length - 1;

  for (let cursor = 0; cursor < previewModel.lines.length; cursor += 1) {
    if (time < previewModel.lines[cursor].start) {
      index = Math.max(0, cursor - 1);
      break;
    }
  }

  return index;
}

function formatLineJumpLabel(line) {
  const compactText = line.text.replace(/\s+/g, " ").trim();
  const displayText = compactText.length > 18 ? `${compactText.slice(0, 18)}...` : compactText;
  return `#${line.index + 1} / ${formatTime(line.start)} / ${displayText || "Untitled"}`;
}
