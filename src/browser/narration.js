(() => {
  if (window.__xarpNarrationInitialized) return;
  window.__xarpNarrationInitialized = true;

  const metaEl = document.getElementById('xarp-meta');
  const narrationEl = document.getElementById('xarp-narration');
  if (!metaEl || !narrationEl) return;

  let meta = {};
  let timeline = null;
  try {
    meta = JSON.parse(metaEl.textContent || '{}');
    timeline = JSON.parse(narrationEl.textContent || 'null');
  } catch {
    return;
  }
  if (!timeline || !Array.isArray(timeline.slides) || timeline.slides.length === 0) return;

  const pluginOpts = meta.plugins?.narration || {};
  const storagePrefix = `xarp:watch:${JSON.stringify([location.pathname, meta.deckId ?? meta.sourceFile, meta.viewId])}`;

  const readPref = (suffix, fallback) => {
    try {
      const val = localStorage.getItem(`${storagePrefix}:${suffix}`);
      return val === null ? fallback : val;
    } catch {
      return fallback;
    }
  };
  const writePref = (suffix, val) => {
    try { localStorage.setItem(`${storagePrefix}:${suffix}`, String(val)); } catch {}
  };

  let watchActive = false;
  let playing = false;
  let hasStarted = false;
  let scrubbing = false;
  let currentTime = 0;
  let playbackRate = Number(readPref('speed', '1')) || 1;
  if (![0.75, 1, 1.25, 1.5, 1.75, 2].includes(playbackRate)) playbackRate = 1;
  let muted = readPref('muted', 'false') === 'true';
  let captionsOn = readPref('captions', String(pluginOpts.captions !== false)) !== 'false';
  let sidebarOn = readPref('sidebar', String(pluginOpts.sidebar !== false)) !== 'false';
  let cuesOn = readPref('cues', String(pluginOpts.cues === true)) === 'true';
  let activeTab = timeline.spokenBeatCount > 0 ? 'transcript' : 'chapters';

  let rafId = 0;
  let lastRafNow = 0;
  let appliedSlideIdx = -1;
  let appliedFragIdx = -1;
  let lastUiSlideIdx = -1;
  let lastUiBeatGlobal = -1;
  let lastSectionIdx = -1;
  let syncingPopstate = false;

  // Persistent single HTMLAudioElement preserves vocal pitch across 0.75x..2x and avoids iOS per-clip autoplay blocks.
  const voiceAudio = new Audio();
  voiceAudio.preload = 'auto';
  if ('preservesPitch' in voiceAudio) voiceAudio.preservesPitch = true;
  if ('webkitPreservesPitch' in voiceAudio) voiceAudio.webkitPreservesPitch = true;
  voiceAudio.muted = muted;
  voiceAudio.playbackRate = playbackRate;

  let activeAudioBeatGlobal = -1;
  let activeAudioReady = false;
  let audioPlayToken = 0;
  const blobUrlCache = new Map();
  const createdBlobUrls = [];

  function resolveClipSrc(clipUrl) {
    if (!clipUrl) return Promise.resolve('');
    if (blobUrlCache.has(clipUrl)) return blobUrlCache.get(clipUrl);
    if (location.protocol === 'file:') return Promise.resolve(clipUrl);
    const promise = fetch(clipUrl)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        const objUrl = URL.createObjectURL(blob);
        createdBlobUrls.push(objUrl);
        return objUrl;
      })
      .catch(() => clipUrl);
    blobUrlCache.set(clipUrl, promise);
    return promise;
  }

  function allBeatsFlat() {
    const list = [];
    for (const slide of timeline.slides) {
      for (const beat of slide.beats) list.push(beat);
    }
    return list;
  }

  let flatBeats = allBeatsFlat();

  function prefetchAround(globalIdx) {
    for (let i = globalIdx; i < Math.min(flatBeats.length, globalIdx + 5); i++) {
      const b = flatBeats[i];
      if (b?.clipUrl) void resolveClipSrc(b.clipUrl);
    }
  }

  // Optional subtle Web Audio procedural cues
  let audioCtx = null;
  function playCue(kind) {
    if (!cuesOn || muted || !kind || kind === 'none') return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') void audioCtx.resume();
      const now = audioCtx.currentTime;
      const gain = audioCtx.createGain();
      gain.connect(audioCtx.destination);
      if (kind === 'chime') {
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.045, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
        for (const freq of [523.25, 783.99]) {
          const osc = audioCtx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);
          osc.connect(gain);
          osc.start(now);
          osc.stop(now + 0.34);
        }
      } else {
        const startFreq = kind === 'thud' ? 130 : 420;
        const endFreq = kind === 'thud' ? 75 : 560;
        const dur = kind === 'thud' ? 0.14 : 0.075;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.028, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        const osc = audioCtx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + dur);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + dur + 0.01);
      }
    } catch {}
  }

  const fmtTime = sec => {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rem}` : `${m}:${rem}`;
  };

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function presentationVisible() {
    const view = document.body.dataset.bespokeView;
    if (view && view !== '') return false;
    if (document.querySelector('.bespoke-marp-overview[data-open="1"]')) return false;
    return true;
  }

  function currentDeckSlideIndex() {
    const svgs = [...document.querySelectorAll('svg[data-marpit-svg]')];
    const active = svgs.findIndex(s => s.classList.contains('bespoke-marp-active'));
    if (active >= 0) return active;
    const h = parseInt(location.hash.slice(1), 10);
    return Number.isFinite(h) && h >= 1 && h <= svgs.length ? h - 1 : 0;
  }

  function locateTime(t) {
    const clamped = Math.max(0, Math.min(timeline.duration, Number(t) || 0));
    const slides = timeline.slides;
    let sIdx = slides.length - 1;
    for (let i = 0; i < slides.length; i++) {
      if (clamped < slides[i].end || i === slides.length - 1) {
        sIdx = i;
        break;
      }
    }
    const slide = slides[sIdx];
    const beats = slide.beats;
    let bIdx = beats.length - 1;
    for (let j = 0; j < beats.length; j++) {
      if (clamped < beats[j].end || j === beats.length - 1) {
        bIdx = j;
        break;
      }
    }
    return { time: clamped, slide, beat: beats[bIdx], slideIndex: sIdx, beatIndex: bIdx };
  }

  // Launcher button in normal deck mode
  const launcher = el('button', 'xarp-watch-launcher');
  launcher.type = 'button';
  launcher.title = 'Open narrated Watch Mode (shortcut: W)';
  const launcherIcon = el('span', 'xarp-watch-launcher-icon', '▶');
  const launcherLabel = el('span', '', 'Watch');
  const launcherDur = el('span', 'xarp-watch-launcher-dur', fmtTime(timeline.duration));
  launcher.append(launcherIcon, launcherLabel, launcherDur);
  launcher.addEventListener('click', () => openWatch({ fromCurrentSlide: true }));

  // Cinema Shell DOM
  const shell = el('div', 'xarp-watch-shell');
  shell.setAttribute('role', 'region');
  shell.setAttribute('aria-label', 'Narrated presentation player');

  const header = el('header', 'xarp-watch-header');
  const headerLeft = el('div', 'xarp-watch-header-left');
  const badge = el('span', 'xarp-watch-badge', 'Watch');
  const titleEl = el('span', 'xarp-watch-title', timeline.title || document.title || 'Presentation');
  const nowEl = el('span', 'xarp-watch-now', '');
  headerLeft.append(badge, titleEl, nowEl);

  const headerRight = el('div', 'xarp-watch-header-right');
  const synthSlideBtn = el('button', 'xarp-watch-btn', 'Synthesize slide');
  synthSlideBtn.type = 'button';
  synthSlideBtn.hidden = true;
  synthSlideBtn.title = 'Synthesize or refresh audio clips for the current slide';

  const synthAllBtn = el('button', 'xarp-watch-btn is-primary', 'Synthesize deck');
  synthAllBtn.type = 'button';
  synthAllBtn.hidden = true;
  synthAllBtn.title = 'Synthesize all missing per-beat audio clips';

  const sidebarBtn = el('button', 'xarp-watch-btn xarp-watch-sidebar-toggle', 'Sidebar');
  sidebarBtn.type = 'button';
  sidebarBtn.title = 'Toggle Chapters & Transcript sidebar (T)';

  const exitBtn = el('button', 'xarp-watch-btn', 'Slides');
  exitBtn.type = 'button';
  exitBtn.title = 'Return to interactive slide deck (W or Esc)';

  headerRight.append(synthSlideBtn, synthAllBtn, sidebarBtn, exitBtn);
  header.append(headerLeft, headerRight);

  const main = el('div', 'xarp-watch-main');
  const playerCol = el('div', 'xarp-watch-player-col');
  const stageArea = el('div', 'xarp-watch-stage-area');
  const stageSlot = el('div', 'xarp-watch-stage-slot');
  stageArea.append(stageSlot);

  const captionBar = el('div', 'xarp-watch-caption-bar');
  captionBar.setAttribute('aria-live', 'polite');

  const transport = el('div', 'xarp-watch-transport');
  const timelineWrap = el('div', 'xarp-watch-Timeline-wrap');
  const ticksEl = el('div', 'xarp-watch-ticks');
  const scrubber = el('input', 'xarp-watch-scrubber');
  scrubber.type = 'range';
  scrubber.min = '0';
  scrubber.max = String(Math.max(0.1, timeline.duration));
  scrubber.step = '0.01';
  scrubber.value = '0';
  scrubber.setAttribute('aria-label', 'Presentation timeline');
  timelineWrap.append(ticksEl, scrubber);

  const controlsRow = el('div', 'xarp-watch-controls');
  const controlsLeft = el('div', 'xarp-watch-controls-left');
  const playBtn = el('button', 'xarp-watch-btn is-primary', '▶ Play');
  playBtn.type = 'button';
  playBtn.title = 'Play or pause (Space or K)';

  const prevBeatBtn = el('button', 'xarp-watch-btn', '⏮');
  prevBeatBtn.type = 'button';
  prevBeatBtn.title = 'Previous beat (J or [)';
  prevBeatBtn.setAttribute('aria-label', 'Previous beat');

  const nextBeatBtn = el('button', 'xarp-watch-btn', '⏭');
  nextBeatBtn.type = 'button';
  nextBeatBtn.title = 'Next beat (L or ])';
  nextBeatBtn.setAttribute('aria-label', 'Next beat');

  const timeEl = el('span', 'xarp-watch-time', `0:00 / ${fmtTime(timeline.duration)}`);
  const statusEl = el('span', 'xarp-watch-status', '');
  controlsLeft.append(playBtn, prevBeatBtn, nextBeatBtn, timeEl, statusEl);

  const controlsRight = el('div', 'xarp-watch-controls-right');
  const muteBtn = el('button', 'xarp-watch-btn', muted ? 'Muted' : 'Audio');
  muteBtn.type = 'button';
  muteBtn.title = 'Mute or unmute voice (M)';
  muteBtn.setAttribute('aria-pressed', String(!muted));

  const cuesBtn = el('button', 'xarp-watch-btn', 'Cues');
  cuesBtn.type = 'button';
  cuesBtn.title = 'Toggle subtle chapter/slide transition sounds';
  cuesBtn.setAttribute('aria-pressed', String(cuesOn));

  const speedSelect = el('select', 'xarp-watch-select');
  speedSelect.setAttribute('aria-label', 'Playback speed');
  speedSelect.title = 'Playback speed (pitch-preserved)';
  for (const rate of [0.75, 1, 1.25, 1.5, 1.75, 2]) {
    const opt = el('option', '', `${rate}×`);
    opt.value = String(rate);
    if (rate === playbackRate) opt.selected = true;
    speedSelect.append(opt);
  }

  const ccBtn = el('button', 'xarp-watch-btn', 'CC');
  ccBtn.type = 'button';
  ccBtn.title = 'Toggle captions (V)';
  ccBtn.setAttribute('aria-pressed', String(captionsOn));

  const vttLink = el('a', 'xarp-watch-btn', 'VTT');
  vttLink.href = timeline.vttUrl || '_xarp/narration/captions.vtt';
  vttLink.download = `${meta.viewId || 'slides'}.vtt`;
  vttLink.title = 'Download WebVTT subtitles';

  const fullscreenBtn = el('button', 'xarp-watch-btn', 'Fullscreen');
  fullscreenBtn.type = 'button';
  fullscreenBtn.title = 'Toggle fullscreen (F)';

  controlsRight.append(muteBtn, cuesBtn, speedSelect, ccBtn, vttLink, fullscreenBtn);
  controlsRow.append(controlsLeft, controlsRight);
  transport.append(timelineWrap, controlsRow);
  playerCol.append(stageArea, captionBar, transport);

  // Sidebar: Transcript & Chapters tabs
  const sidebar = el('aside', 'xarp-watch-sidebar');
  const tabsBar = el('div', 'xarp-watch-tabs');
  tabsBar.setAttribute('role', 'tablist');
  const tabTranscript = el('button', 'xarp-watch-tab', 'Transcript');
  tabTranscript.type = 'button';
  tabTranscript.setAttribute('role', 'tab');
  const tabChapters = el('button', 'xarp-watch-tab', 'Chapters');
  tabChapters.type = 'button';
  tabChapters.setAttribute('role', 'tab');
  tabsBar.append(tabTranscript, tabChapters);

  const transcriptPane = el('div', 'xarp-watch-pane');
  transcriptPane.setAttribute('role', 'tabpanel');
  const chaptersPane = el('div', 'xarp-watch-pane');
  chaptersPane.setAttribute('role', 'tabpanel');
  sidebar.append(tabsBar, transcriptPane, chaptersPane);

  main.append(playerCol, sidebar);
  shell.append(header, main);

  // Stage overlay (for initial big play button and click-to-pause while playing)
  const stageOverlay = el('div', 'xarp-watch-stage-overlay');
  const bigPlayBtn = el('button', 'xarp-watch-big-play');
  bigPlayBtn.type = 'button';
  const bigPlayLabel = el('span', '', `▶ Play (${fmtTime(timeline.duration)})`);
  bigPlayBtn.append(bigPlayLabel);
  stageOverlay.append(bigPlayBtn);

  document.body.append(launcher, shell, stageOverlay);

  let slideItemButtons = [];
  let transcriptButtons = [];

  function setTab(tab) {
    activeTab = tab;
    const isTr = tab === 'transcript';
    tabTranscript.setAttribute('aria-selected', String(isTr));
    tabChapters.setAttribute('aria-selected', String(!isTr));
    transcriptPane.hidden = !isTr;
    chaptersPane.hidden = isTr;
  }

  tabTranscript.addEventListener('click', () => setTab('transcript'));
  tabChapters.addEventListener('click', () => setTab('chapters'));

  function rebuildTimelineDom() {
    flatBeats = allBeatsFlat();
    launcherDur.textContent = fmtTime(timeline.duration);
    bigPlayLabel.textContent = `▶ Play (${fmtTime(timeline.duration)})`;
    scrubber.max = String(Math.max(0.1, timeline.duration));
    vttLink.href = timeline.vttUrl || '_xarp/narration/captions.vtt';
    vttLink.hidden = timeline.spokenBeatCount === 0;

    if (timeline.spokenBeatCount > 0 && timeline.synthesizedCount < timeline.spokenBeatCount) {
      statusEl.textContent = timeline.synthesizedCount === 0
        ? 'Preview timing (run xarp narrate for voice)'
        : `${timeline.synthesizedCount}/${timeline.spokenBeatCount} clips synthesized`;
    } else {
      statusEl.textContent = '';
    }

    // Scrubber ticks
    ticksEl.replaceChildren();
    if (timeline.duration > 0) {
      const secStarts = new Set((timeline.sections || []).map(s => s.start));
      for (const slide of timeline.slides) {
        if (slide.start <= 0) continue;
        const tick = el('span', 'xarp-watch-tick');
        if (secStarts.has(slide.start)) tick.classList.add('is-section');
        tick.style.left = `${(slide.start / timeline.duration) * 100}%`;
        ticksEl.append(tick);
      }
    }

    // Chapters pane
    chaptersPane.replaceChildren();
    slideItemButtons = [];
    const appendSlideBtn = slide => {
      const btn = el('button', 'xarp-watch-slide-item');
      btn.type = 'button';
      btn.append(
        el('span', 'xarp-watch-num', String(slide.number).padStart(2, '0')),
        el('span', 'xarp-watch-label', slide.title),
        el('span', 'xarp-watch-ts', fmtTime(slide.start)),
      );
      btn.addEventListener('click', () => {
        seek(slide.start);
        void play();
      });
      slideItemButtons.push({ btn, slideIndex: slide.index });
      chaptersPane.append(btn);
    };

    if (Array.isArray(timeline.sections) && timeline.sections.length > 0) {
      for (const sec of timeline.sections) {
        const head = el('button', 'xarp-watch-sec-head');
        head.type = 'button';
        head.append(el('span', '', sec.label), el('span', 'xarp-watch-ts', fmtTime(sec.start)));
        head.addEventListener('click', () => {
          seek(sec.start);
          void play();
        });
        chaptersPane.append(head);
        for (const num of sec.slideNumbers) {
          const slide = timeline.slides[num - 1];
          if (slide) appendSlideBtn(slide);
        }
      }
    } else {
      for (const slide of timeline.slides) appendSlideBtn(slide);
    }

    // Transcript pane
    transcriptPane.replaceChildren();
    transcriptButtons = [];
    let anyCaption = false;
    for (const slide of timeline.slides) {
      const captioned = slide.beats.filter(b => b.caption);
      if (!captioned.length) continue;
      anyCaption = true;
      transcriptPane.append(el('div', 'xarp-watch-tr-slide', `${String(slide.number).padStart(2, '0')} · ${slide.title}`));
      for (const beat of captioned) {
        const btn = el('button', 'xarp-watch-line');
        btn.type = 'button';
        btn.append(el('span', 'xarp-watch-ts', fmtTime(beat.start)), el('span', 'xarp-watch-label', beat.caption));
        btn.addEventListener('click', () => {
          seek(beat.start);
          void play();
        });
        transcriptButtons.push({ btn, globalIndex: beat.globalIndex });
        transcriptPane.append(btn);
      }
    }
    if (!anyCaption) {
      transcriptPane.append(el('div', 'xarp-watch-empty', 'Add <!-- beat: ... --> or <!-- narration: ... --> comments in Markdown to populate the synchronized transcript.'));
      setTab('chapters');
    } else {
      setTab(activeTab);
    }
  }

  rebuildTimelineDom();

  function syncLayoutClasses() {
    document.body.classList.toggle('xarp-watch-active', watchActive);
    document.body.classList.toggle('xarp-watch-controlled', watchActive);
    document.body.classList.toggle('xarp-watch-playing', watchActive && playing);
    document.body.classList.toggle('xarp-watch-theater', !sidebarOn);
    document.body.classList.toggle('xarp-watch-captions-off', !captionsOn);
    sidebarBtn.setAttribute('aria-pressed', String(sidebarOn));
    ccBtn.setAttribute('aria-pressed', String(captionsOn));
    cuesBtn.setAttribute('aria-pressed', String(cuesOn));
    muteBtn.textContent = muted ? 'Muted' : 'Audio';
    muteBtn.setAttribute('aria-pressed', String(!muted));
    playBtn.textContent = playing ? '⏸ Pause' : '▶ Play';
    bigPlayBtn.hidden = playing || hasStarted;
  }

  function syncStageRect() {
    if (!watchActive) return;
    const isNarrow = window.innerWidth <= 1023;
    const colRect = playerCol.getBoundingClientRect();
    const cs = getComputedStyle(playerCol);
    const padX = ( parseFloat(cs.paddingLeft) || 0 ) + ( parseFloat(cs.paddingRight) || 0 );
    const padY = ( parseFloat(cs.paddingTop) || 0 ) + ( parseFloat(cs.paddingBottom) || 0 );
    const gap = parseFloat(cs.rowGap || cs.gap) || 8;
    const capH = captionsOn ? captionBar.offsetHeight + gap : 0;
    const transH = transport.offsetHeight + gap;
    const availW = Math.max(16, (isNarrow ? window.innerWidth - 24 : colRect.width - padX));
    const availH = Math.max(9, isNarrow ? window.innerHeight * 0.36 : colRect.height - padY - capH - transH);
    const fitW = Math.max(16, Math.floor(Math.min(availW, availH * (16 / 9))));
    const fitH = Math.max(9, Math.floor(fitW * (9 / 16)));
    stageSlot.style.width = `${fitW}px`;
    stageSlot.style.height = `${fitH}px`;
    const rect = stageSlot.getBoundingClientRect();
    document.body.style.setProperty('--xarp-watch-left', `${Math.round(rect.left)}px`);
    document.body.style.setProperty('--xarp-watch-top', `${Math.round(rect.top)}px`);
    document.body.style.setProperty('--xarp-watch-w', `${Math.round(rect.width)}px`);
    document.body.style.setProperty('--xarp-watch-h', `${Math.round(rect.height)}px`);
  }

  new ResizeObserver(() => syncStageRect()).observe(playerCol);
  new ResizeObserver(() => syncStageRect()).observe(shell);
  window.addEventListener('resize', syncStageRect);

  function stopVoiceAudio() {
    audioPlayToken++;
    activeAudioBeatGlobal = -1;
    activeAudioReady = false;
    if (!voiceAudio.paused) {
      try { voiceAudio.pause(); } catch {}
    }
  }

  function startBeatAudio(beat, offsetSec) {
    if (!beat.clipUrl) {
      stopVoiceAudio();
      return;
    }
    const token = ++audioPlayToken;
    activeAudioBeatGlobal = beat.globalIndex;
    activeAudioReady = false;
    prefetchAround(beat.globalIndex);

    void resolveClipSrc(beat.clipUrl).then(src => {
      if (token !== audioPlayToken || !watchActive || !playing) return;
      if (voiceAudio.getAttribute('data-clip') !== beat.clipUrl) {
        voiceAudio.src = src;
        voiceAudio.setAttribute('data-clip', beat.clipUrl);
      }
      voiceAudio.muted = muted;
      voiceAudio.playbackRate = playbackRate;
      const clampedOffset = Math.max(0, Math.min(Math.max(0, beat.clipDuration - 0.02), offsetSec));
      const applyPlay = () => {
        if (token !== audioPlayToken || !watchActive || !playing) return;
        try {
          if (Math.abs(voiceAudio.currentTime - clampedOffset) > 0.04) {
            voiceAudio.currentTime = clampedOffset;
          }
        } catch {}
        const p = voiceAudio.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            if (token === audioPlayToken) activeAudioReady = true;
          }).catch(() => {
            // Autoplay blocked before user gesture: pause cleanly and show big Play button.
            if (token === audioPlayToken && !hasStarted) {
              pause();
              bigPlayBtn.hidden = false;
            }
          });
        } else {
          activeAudioReady = true;
        }
      };
      if (voiceAudio.readyState >= 1) applyPlay();
      else voiceAudio.addEventListener('loadedmetadata', applyPlay, { once: true });
    });
  }

  function findStageControllers(slideSvg) {
    if (!slideSvg) return [];
    const controllers = [];
    for (const frame of slideSvg.querySelectorAll('iframe')) {
      try {
        const ctl = frame.contentWindow?.__videoCtl;
        if (ctl && typeof ctl.seek === 'function') controllers.push(ctl);
      } catch {}
    }
    for (const node of slideSvg.querySelectorAll('[data-pf-stage],[data-xarp-stage]')) {
      if (node.__videoCtl && typeof node.__videoCtl.seek === 'function') controllers.push(node.__videoCtl);
    }
    return controllers;
  }

  function navigateDeckTo(slideIndex, fragmentIndex) {
    if (appliedSlideIdx === slideIndex && appliedFragIdx === fragmentIndex) return;
    appliedSlideIdx = slideIndex;
    appliedFragIdx = fragmentIndex;
    const url = new URL(location.href);
    if (fragmentIndex > 0) url.searchParams.set('f', String(fragmentIndex));
    else url.searchParams.delete('f');
    url.hash = `#${slideIndex + 1}`;
    syncingPopstate = true;
    try {
      history.replaceState(null, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } finally {
      syncingPopstate = false;
    }
  }

  function applyVisualState(time, allowCue = false) {
    const loc = locateTime(time);
    const { slide, beat, slideIndex } = loc;
    const targetFrag = Math.max(0, Math.min(slide.fragmentCount, beat.step));
    const prevSlideIdx = appliedSlideIdx;
    const prevBeatGlobal = lastUiBeatGlobal;

    navigateDeckTo(slideIndex, targetFrag);

    if (allowCue && playing) {
      if (beat.cue && beat.globalIndex !== prevBeatGlobal) {
        playCue(beat.cue);
      } else if (prevSlideIdx >= 0 && slideIndex !== prevSlideIdx) {
        const secIdx = slide.sectionIndex ?? -1;
        if (secIdx >= 0 && secIdx !== lastSectionIdx) playCue('chime');
        else playCue('brush');
      }
    }
    lastSectionIdx = slide.sectionIndex ?? -1;

    // Continuous 60 fps stage seeking for any embedded chao-ui / __videoCtl stage
    const svgs = document.querySelectorAll('svg[data-marpit-svg]');
    const activeSvg = svgs[slideIndex];
    for (const ctl of findStageControllers(activeSvg)) {
      const segs = typeof ctl.getSegments === 'function' ? ctl.getSegments() : null;
      if (Array.isArray(segs) && segs.length > 0) {
        const segIdx = Math.max(0, Math.min(segs.length - 1, beat.step));
        const seg = segs[segIdx];
        const elapsed = Math.max(0, loc.time - beat.start);
        const targetT = Math.min(seg.to, seg.from + elapsed * (seg.speed || 1));
        ctl.seek(targetT);
      } else if (typeof ctl.getDuration === 'function') {
        const dur = Number(ctl.getDuration()) || 0;
        ctl.seek(Math.min(dur, Math.max(0, loc.time - slide.start)));
      }
    }

    // Update scrubber & time text
    if (!scrubbing) scrubber.value = loc.time.toFixed(2);
    timeEl.textContent = `${fmtTime(loc.time)} / ${fmtTime(timeline.duration)}`;

    if (slideIndex !== lastUiSlideIdx) {
      lastUiSlideIdx = slideIndex;
      const secPart = slide.section ? ` · ${slide.section}` : '';
      nowEl.textContent = `Slide ${slide.number} / ${timeline.slides.length}${secPart}`;
      for (const item of slideItemButtons) {
        item.btn.classList.toggle('is-active', item.slideIndex === slideIndex);
      }
    }

    if (beat.globalIndex !== lastUiBeatGlobal) {
      lastUiBeatGlobal = beat.globalIndex;
      if (beat.caption) {
        captionBar.textContent = beat.caption;
        captionBar.classList.remove('is-empty');
      } else {
        captionBar.textContent = slide.title;
        captionBar.classList.add('is-empty');
      }
      for (const item of transcriptButtons) {
        const on = item.globalIndex === beat.globalIndex;
        item.btn.classList.toggle('is-active', on);
        if (on && !transcriptPane.hidden) {
          const top = item.btn.offsetTop - transcriptPane.offsetTop - transcriptPane.clientHeight * 0.35;
          transcriptPane.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        }
      }
    }
  }

  function cancelLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    lastRafNow = 0;
  }

  function tick(now) {
    rafId = 0;
    if (!watchActive || !playing || scrubbing) return;
    if (!lastRafNow) lastRafNow = now;
    const dt = Math.min(0.1, Math.max(0, (now - lastRafNow) / 1000)) * playbackRate;
    lastRafNow = now;

    const loc = locateTime(currentTime);
    const { beat } = loc;
    const clipEnd = beat.clipStart + beat.clipDuration;

    if (beat.clipUrl && beat.clipDuration > 0 && currentTime >= beat.clipStart && currentTime < clipEnd) {
      if (activeAudioBeatGlobal !== beat.globalIndex) {
        startBeatAudio(beat, currentTime - beat.clipStart);
      }
      if (activeAudioBeatGlobal === beat.globalIndex && activeAudioReady && !voiceAudio.paused && !voiceAudio.ended) {
        currentTime = Math.min(clipEnd, beat.clipStart + voiceAudio.currentTime);
      } else if (activeAudioBeatGlobal === beat.globalIndex && voiceAudio.ended) {
        currentTime = clipEnd;
        stopVoiceAudio();
      } else {
        currentTime += dt;
      }
    } else {
      if (activeAudioBeatGlobal !== -1) stopVoiceAudio();
      // Pre-warm upcoming clip during lead-in
      if (beat.clipUrl && currentTime < beat.clipStart) prefetchAround(beat.globalIndex);
      currentTime += dt;
    }

    if (currentTime >= timeline.duration) {
      currentTime = timeline.duration;
      applyVisualState(currentTime, false);
      pause();
      return;
    }

    applyVisualState(currentTime, true);
    rafId = requestAnimationFrame(tick);
  }

  function play() {
    if (!watchActive) openWatch({ fromCurrentSlide: false });
    if (document.body.classList.contains('xarp-drawing-active')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }));
    }
    if (currentTime >= timeline.duration - 0.02) currentTime = 0;
    hasStarted = true;
    playing = true;
    syncLayoutClasses();
    syncStageRect();
    const loc = locateTime(currentTime);
    if (loc.beat.clipUrl && loc.beat.clipDuration > 0 && currentTime >= loc.beat.clipStart && currentTime < loc.beat.clipStart + loc.beat.clipDuration) {
      startBeatAudio(loc.beat, currentTime - loc.beat.clipStart);
    } else {
      prefetchAround(loc.beat.globalIndex);
    }
    cancelLoop();
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    cancelLoop();
    stopVoiceAudio();
    syncLayoutClasses();
  }

  function togglePlay() {
    if (playing) pause();
    else play();
  }

  function seek(targetSec) {
    currentTime = Math.max(0, Math.min(timeline.duration, Number(targetSec) || 0));
    stopVoiceAudio();
    lastUiBeatGlobal = -1;
    applyVisualState(currentTime, false);
    if (playing && !scrubbing) {
      const loc = locateTime(currentTime);
      if (loc.beat.clipUrl && loc.beat.clipDuration > 0 && currentTime >= loc.beat.clipStart && currentTime < loc.beat.clipStart + loc.beat.clipDuration) {
        startBeatAudio(loc.beat, currentTime - loc.beat.clipStart);
      }
      cancelLoop();
      rafId = requestAnimationFrame(tick);
    }
  }

  function stepBeat(delta) {
    const loc = locateTime(currentTime);
    const curGlobal = loc.beat.globalIndex;
    if (delta < 0 && currentTime - loc.beat.start > 1.2) {
      seek(loc.beat.start);
      return;
    }
    const nextIdx = Math.max(0, Math.min(flatBeats.length - 1, curGlobal + delta));
    const target = flatBeats[nextIdx];
    if (target) seek(target.start);
  }

  function updateWatchQueryParam(enabled) {
    try {
      const url = new URL(location.href);
      if (enabled) url.searchParams.set('watch', '1');
      else {
        url.searchParams.delete('watch');
        url.searchParams.delete('t');
      }
      history.replaceState(null, '', url);
    } catch {}
  }

  function openWatch(opts = {}) {
    if (!presentationVisible()) return;
    if (document.body.classList.contains('xarp-edit-active')) {
      document.getElementById('te-done')?.click();
    }
    if (document.body.classList.contains('xarp-drawing-active')) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }));
    }
    watchActive = true;
    appliedSlideIdx = -1;
    appliedFragIdx = -1;
    lastUiSlideIdx = -1;
    lastUiBeatGlobal = -1;

    if (typeof opts.time === 'number' && Number.isFinite(opts.time)) {
      currentTime = Math.max(0, Math.min(timeline.duration, opts.time));
    } else if (opts.fromCurrentSlide) {
      const sIdx = currentDeckSlideIndex();
      currentTime = timeline.slides[sIdx]?.start ?? 0;
    }

    updateWatchQueryParam(true);
    syncLayoutClasses();
    requestAnimationFrame(() => {
      syncStageRect();
      applyVisualState(currentTime, false);
      prefetchAround(locateTime(currentTime).beat.globalIndex);
    });
  }

  function closeWatch() {
    if (!watchActive) return;
    pause();
    watchActive = false;
    syncLayoutClasses();
    document.body.style.removeProperty('--xarp-watch-left');
    document.body.style.removeProperty('--xarp-watch-top');
    document.body.style.removeProperty('--xarp-watch-w');
    document.body.style.removeProperty('--xarp-watch-h');
    updateWatchQueryParam(false);
  }

  // UI Event Wiring
  playBtn.addEventListener('click', togglePlay);
  bigPlayBtn.addEventListener('click', e => {
    e.stopPropagation();
    play();
  });
  stageOverlay.addEventListener('click', () => {
    if (playing) pause();
  });
  prevBeatBtn.addEventListener('click', () => stepBeat(-1));
  nextBeatBtn.addEventListener('click', () => stepBeat(1));

  scrubber.addEventListener('pointerdown', () => {
    scrubbing = true;
    stopVoiceAudio();
  });
  scrubber.addEventListener('input', () => {
    scrubbing = true;
    currentTime = Number(scrubber.value) || 0;
    lastUiBeatGlobal = -1;
    applyVisualState(currentTime, false);
  });
  const finishScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    seek(Number(scrubber.value) || 0);
  };
  scrubber.addEventListener('change', finishScrub);
  window.addEventListener('pointerup', finishScrub);

  muteBtn.addEventListener('click', () => {
    muted = !muted;
    voiceAudio.muted = muted;
    writePref('muted', muted);
    syncLayoutClasses();
  });

  cuesBtn.addEventListener('click', () => {
    cuesOn = !cuesOn;
    writePref('cues', cuesOn);
    syncLayoutClasses();
    if (cuesOn) playCue('chime');
  });

  speedSelect.addEventListener('change', () => {
    playbackRate = Number(speedSelect.value) || 1;
    voiceAudio.playbackRate = playbackRate;
    writePref('speed', playbackRate);
  });

  ccBtn.addEventListener('click', () => {
    captionsOn = !captionsOn;
    writePref('captions', captionsOn);
    syncLayoutClasses();
    requestAnimationFrame(syncStageRect);
  });

  sidebarBtn.addEventListener('click', () => {
    sidebarOn = !sidebarOn;
    writePref('sidebar', sidebarOn);
    syncLayoutClasses();
    requestAnimationFrame(syncStageRect);
  });

  exitBtn.addEventListener('click', closeWatch);

  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void document.documentElement.requestFullscreen?.();
    }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
    requestAnimationFrame(syncStageRect);
  });

  // Pause narration cleanly if user enters Edit Mode or Drawing Mode
  new MutationObserver(() => {
    if (!watchActive) return;
    if (document.body.classList.contains('xarp-edit-active')) {
      closeWatch();
      return;
    }
    if (playing && document.body.classList.contains('xarp-drawing-active')) {
      pause();
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // Keyboard shortcuts
  window.addEventListener('keydown', event => {
    const target = event.target;
    if (target instanceof Element && (target.closest('input,textarea,select,[contenteditable=true],[contenteditable=plaintext-only]') || target.isContentEditable)) {
      return;
    }
    if (!presentationVisible() || event.metaKey || event.ctrlKey || event.altKey) return;

    const key = event.key;
    const lower = key.toLowerCase();

    if (lower === 'w' && !document.body.classList.contains('xarp-edit-active')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (watchActive) closeWatch();
      else openWatch({ fromCurrentSlide: true });
      return;
    }

    if (!watchActive) return;

    if (key === ' ' || lower === 'k') {
      event.preventDefault();
      event.stopImmediatePropagation();
      togglePlay();
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.shiftKey) stepBeat(-1);
      else seek(currentTime - 5);
    } else if (key === 'ArrowRight') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.shiftKey) stepBeat(1);
      else seek(currentTime + 5);
    } else if (lower === 'j' || key === '[') {
      event.preventDefault();
      event.stopImmediatePropagation();
      stepBeat(-1);
    } else if (lower === 'l' || key === ']') {
      event.preventDefault();
      event.stopImmediatePropagation();
      stepBeat(1);
    } else if (lower === 'm') {
      event.preventDefault();
      event.stopImmediatePropagation();
      muteBtn.click();
    } else if (lower === 't') {
      event.preventDefault();
      event.stopImmediatePropagation();
      sidebarBtn.click();
    } else if (lower === 'v') {
      event.preventDefault();
      event.stopImmediatePropagation();
      ccBtn.click();
    } else if (lower === 'f') {
      event.preventDefault();
      event.stopImmediatePropagation();
      fullscreenBtn.click();
    } else if (key === 'Escape' && !document.fullscreenElement && !document.body.classList.contains('xarp-drawing-active')) {
      const pickerOpen = document.querySelector('.xarp-color-scheme-picker.is-open');
      if (pickerOpen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeWatch();
    }
  }, true);

  // Optional local `xarp dev` live synthesis integration
  if (['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    let synthesizing = false;
    const refreshDevStatus = () => {
      fetch(`/__xarp/narrate?view=${encodeURIComponent(meta.viewId || '')}`)
        .then(res => (res.ok ? res.json() : null))
        .then(info => {
          if (!info?.ok) return;
          synthSlideBtn.hidden = timeline.spokenBeatCount === 0;
          const missing = Math.max(0, timeline.spokenBeatCount - timeline.synthesizedCount);
          synthAllBtn.hidden = missing === 0;
          if (missing > 0) synthAllBtn.textContent = `Synthesize (${missing})`;
        })
        .catch(() => {});
    };

    const triggerSynthesize = async onlyCurrent => {
      if (synthesizing) return;
      synthesizing = true;
      const wasPlaying = playing;
      if (wasPlaying) pause();
      const loc = locateTime(currentTime);
      const slideId = loc.slide.id;
      synthSlideBtn.disabled = true;
      synthAllBtn.disabled = true;
      statusEl.textContent = onlyCurrent ? `Synthesizing ${slideId}...` : 'Synthesizing deck...';
      try {
        const res = await fetch('/__xarp/narrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            viewId: meta.viewId,
            ...(onlyCurrent ? { only: [slideId] } : {}),
          }),
        });
        const payload = await res.json();
        if (!res.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
        if (payload.timeline) {
          timeline = payload.timeline;
          blobUrlCache.clear();
          rebuildTimelineDom();
          const newSlide = timeline.slides.find(s => s.id === slideId) ?? timeline.slides[loc.slideIndex] ?? timeline.slides[0];
          currentTime = newSlide ? newSlide.start : 0;
          lastUiSlideIdx = -1;
          lastUiBeatGlobal = -1;
          applyVisualState(currentTime, false);
          statusEl.textContent = `Synthesized ${payload.synthesized} clip(s) (${payload.cached} cached)`;
          refreshDevStatus();
        }
      } catch (err) {
        statusEl.textContent = `Synthesis error: ${err.message || err}`;
      } finally {
        synthesizing = false;
        synthSlideBtn.disabled = false;
        synthAllBtn.disabled = false;
      }
    };

    synthSlideBtn.addEventListener('click', () => void triggerSynthesize(true));
    synthAllBtn.addEventListener('click', () => void triggerSynthesize(false));
    refreshDevStatus();
  }

  window.addEventListener('pagehide', () => {
    for (const u of createdBlobUrls) URL.revokeObjectURL(u);
  });

  // Boot into Watch Mode automatically when ?watch=1 or ?mode=watch is present
  try {
    const params = new URLSearchParams(location.search);
    const watchParam = params.get('watch') ?? params.get('mode');
    if (watchParam === '1' || watchParam === 'true' || watchParam === 'watch') {
      const tParam = params.get('t');
      const initialT = tParam !== null && Number.isFinite(Number(tParam)) ? Number(tParam) : undefined;
      openWatch({ time: initialT, fromCurrentSlide: initialT === undefined });
      if (params.get('autoplay') === '1') play();
    }
  } catch {}

  window.__xarpNarration = {
    open: opts => openWatch(opts || {}),
    close: closeWatch,
    play,
    pause,
    togglePlay,
    seek,
    stepBeat,
    getTimeline: () => timeline,
    getState: () => {
      const loc = locateTime(currentTime);
      return {
        watchActive,
        playing,
        currentTime,
        duration: timeline.duration,
        playbackRate,
        muted,
        captionsOn,
        sidebarOn,
        cuesOn,
        slideIndex: loc.slideIndex,
        slideNumber: loc.slide.number,
        slideId: loc.slide.id,
        beatIndex: loc.beatIndex,
        globalBeatIndex: loc.beat.globalIndex,
        caption: loc.beat.caption,
      };
    },
  };
})();
