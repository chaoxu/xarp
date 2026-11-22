import { contentSections } from '../slide-dom.js';

(() => {
  if (window.__xarpEditorInitialized) return;
  window.__xarpEditorInitialized = true;

  const meta = JSON.parse(document.getElementById("xarp-meta")?.textContent || "{}");
  const options = meta.plugins?.editing || {};
  const TEXT_SEL = ["h1,h2,h3,h4,p,li,th,td,blockquote,[data-xarp-edit=text],.pf-slide-kicker,.pf-slide-source,.pf-slide-claim,.pf-slide-meta", ...(options.textSelectors || [])].join(",");
  const BOX_SEL = ["[data-xarp-edit=box],.pf-slide-grid,.pf-slide-grid > div,.pf-slide-panel,.pf-slide-theorem,table,ul,ol,img,svg,svg text,svg rect,svg circle,svg g", ...(options.boxSelectors || [])].join(",");
  const ALL_SEL = `${TEXT_SEL},${BOX_SEL}`;
  const NAV_SEL = "[data-xarp-navigation]";

  let editActive = false, showAllBoxes = false, drawerOpen = false, editingText = false;
  let hoveredEl = null, selectedEl = null, svgInput = null, moveable = null, apiBase = null;
  let apiKnown = false, hostedApi = false, apiError = "";
  let capabilities = {}, snapEnabled = true, deckRecoveryRevision = null;
  let publicationRetry = null;
  let savingSlide = null, drawerSlide = null, sourceRequest = 0;
  let sourceRevision = meta.sourceRevision;
  let buildRevision = meta.buildRevision;
  const editsBySlide = new Map();
  const visualMarkdownCache = new Map();
  const sourceDrafts = new Map();
  const histories = new Map();
  const baselines = new Map();
  const activeBaselines = new Map();
  const savedBaselines = new Map();
  const baselineLoads = new Map();
  let baselineSerial = 0, pendingGroup = null, restoringHistory = false, composing = false;
  let textSession = null;
  let overlayFrame = null;
  let latestRendering = null, reloadRequired = false;
  const staleSlides = new Set(), unrenderedSlides = new Set();

  const toolbar = document.createElement("div");
  toolbar.className = "xarp-editor-toolbar";
  toolbar.innerHTML = `
    <div>
      <span class="xarp-editor-badge">Edit Mode</span>
      <span id="te-slide">#1</span>
      <button type="button" class="xarp-editor-btn" id="te-undo" disabled title="Undo (Cmd/Ctrl+Z)">Undo</button>
      <button type="button" class="xarp-editor-btn" id="te-redo" disabled title="Redo (Cmd/Ctrl+Shift+Z or Ctrl+Y)">Redo</button>
      <button type="button" class="xarp-editor-btn" id="te-boxes" aria-pressed="false">Boxes: Hover</button>
      <button type="button" class="xarp-editor-btn" id="te-reset" disabled title="Reset selected box position/size">Reset Box</button>
      <button type="button" class="xarp-editor-btn" id="te-source" aria-pressed="false">Slide Markdown</button>
      <button type="button" class="xarp-editor-btn" id="te-snap" aria-pressed="true" title="Hold Alt to bypass snapping">Snap: On</button>
      <button type="button" class="xarp-editor-btn" id="te-image" hidden>Insert Image</button>
      <button type="button" class="xarp-editor-btn" id="te-slides" hidden>Slides</button>
      <span class="xarp-editor-coords-readout" id="te-coords">Drag boxes to move or resize. Double-click text to edit.</span>
    </div>
    <div>
      <span class="xarp-editor-status" id="te-status"></span>
      <button type="button" class="xarp-editor-btn" id="te-copy-edits" hidden title="Copy every pending slide edit before reloading">Copy Edits</button>
      <button type="button" class="xarp-editor-btn xarp-editor-btn-primary" id="te-save" disabled>Save</button>
      <button type="button" class="xarp-editor-btn" id="te-done">Done</button>
    </div>
    <span id="te-notice" class="xarp-editor-notice" role="status" hidden></span>`;

  const overlay = document.createElement("div");
  overlay.className = "xarp-editor-overlay";

  const drawer = document.createElement("aside");
  drawer.className = "xarp-editor-drawer";
  drawer.innerHTML = `
    <div class="xarp-editor-drawer-header">
      <strong id="te-drawer-title">Slide Source</strong>
      <div style="display:flex;gap:6px">
        <button type="button" class="xarp-editor-btn" id="te-copy">Copy</button>
        <button type="button" class="xarp-editor-btn xarp-editor-btn-primary" id="te-save-src">Save Source</button>
      </div>
    </div>
    <textarea class="xarp-editor-drawer-textarea" id="te-textarea" spellcheck="false"></textarea>
    <div class="xarp-editor-drawer-footer"><span id="te-source-file"></span><span>Cmd/Ctrl+S to save</span></div>`;

  document.body.append(toolbar, overlay, drawer);
  new ResizeObserver(() => document.body.style.setProperty("--xarp-editor-toolbar-height", `${Math.ceil(toolbar.getBoundingClientRect().height)}px`)).observe(toolbar);
  const $ = id => document.getElementById(id);
  $("te-source-file").textContent = meta.sourceFile || "slides.md";
  // Saving replaces section contents, so these slide nodes remain stable.
  const slideSvgs = [...document.querySelectorAll("svg[data-marpit-svg]")];
  const sections = contentSections(document);
  const sectionFor = element => sections.find(section => section?.contains(element));

  const slideIndex = () => {
    const idx = slideSvgs.findIndex(s => s.classList.contains("bespoke-marp-active"));
    if (idx >= 0) return idx;
    const h = parseInt(location.hash.slice(1), 10);
    return Number.isFinite(h) && h >= 1 && h <= slideSvgs.length ? h - 1 : 0;
  };
  const activeSection = () => sections[slideIndex()];
  const slideId = (i = slideIndex()) => meta.slides?.[i] || `slide-${i + 1}`;
  const setStatus = (msg, kind = "") => {
    const notice = reloadRequired || unrenderedSlides.size ? "Reload to see the latest rendering. Save or copy pending edits first."
      : staleSlides.size ? "Slides with unsaved edits will update after you save or undo them." : "";
    $("te-status").textContent = msg; $("te-status").title = msg;
    $("te-notice").textContent = notice; $("te-notice").hidden = !notice;
    $("te-status").className = `xarp-editor-status${kind ? ` is-${kind}` : ""}`;
  };
  const isSvgChild = el => el instanceof SVGElement && el.tagName.toLowerCase() !== "svg";
  const sourceDirty = index => { const draft = sourceDrafts.get(index); return !!draft && draft.markdown !== savedMarkdown(index, draft.original); };
  const visualDirty = index => {
    if (sourceDrafts.has(index) && sourceDirty(index)) return false;
    const changed = (editsBySlide.get(index)?.size || 0) > 0 || activeBaselines.get(index) !== savedBaselines.get(index);
    if (!changed) return false;
    try { const original = savedMarkdown(index); return original === undefined || visualMarkdown(index) !== original; }
    catch (_) { return true; }
  };
  const pendingSlides = () => [...new Set([...editsBySlide.keys(), ...sourceDrafts.keys(), ...activeBaselines.keys()])].filter(index => visualDirty(index) || sourceDirty(index));

  function copyAttributes(target, source) {
    for (const attribute of [...target.attributes]) target.removeAttribute(attribute.name);
    for (const attribute of source.attributes) target.setAttribute(attribute.name, attribute.value);
  }

  function patchRendering(index, doc) {
    const slide = slideSvgs[index], nextSlide = doc.querySelectorAll("svg[data-marpit-svg]")[index];
    const section = sections[index], nextSection = contentSections(doc)[index];
    const layers = [...slide.children], nextLayers = nextSlide ? [...nextSlide.children] : [];
    if (!nextSection || slide.getAttribute("viewBox") !== nextSlide.getAttribute("viewBox")
      || layers.length !== nextLayers.length || layers.some((layer, i) => layer.tagName !== nextLayers[i].tagName
        || layer.contains(section) !== nextLayers[i].contains(nextSection))) {
      unrenderedSlides.add(index);
      return false;
    }
    if (selectedEl && section.contains(selectedEl)) selectBox(null, section);
    for (const [i, layer] of layers.entries()) {
      copyAttributes(layer, nextLayers[i]);
      if (layer.contains(section)) {
        copyAttributes(section, nextSection);
        section.innerHTML = nextSection.innerHTML;
      } else layer.innerHTML = nextLayers[i].innerHTML;
    }
    window.dispatchEvent(new CustomEvent("xarp-slide-patched", { detail: { section } }));
    unrenderedSlides.delete(index);
    const saved = baselines.get(savedBaselines.get(index));
    if (saved) {
      saved.html = section.innerHTML;
      saved.attributes = [...section.attributes].map(attribute => [attribute.name, attribute.value]);
    }
    return true;
  }

  function reconcileStaleSlides() {
    if (!latestRendering) return;
    for (const index of staleSlides) {
      if (visualDirty(index) || sourceDirty(index) || textSession?.index === index
        || svgInput && sections[index].contains(svgInput.target)) continue;
      staleSlides.delete(index);
      patchRendering(index, latestRendering);
    }
  }

  function applyRenderingReceipt(data, savedIndex) {
    if (typeof data.html !== "string" || !data.rebuilt) {
      unrenderedSlides.add(savedIndex);
      return;
    }
    latestRendering = new DOMParser().parseFromString(data.html, "text/html");
    window.dispatchEvent(new CustomEvent("xarp-color-scheme-default", {
      detail: latestRendering.documentElement.dataset.xarpColorScheme ?? "default",
    }));
    const nextMetaEl = latestRendering.getElementById("xarp-meta");
    const curMetaEl = document.getElementById("xarp-meta");
    if (nextMetaEl && curMetaEl) {
      try {
        const nextMeta = JSON.parse(nextMetaEl.textContent || "{}");
        const curMeta = JSON.parse(curMetaEl.textContent || "{}");
        const nextTimelineUrl = nextMeta?.plugins?.narration?.timelineUrl;
        const curTimelineUrl = curMeta?.plugins?.narration?.timelineUrl;
        curMetaEl.textContent = nextMetaEl.textContent;
        if (nextTimelineUrl && nextTimelineUrl !== curTimelineUrl && window.__xarpNarration) {
          const s = document.createElement("script");
          s.src = nextTimelineUrl;
          s.onload = () => {
            s.remove();
            if (window.__xarpNarrationTimeline) {
              window.dispatchEvent(new CustomEvent("xarp-narration-update", {
                detail: { timeline: window.__xarpNarrationTimeline, sourceRevision },
              }));
            }
          };
          document.body.append(s);
        }
      } catch (_) {}
    }
    staleSlides.delete(savedIndex);
    patchRendering(savedIndex, latestRendering);
    if (!Array.isArray(data.changedSlides) || typeof data.deckStyleChanged !== "boolean") reloadRequired = true;
    else {
      reloadRequired ||= data.deckStyleChanged;
      for (const id of data.changedSlides) {
        const index = meta.slides.indexOf(id);
        if (index >= 0 && index !== savedIndex) staleSlides.add(index);
      }
    }
    reconcileStaleSlides();
  }

  function baselineId(index) {
    if (!activeBaselines.has(index)) {
      const id = `slide-${index}-baseline-${++baselineSerial}`;
      activeBaselines.set(index, id);
      savedBaselines.set(index, id);
      const section = sections[index];
      baselines.set(id, { markdown: undefined, revision: sourceRevision, html: section.innerHTML, attributes: [...section.attributes].map(attribute => [attribute.name, attribute.value]) });
    }
    return activeBaselines.get(index);
  }

  function savedMarkdown(index, fallback) {
    return baselines.get(savedBaselines.get(index))?.markdown ?? fallback;
  }

  function pruneBaselines() {
    const savedIds = new Set(savedBaselines.values());
    const retained = new Set([...activeBaselines.values(), ...savedIds, ...baselineLoads.keys()]);
    if (pendingGroup) retained.add(pendingGroup.before.baselineId);
    for (const history of histories.values()) {
      // An older cached helper cannot report its retained references safely.
      if (!history.getRetainedReferences) return;
      retained.add(history.getState().baselineId);
      for (const id of history.getRetainedReferences()) retained.add(id);
    }
    for (const [id, baseline] of baselines) {
      if (!retained.has(id)) baselines.delete(id);
      else if (!savedIds.has(id)) {
        // History snapshots own older renderings. Only saved baselines render directly.
        delete baseline.html;
        delete baseline.attributes;
      }
    }
    for (const [index, cached] of visualMarkdownCache) {
      if (!baselines.has(cached.baselineId)) visualMarkdownCache.delete(index);
    }
  }

  function visualMarkdown(index) {
    const id = baselineId(index), baseline = baselines.get(id), edits = editsBySlide.get(index);
    let cached = visualMarkdownCache.get(index);
    if (!cached || cached.baselineId !== id || cached.markdown !== baseline.markdown || cached.edits !== edits) {
      cached = { baselineId: id, markdown: baseline.markdown, edits };
      try {
        if (baseline.markdown === undefined) throw new Error("The original slide source is unavailable. Copy your edits before reloading.");
        cached.value = edits?.size ? window.XarpEdits.applyVisualEdits(baseline.markdown, [...edits.values()], slideId(index)) : baseline.markdown;
      } catch (error) { cached.error = error; }
      visualMarkdownCache.set(index, cached);
    }
    if (cached.error) throw cached.error;
    return cached.value;
  }

  async function ensureBaseline(index) {
    const id = baselineId(index), baseline = baselines.get(id);
    if (baseline.markdown !== undefined || !apiBase) return baseline;
    if (baselineLoads.has(id)) return baselineLoads.get(id);
    const expectedRevision = sourceRevision;
    const loading = (async () => {
      const response = await fetch(`${apiBase}/__xarp/slide?view=${encodeURIComponent(meta.viewId)}&slide=${encodeURIComponent(slideId(index))}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(serviceError(response, data, "Could not load the original slide source"));
      if (data.viewId !== meta.viewId || data.sourceFile !== meta.sourceFile || data.slideId !== slideId(index) || data.sourceRevision !== expectedRevision || sourceRevision !== expectedRevision || (hostedApi && data.buildRevision !== buildRevision) || typeof data.markdown !== "string") {
        throw new Error("Slide source changed while loading. Copy your edits before reloading.");
      }
      if (id !== savedBaselines.get(index) && baseline.revision !== data.sourceRevision) throw new Error("The original slide source is unavailable. Copy your edits before reloading.");
      baseline.markdown = data.markdown;
      baseline.revision = data.sourceRevision;
      return baseline;
    })();
    baselineLoads.set(id, loading);
    try { return await loading; }
    finally { baselineLoads.delete(id); pruneBaselines(); updateButtons(); }
  }

  function elementPath(element, section) {
    const path = [];
    for (let node = element; node && node !== section; node = node.parentElement) {
      if (!node.parentElement) return null;
      path.unshift([...node.parentElement.children].indexOf(node));
    }
    return element && section?.contains(element) ? path : null;
  }

  function elementAt(section, path) {
    return path?.reduce((node, index) => node?.children[index], section) || null;
  }

  function focusState(index) {
    const section = sections[index], active = document.activeElement;
    if (active === $("te-textarea") && drawerSlide === index) return { kind: "source", start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection };
    if (svgInput && active === svgInput.input) return { kind: "svg", path: elementPath(svgInput.target, section), start: active.selectionStart, end: active.selectionEnd };
    if (selectedEl && section?.contains(selectedEl)) {
      const focus = { kind: selectedEl.isContentEditable ? "text" : "box", path: elementPath(selectedEl, section) };
      const selection = window.getSelection();
      if (selection?.rangeCount && selectedEl.contains(selection.anchorNode) && selectedEl.contains(selection.focusNode)) {
        const offset = (node, at) => { const range = document.createRange(); range.selectNodeContents(selectedEl); range.setEnd(node, at); return range.toString().length; };
        focus.anchor = offset(selection.anchorNode, selection.anchorOffset);
        focus.focus = offset(selection.focusNode, selection.focusOffset);
      }
      return focus;
    }
    return null;
  }

  function snapshot(index) {
    const section = sections[index], clone = section.cloneNode(true);
    if (textSession?.index === index) {
      const copy = elementAt(clone, elementPath(textSession.element, section));
      if (copy) finishMathEditing(copy);
    }
    for (const element of clone.querySelectorAll("[contenteditable]")) element.removeAttribute("contenteditable");
    const html = clone.innerHTML;
    for (const element of clone.querySelectorAll("*")) for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-te-")) element.removeAttribute(attribute.name);
    }
    return { baselineId: baselineId(index), html, attributes: [...section.attributes].map(attribute => [attribute.name, attribute.value]), content: clone.innerHTML, edits: [...(editsBySlide.get(index)?.entries() || [])], draft: sourceDirty(index) ? sourceDrafts.get(index).markdown : null, focus: focusState(index) };
  }

  const snapshotKey = state => {
    const original = baselines.get(state.baselineId)?.markdown;
    if (original !== undefined) {
      try { return JSON.stringify(state.draft ?? (state.edits.length ? window.XarpEdits.applyVisualEdits(original, state.edits.map(([, edit]) => edit), "history") : original)); }
      catch (_) {}
    }
    return JSON.stringify([state.baselineId, state.attributes, state.content, state.edits, state.draft]);
  };

  function ensureHistory(index) {
    if (!histories.has(index) && window.XarpHistory) histories.set(index, window.XarpHistory.create(snapshot(index), 100));
    return histories.get(index);
  }

  function flushHistory(focus) {
    if (!pendingGroup) return;
    const group = pendingGroup;
    pendingGroup = null;
    clearTimeout(group.timer);
    const history = ensureHistory(group.index), next = snapshot(group.index);
    if (focus) next.focus = focus;
    if (history && snapshotKey(group.before) !== snapshotKey(next)) {
      history.setState(next, [history.getState().baselineId, next.baselineId]);
    }
    pruneBaselines();
    updateButtons();
  }

  function beginChange(index, kind, key = "") {
    if (restoringHistory || deckRecoveryRevision) return;
    if (pendingGroup && (pendingGroup.index !== index || pendingGroup.kind !== kind || pendingGroup.key !== key)) flushHistory();
    ensureHistory(index);
    if (!pendingGroup) pendingGroup = { index, kind, key, before: snapshot(index), timer: null };
  }

  function groupTyping(index, kind, key = "") {
    beginChange(index, kind, key);
    clearTimeout(pendingGroup.timer);
    if (!composing) pendingGroup.timer = setTimeout(flushHistory, kind === "nudge" ? 300 : 600);
    updateButtons();
  }

  function restoreFocus(focus, index) {
    if (!focus || index !== slideIndex()) return;
    if (focus.kind === "source" && drawerOpen && drawerSlide === index) {
      $("te-textarea").focus();
      $("te-textarea").setSelectionRange(focus.start, focus.end, focus.direction);
      return;
    }
    const section = sections[index], element = elementAt(section, focus.path);
    if (!element) return;
    selectBox(element, section);
    if (focus.kind === "text" || focus.kind === "svg") {
      startTextEditing(element, section);
      if (focus.kind === "svg" && svgInput) { svgInput.input.setSelectionRange(focus.start, focus.end); return; }
      const locate = offset => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node, last = null;
        while ((node = walker.nextNode())) { last = node; if (offset <= node.textContent.length) return [node, offset]; offset -= node.textContent.length; }
        return last ? [last, last.textContent.length] : [element, 0];
      };
      if (focus.anchor !== undefined) window.getSelection()?.setBaseAndExtent(...locate(focus.anchor), ...locate(focus.focus));
    }
  }

  function changeHistory(direction) {
    if (deckRecoveryRevision) return;
    if (!editActive || savingSlide !== null || composing) return;
    const index = slideIndex();
    const sourceContext = drawerOpen && drawerSlide === index && sourceDrafts.has(index)
      && (document.activeElement === $("te-textarea") || toolbar.contains(document.activeElement));
    const previousFocus = sourceContext
      ? { kind: "source", start: $("te-textarea").selectionStart, end: $("te-textarea").selectionEnd, direction: $("te-textarea").selectionDirection }
      : focusState(index);
    stopTextEditing(previousFocus);
    flushHistory();
    const history = histories.get(index);
    if (!history || !(direction === "undo" ? history.canUndo() : history.canRedo())) return;
    restoringHistory = true;
    try {
      selectBox(null, null);
      hoveredEl = null;
      const state = direction === "undo" ? history.undo() : history.redo();
      const original = baselines.get(state.baselineId), saved = baselines.get(savedBaselines.get(index));
      let matchesSaved = false, desired;
      try {
        desired = state.draft !== null ? state.draft : original?.markdown === undefined ? undefined : state.edits.length ? window.XarpEdits.applyVisualEdits(original.markdown, state.edits.map(([, edit]) => edit), slideId(index)) : original.markdown;
        matchesSaved = desired !== undefined && desired === saved?.markdown;
      } catch (_) {}
      const rendering = matchesSaved ? saved : state, section = sections[index];
      for (const attribute of [...section.attributes]) section.removeAttribute(attribute.name);
      for (const [name, value] of rendering.attributes) section.setAttribute(name, value);
      section.innerHTML = rendering.html;
      activeBaselines.set(index, matchesSaved ? savedBaselines.get(index) : state.baselineId);
      editsBySlide.set(index, new Map(matchesSaved ? [] : state.edits));
      if (state.draft !== null) sourceDrafts.set(index, { markdown: state.draft, original: savedMarkdown(index, state.draft), sourceRevision });
      else if (drawerOpen && drawerSlide === index && previousFocus?.kind === "source" && desired !== undefined && (matchesSaved || state.edits.length === 0)) sourceDrafts.set(index, { markdown: desired, original: savedMarkdown(index, desired), sourceRevision });
      else sourceDrafts.delete(index);
      if (drawerSlide === index) $("te-textarea").value = sourceDrafts.get(index)?.markdown ?? desired ?? "";
      reconcileStaleSlides();
      updateButtons();
      const focus = previousFocus?.kind === "source" && drawerOpen ? state.focus?.kind === "source" ? state.focus : { kind: "source", start: (desired ?? "").length, end: (desired ?? "").length, direction: "none" }
        : state.focus?.kind === "box" && previousFocus?.kind === "text" && JSON.stringify(state.focus.path) === JSON.stringify(previousFocus.path)
          ? { ...state.focus, kind: "text", anchor: 0, focus: 0 } : state.focus;
      restoreFocus(focus, index);
      showPendingStatus();
      renderOverlay();
    } finally { restoringHistory = false; pruneBaselines(); updateButtons(); }
  }

  function showPendingStatus() {
    const pending = pendingSlides();
    const pendingText = pending.length ? `Unsaved slides: ${pending.map(index => index + 1).join(", ")}` : "";
    const invalid = visualEditError(slideIndex());
    setStatus([apiError, invalid, pendingText].filter(Boolean).join(". "), apiError || invalid ? "error" : "");
  }

  function visualEditError(index) {
    if (!editsBySlide.get(index)?.size || baselines.get(activeBaselines.get(index))?.markdown === undefined) return "";
    try { visualMarkdown(index); return ""; }
    catch (error) { return `${error.message || error}. Undo this change first.`; }
  }

  function serviceError(response, data, fallback) {
    if (response.status === 401) return "Sign in to this site, then retry saving. Your edits are still in this tab.";
    return data?.error || `${fallback} (HTTP ${response.status}). Your edits are still in this tab.`;
  }

  function recognizeApi(data) {
    if (data?.editorApi === true) apiKnown = true;
    if (data?.capabilities) capabilities = data.capabilities;
    if (data?.mode === "hosted" || data?.hosted === true) hostedApi = true;
  }

  function sourceHelp() {
    return apiError || (location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? `Run xarp dev ${meta.sourceFile || "slides.md"} with editing enabled and open the printed URL.`
      : "Markdown is unavailable here. Open the source-backed editor for this deck.");
  }

  async function probeServer() {
    apiBase = null;
    apiError = "";
    if (/^https?:$/.test(location.protocol)) {
      try {
        const r = await fetch(`${location.origin}/__xarp/status?view=${encodeURIComponent(meta.viewId || "")}`, { cache: "no-store" });
        const data = await r.json().catch(() => null);
        recognizeApi(data);
        const noApi = !apiKnown && data === null && (r.ok || r.status === 404 || r.status === 405);
        if (!noApi) {
          if (data?.publicationPending === true && data.viewId === meta.viewId && data.sourceFile === meta.sourceFile && typeof data.sourceRevision === "string" && typeof data.buildRevision === "string") {
            publicationRetry = { viewId: data.viewId, sourceRevision: data.sourceRevision, buildRevision: data.buildRevision };
            apiError = "A source save is waiting for publication. Use Retry Publish to update this deck.";
            setStatus(apiError, "error");
            updateButtons();
            return false;
          }
          if (!r.ok || !data?.ok || data.canSave === false || data.editable === false) {
            if (data?.editorApi === true && r.status === 409) publicationRetry = null;
            throw new Error(serviceError(r, data, "The editor service is unavailable"));
          }
          apiKnown = true;
          if (data.viewId !== meta.viewId || data.sourceFile !== meta.sourceFile || typeof data.sourceRevision !== "string") {
            throw new Error("The editor service is serving a different deck or source. Open the editor for this deck.");
          }
          if (data.deckRecovery && !hostedApi) {
            deckRecoveryRevision = data.sourceRevision;
            reloadRequired = true;
            sections.forEach((_, index) => unrenderedSlides.add(index));
            apiBase = location.origin;
            setStatus("The last arrangement saved but did not rebuild. Open Slides and use Undo or Redo arrangement to recover.", "error");
            updateButtons();
            return false;
          }
          if (data.sourceRevision !== sourceRevision) {
            throw new Error(hostedApi
              ? `This deck is older than its source. Use Copy Edits before reloading if you have pending changes. If the mismatch remains, ask an agent to rebuild and publish ${meta.viewId}.`
              : "This deck is older than its source. Use Copy Edits before rebuilding and reloading if you have pending changes.");
          }
          if (hostedApi && (!buildRevision || data.buildRevision !== buildRevision)) {
            throw new Error(`This deck needs its current editable build. Use Copy Edits before reloading if you have pending changes. If the mismatch remains, ask an agent to rebuild and publish ${meta.viewId}.`);
          }
          apiBase = location.origin;
          publicationRetry = null;
          updateButtons();
          showPendingStatus();
          return true;
        }
      } catch (error) {
        apiError = error instanceof TypeError ? "Could not reach the editor service. Retry when it is available. Your edits are still in this tab." : String(error.message || error);
        setStatus(apiError, "error");
      }
    }
    updateButtons();
    return false;
  }

  function updateButtons() {
    const index = slideIndex(), hasEdits = visualDirty(index) || sourceDirty(index);
    const invalid = visualEditError(index);
    const history = histories.get(index);
    $("te-undo").disabled = !!deckRecoveryRevision || savingSlide !== null || composing || (!history?.canUndo() && !pendingGroup);
    $("te-redo").disabled = !!deckRecoveryRevision || savingSlide !== null || composing || !!pendingGroup || !history?.canRedo();
    $("te-save").disabled = !!deckRecoveryRevision || (!hasEdits && !publicationRetry) || savingSlide !== null || !!invalid && !publicationRetry;
    $("te-save").textContent = publicationRetry ? "Retry Publish" : apiBase ? "Save Slide" : apiError ? "Retry Save" : "Copy Edits";
    $("te-save").title = publicationRetry ? "Publish the source that was already saved" : apiBase ? `Save slide ${index + 1} to ${meta.sourceFile}${hostedApi ? ` and publish ${meta.viewId}` : ""}` : apiError || "Copy this slide's edits. The source will remain unchanged.";
    $("te-copy-edits").hidden = pendingSlides().length === 0 || (!apiBase && !apiError);
    $("te-copy-edits").disabled = savingSlide !== null;
    $("te-source").disabled = !!deckRecoveryRevision;
    $("te-image").hidden = !capabilities.images;
    $("te-slides").hidden = !capabilities.organize;
    $("te-image").disabled = savingSlide !== null || hasEdits || reloadRequired || !!publicationRetry;
    $("te-slides").disabled = savingSlide !== null;
    $("te-reset").disabled = !selectedEl || savingSlide !== null;
    $("te-save-src").disabled = !!deckRecoveryRevision || drawerSlide === null || !sourceDirty(drawerSlide) || savingSlide !== null || publicationRetry !== null;
    $("te-copy").disabled = drawerSlide === null || !sourceDrafts.has(drawerSlide);
    $("te-textarea").readOnly = !!deckRecoveryRevision || drawerSlide === null || !sourceDrafts.has(drawerSlide) || visualDirty(drawerSlide) || savingSlide !== null;
    if (moveable) {
      const draggable = !deckRecoveryRevision && !editingText && savingSlide === null, resizable = !deckRecoveryRevision && savingSlide === null;
      if (moveable.draggable !== draggable) moveable.draggable = draggable;
      if (moveable.resizable !== resizable) moveable.resizable = resizable;
    }
  }

  function mathSource(element) {
    if (!element.matches(".katex-display,.katex")) return null;
    if (element.dataset.teMathSource !== undefined) return element.dataset.teMathSource;
    const annotation = element.querySelector('annotation[encoding="application/x-tex"]');
    if (!annotation) return null;
    const tex = annotation.textContent.trim();
    return element.classList.contains("katex-display") ? `$$\n${tex}\n$$` : `$${tex}$`;
  }

  function serializeInline(el, mode = "md") {
    if (textSession?.formulaOnly && el === textSession.element && el.isContentEditable) {
      // Contenteditable represents pasted line breaks with divs or brs.
      return el.innerText.replace(/\u00a0/g, " ").trim();
    }
    let out = "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) {
        const t = (n.nodeValue || "").replace(/\u00a0/g, " ");
        out += mode === "html" ? t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : t;
      } else if (n.nodeType === 1) {
        if (n.classList.contains("xarp-edit-math-token")) { out += n.textContent || ""; continue; }
        const formula = mathSource(n);
        if (formula !== null) { out += formula; continue; }
        const tag = n.tagName.toLowerCase(), inner = serializeInline(n, mode);
        if (tag === "br") out += "<br>";
        else if (tag === "strong" || tag === "b") out += mode === "md" ? `**${inner}**` : `<strong>${inner}</strong>`;
        else if (tag === "em" || tag === "i") out += mode === "md" ? `*${inner}*` : `<em>${inner}</em>`;
        else if (tag === "code") out += mode === "md" ? `\`${inner}\`` : `<code>${inner}</code>`;
        else if (tag === "a") out += mode === "md" ? `[${inner}](${n.getAttribute("href") || ""})` : `<a href="${n.getAttribute("href") || ""}">${inner}</a>`;
        else out += inner;
      }
    }
    return out.trim();
  }

  function initElementBaseline(el, section) {
    if (el.dataset.teInit === "1") return;
    ensureHistory(sections.indexOf(section));
    const tag = el.tagName.toLowerCase();
    const beforeText = (el.textContent || "").replace(/\u00a0/g, " ").trim();
    const sameTag = [...section.querySelectorAll(tag)].filter(node => !node.closest("[data-pf-mark-generated]"));
    const tagOccurrence = Math.max(0, sameTag.indexOf(el));
    let occurrence = 0;
    for (const other of section.querySelectorAll(`${TEXT_SEL},svg text`)) {
      if (other === el) break;
      if ((other.dataset.teBeforeText ?? (other.textContent || "").replace(/\u00a0/g, " ").trim()) === beforeText) occurrence++;
    }
    el.dataset.teInit = "1";
    el.dataset.teSlide = String(sections.indexOf(section));
    el.dataset.teTag = tag;
    el.dataset.teTagOcc = String(tagOccurrence);
    el.dataset.teOcc = String(occurrence);
    el.dataset.teBeforeText = beforeText;
    el.dataset.teBeforeMd = isSvgChild(el) ? beforeText : serializeInline(el, "md");
    el.dataset.teBeforeHtml = isSvgChild(el) ? beforeText : serializeInline(el, "html");
    el.dataset.teOrigStyle = el.getAttribute("style") || "";
    for (const a of ["x", "y", "width", "height", "cx", "cy", "transform"]) {
      if (el.hasAttribute(a)) el.dataset[`teOrig_${a}`] = el.getAttribute(a);
    }
    el.dataset.teKey = `${tag}:${tagOccurrence}:${beforeText.slice(0, 40)}`;
  }

  function recordElementChange(el) {
    if (!el || el.dataset.teInit !== "1") return;
    const sIdx = Number(el.dataset.teSlide);
    if (!Number.isInteger(sIdx) || sIdx < 0) return;
    // Replace the map on each change so derived Markdown has a stable cache key.
    const map = new Map(editsBySlide.get(sIdx));
    const afterText = (el.textContent || "").replace(/\u00a0/g, " ").trim();
    const afterMd = isSvgChild(el) ? afterText : serializeInline(el, "md");
    const afterHtml = isSvgChild(el) ? afterText : serializeInline(el, "html");
    const textChanged = afterMd !== el.dataset.teBeforeMd || afterText !== el.dataset.teBeforeText;

    let svgAttrs = undefined, style = undefined;
    if (isSvgChild(el)) {
      const changed = {};
      for (const a of ["x", "y", "width", "height", "cx", "cy", "transform"]) {
        const cur = el.getAttribute(a), orig = el.dataset[`teOrig_${a}`];
        if (cur !== null && cur !== orig) changed[a] = cur;
      }
      if (Object.keys(changed).length) svgAttrs = changed;
    } else {
      const curStyle = (el.getAttribute("style") || "").trim();
      if (curStyle !== (el.dataset.teOrigStyle || "").trim()) style = curStyle;
    }

    if (!textChanged && !svgAttrs && style === undefined) {
      map.delete(el.dataset.teKey);
    } else {
      map.set(el.dataset.teKey, {
        tag: el.dataset.teTag,
        tagOccurrence: Number(el.dataset.teTagOcc || 0),
        occurrence: Number(el.dataset.teOcc || 0),
        beforeText: el.dataset.teBeforeText,
        beforeMd: el.dataset.teBeforeMd,
        beforeHtml: el.dataset.teBeforeHtml,
        ...(textChanged ? { afterText, afterMd, afterHtml } : { afterText: el.dataset.teBeforeText }),
        ...(svgAttrs ? { svgAttrs } : {}),
        ...(style !== undefined ? { style } : {}),
      });
    }
    editsBySlide.set(sIdx, map);
    showPendingStatus();
    updateButtons();
    renderOverlay();
  }

  function metrics(el, section, sr, rectFor) {
    const r = rectFor(el);
    const sx = sr.width / 1280 || 1, sy = sr.height / 720 || 1;
    const x = Math.round((r.left - sr.left) / sx), y = Math.round((r.top - sr.top) / sy);
    const w = Math.round(r.width / sx), h = Math.round(r.height / sy);
    let overflow = x < -2 || y < -2 || x + w > 1282 || y + h > 722;
    const svg = el.closest("svg");
    if (svg && section.contains(svg) && el !== svg) {
      const gr = rectFor(svg);
      if (r.left < gr.left - 2 || r.right > gr.right + 2 || r.top < gr.top - 2 || r.bottom > gr.bottom + 2) overflow = true;
    }
    return { rect: r, x, y, w, h, overflow };
  }

  function desc(el) {
    const tag = el.tagName.toLowerCase();
    const cls = [...el.classList].filter(c => !c.startsWith("bespoke-") && !c.startsWith("xarp-edit")).slice(0, 2);
    return cls.length ? `${tag}.${cls.join(".")}` : tag;
  }

  function createBox(rect, cls, label = "") {
    const d = document.createElement("div");
    d.className = `xarp-editor-box ${cls}`;
    Object.assign(d.style, { left: `${Math.round(rect.left)}px`, top: `${Math.round(rect.top)}px`, width: `${Math.max(0, Math.round(rect.width))}px`, height: `${Math.max(0, Math.round(rect.height))}px` });
    if (label) {
      const l = document.createElement("div");
      l.className = "xarp-editor-box-label";
      l.textContent = label;
      d.appendChild(l);
    }
    return d;
  }

  function renderOverlay() {
    if (!editActive) {
      if (overlayFrame !== null) cancelAnimationFrame(overlayFrame);
      overlayFrame = null;
      if (overlay.hasChildNodes()) overlay.replaceChildren();
      return;
    }
    if (overlayFrame === null) overlayFrame = requestAnimationFrame(paintOverlay);
  }

  function paintOverlay() {
    overlayFrame = null;
    const index = slideIndex(), section = sections[index];
    if (!editActive || !section) { overlay.replaceChildren(); return; }

    // Read geometry once per element before changing the visible overlay.
    const rects = new Map();
    const rectFor = element => {
      if (!rects.has(element)) rects.set(element, element.getBoundingClientRect());
      return rects.get(element);
    };
    const sr = rectFor(section), cs = getComputedStyle(section), boxes = [];
    const sx = sr.width / 1280 || 1, sy = sr.height / 720 || 1;
    const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0, pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    boxes.push([{ left: sr.left + pl * sx, top: sr.top + pt * sy, width: sr.width - (pl + pr) * sx, height: sr.height - (pt + pb) * sy }, "xarp-editor-box-margin"]);

    if (showAllBoxes) {
      for (const el of section.querySelectorAll(ALL_SEL)) {
        if (el.closest(NAV_SEL) || el.closest(".katex,.mermaid,[data-pf-mark-generated]") || el === hoveredEl || el === selectedEl) continue;
        const m = metrics(el, section, sr, rectFor);
        if (m.w > 2 && m.h > 2) boxes.push([m.rect, `xarp-editor-box-wireframe${m.overflow ? " is-overflow" : ""}`, m.overflow ? `${desc(el)} · ${m.w}×${m.h} OVERFLOW` : ""]);
      }
    }

    const active = hoveredEl || selectedEl;
    if (active && section.contains(active)) {
      const parent = active.parentElement?.closest(BOX_SEL);
      if (parent && section.contains(parent) && parent !== active) {
        const pm = metrics(parent, section, sr, rectFor);
        boxes.push([pm.rect, "xarp-editor-box-parent", `${desc(parent)} · ${pm.w}×${pm.h} @ (${pm.x}, ${pm.y})`]);
      }
    }

    let coords = "Click/drag box to move/resize · Double-click text to edit";
    if (hoveredEl && hoveredEl !== selectedEl && section.contains(hoveredEl)) {
      const hm = metrics(hoveredEl, section, sr, rectFor);
      const lbl = `${desc(hoveredEl)} · ${hm.w}×${hm.h} px @ (${hm.x}, ${hm.y})${hm.overflow ? " · OVERFLOW" : ""}`;
      boxes.push([hm.rect, `xarp-editor-box-hover${hm.overflow ? " is-overflow" : ""}`, lbl]);
      coords = lbl;
    } else if (selectedEl && section.contains(selectedEl)) {
      const sm = metrics(selectedEl, section, sr, rectFor);
      const lbl = `${desc(selectedEl)} · ${sm.w}×${sm.h} px @ (${sm.x}, ${sm.y})${sm.overflow ? " · OVERFLOW" : ""}`;
      boxes.push([{ left: sm.rect.left, top: sm.rect.top, width: 0, height: 0 }, sm.overflow ? "is-overflow" : "", lbl]);
      coords = `${lbl}${editingText ? " (editing text)" : " (drag/resize or double-click to edit text)"}`;
    }

    const fragment = document.createDocumentFragment();
    for (const box of boxes) fragment.appendChild(createBox(...box));
    overlay.replaceChildren(fragment);
    const label = `#${index + 1} · ${slideId(index)}`;
    if ($("te-slide").textContent !== label) { $("te-slide").textContent = label; $("te-slide").title = label; }
    if ($("te-coords").textContent !== coords) $("te-coords").textContent = coords;
  }

  function ensureMoveable() {
    if (moveable || !window.Moveable) return;
    moveable = new window.Moveable(document.body, {
      target: null,
      draggable: true,
      resizable: true,
      origin: false,
      snappable: true,
      snapGap: false,
      snapThreshold: 6,
      snapDirections: { left: true, right: true, top: true, bottom: true, center: true, middle: true },
      elementSnapDirections: { left: true, right: true, top: true, bottom: true, center: true, middle: true },
    });
    moveable.on("dragStart", e => {
      if (savingSlide !== null) { e.stop(); return; }
      const el = e.target, section = sectionFor(el);
      if (!section || section !== activeSection()) { e.stop(); return; }
      beginChange(sections.indexOf(section), "gesture", JSON.stringify(elementPath(el, section)));
      initElementBaseline(el, section);
      el.dataset.teDragX = el.getAttribute("x") || el.getAttribute("cx") || "0";
      el.dataset.teDragY = el.getAttribute("y") || el.getAttribute("cy") || "0";
    });
    moveable.on("drag", e => {
      if (sectionFor(e.target) !== activeSection()) return;
      const el = e.target, tag = el.tagName.toLowerCase();
      if (isSvgChild(el)) {
        if (["text", "rect", "image", "use", "svg"].includes(tag) && (el.hasAttribute("x") || el.hasAttribute("y"))) {
          el.setAttribute("x", String(Math.round(Number(el.dataset.teDragX) + e.dist[0])));
          el.setAttribute("y", String(Math.round(Number(el.dataset.teDragY) + e.dist[1])));
        } else if (tag === "circle" || tag === "ellipse") {
          el.setAttribute("cx", String(Math.round(Number(el.dataset.teDragX) + e.dist[0])));
          el.setAttribute("cy", String(Math.round(Number(el.dataset.teDragY) + e.dist[1])));
        } else {
          el.setAttribute("transform", `translate(${Math.round(e.beforeTranslate[0])}, ${Math.round(e.beforeTranslate[1])})`);
        }
      } else {
        el.style.transform = `translate(${Math.round(e.beforeTranslate[0])}px, ${Math.round(e.beforeTranslate[1])}px)`;
      }
      renderOverlay();
    });
    moveable.on("dragEnd", e => { recordElementChange(e.target); flushHistory(); });
    moveable.on("resizeStart", e => {
      if (savingSlide !== null) { e.stop(); return; }
      const el = e.target, section = sectionFor(el);
      if (!section || section !== activeSection()) { e.stop(); return; }
      beginChange(sections.indexOf(section), "gesture", JSON.stringify(elementPath(el, section)));
      initElementBaseline(el, section);
      if (isSvgChild(el) && !["rect", "image", "svg"].includes(el.tagName.toLowerCase())) e.stop();
      el.dataset.teDragX = el.getAttribute("x") || "0";
      el.dataset.teDragY = el.getAttribute("y") || "0";
    });
    moveable.on("resize", e => {
      if (sectionFor(e.target) !== activeSection()) return;
      const el = e.target;
      if (isSvgChild(el)) {
        el.setAttribute("width", String(Math.round(e.width)));
        el.setAttribute("height", String(Math.round(e.height)));
        if (el.hasAttribute("x") || e.drag.dist[0]) el.setAttribute("x", String(Math.round(Number(el.dataset.teDragX) + e.drag.dist[0])));
        if (el.hasAttribute("y") || e.drag.dist[1]) el.setAttribute("y", String(Math.round(Number(el.dataset.teDragY) + e.drag.dist[1])));
      } else {
        el.style.width = `${Math.round(e.width)}px`;
        el.style.height = `${Math.round(e.height)}px`;
        el.style.transform = `translate(${Math.round(e.drag.beforeTranslate[0])}px, ${Math.round(e.drag.beforeTranslate[1])}px)`;
      }
      renderOverlay();
    });
    moveable.on("resizeEnd", e => { recordElementChange(e.target); flushHistory(); });
  }

  function editedFormula(source, original) {
    const template = document.createElement("template");
    if (source === original?.source) template.innerHTML = original.html;
    else {
      const delimiter = source.startsWith("$$") ? "$$" : "$";
      if (!source.startsWith(delimiter) || !source.endsWith(delimiter) || source.length <= 2 * delimiter.length) return document.createTextNode(source);
      const tex = source.slice(delimiter.length, -delimiter.length);
      if (delimiter === "$" && tex !== tex.trim()) return document.createTextNode(source);
      try {
        template.innerHTML = window.XarpEdits.renderMath(tex, { displayMode: delimiter === "$$" });
        template.content.firstElementChild.dataset.teMathSource = source;
      } catch {
        // Incomplete TeX and deck-defined macros keep their source for Marp.
        return document.createTextNode(source);
      }
    }
    return template.content;
  }

  function finishMathEditing(target) {
    const session = textSession;
    const source = serializeInline(session.element);
    if (source === session.markdown) target.innerHTML = session.html;
    else if (session.formulaOnly) target.replaceChildren(editedFormula(source));
    else for (const token of target.querySelectorAll(".xarp-edit-math-token")) {
      token.replaceWith(editedFormula(token.textContent, session.math[Number(token.dataset.teMath)]));
    }
  }

  function stopTextEditing(preferredFocus) {
    composing = false;
    const index = textSession?.index ?? (selectedEl?.dataset.teSlide !== undefined ? Number(selectedEl.dataset.teSlide) : slideIndex());
    const focus = preferredFocus || focusState(index);
    if (svgInput) {
      const current = svgInput;
      svgInput = null;
      current.input.onblur = null;
      current.target.textContent = current.input.value;
      recordElementChange(current.target);
      current.input.remove();
    }
    if (selectedEl?.isContentEditable && textSession?.element === selectedEl) {
      finishMathEditing(selectedEl);
      selectedEl.removeAttribute("contenteditable");
      recordElementChange(selectedEl);
    }
    textSession = null;
    editingText = false;
    if (moveable) moveable.draggable = true;
    if (!restoringHistory) flushHistory(focus);
    renderOverlay();
  }

  let mouseDown = false;
  window.addEventListener("mouseup", () => { mouseDown = false; }, true);

  function updateSnapping(alt = false) {
    if (!moveable) return;
    const section = activeSection();
    moveable.snappable = snapEnabled && !alt;
    if (!section) return;
    moveable.snapContainer = section;
    moveable.verticalGuidelines = [0, section.clientWidth / 3, section.clientWidth / 2, section.clientWidth * 2 / 3, section.clientWidth];
    moveable.horizontalGuidelines = [0, section.clientHeight / 3, section.clientHeight / 2, section.clientHeight * 2 / 3, section.clientHeight];
    moveable.elementGuidelines = [...section.querySelectorAll(ALL_SEL)].filter(el => el !== selectedEl && !el.contains(selectedEl) && !selectedEl?.contains(el) && !el.closest(`${NAV_SEL},.katex,.mermaid,[data-pf-mark-generated]`));
  }

  function selectBox(el, section, startEvent = null) {
    if (selectedEl !== el) stopTextEditing();
    selectedEl = el;
    ensureMoveable();
    if (moveable) {
      // SVG attributes are canonical. A stale SVG layout measurement must not
      // trigger Moveable's CSS-size correction and undo the requested resize.
      moveable.checkResizableError = !el || !isSvgChild(el);
      moveable.target = el;
      updateSnapping(startEvent?.altKey);
      if (startEvent && el && !editingText) {
        moveable.waitToChangeTarget().then(() => {
          if (mouseDown && selectedEl === el && !editingText) moveable.dragStart(startEvent);
        });
      }
    }
    updateButtons();
    renderOverlay();
  }

  function startTextEditing(el, section) {
    if (!el || !section || savingSlide !== null || sourceDirty(slideIndex()) || unrenderedSlides.has(slideIndex())) return;
    initElementBaseline(el, section);
    if (!restoringHistory) flushHistory();
    editingText = true;
    if (moveable) moveable.draggable = false;

    if (el.tagName.toLowerCase() === "text" && el.closest("svg")) {
      const r = el.getBoundingClientRect(), input = document.createElement("input");
      input.type = "text";
      input.className = "xarp-editor-svg-input";
      input.value = (el.textContent || "").trim();
      Object.assign(input.style, { left: `${Math.max(8, Math.round(r.left - 4))}px`, top: `${Math.max(42, Math.round(r.top - 4))}px`, minWidth: `${Math.max(140, Math.round(r.width + 24))}px` });
      input.oninput = () => { el.textContent = input.value; recordElementChange(el); groupTyping(Number(el.dataset.teSlide), "svg-text", el.dataset.teKey); };
      input.onblur = () => stopTextEditing();
      document.body.appendChild(input);
      svgInput = { input, target: el };
      input.focus(); input.select();
      renderOverlay();
      return;
    }

    if (textSession?.element === el) return;
    const markdown = serializeInline(el);
    const formulaOnly = el.childElementCount === 1 && mathSource(el.firstElementChild) === markdown;
    textSession = { element: el, index: Number(el.dataset.teSlide), html: el.innerHTML, markdown, formulaOnly, math: [] };
    if (formulaOnly) el.textContent = markdown;
    else for (const k of el.querySelectorAll(".katex")) {
      const formula = k.closest(".katex-display") ?? k;
      const source = mathSource(formula);
      if (source === null) continue;
      const tok = document.createElement("code");
      tok.className = "xarp-edit-math-token";
      tok.textContent = source;
      tok.dataset.teMath = String(textSession.math.length);
      textSession.math.push({ source, html: formula.outerHTML });
      formula.replaceWith(tok);
    }
    el.setAttribute("contenteditable", formulaOnly ? "plaintext-only" : "true");
    el.focus();
    renderOverlay();
  }

  function resetSelectedBox() {
    if (!selectedEl || selectedEl.dataset.teInit !== "1") return;
    const section = sectionFor(selectedEl);
    if (section !== activeSection()) return;
    stopTextEditing();
    beginChange(sections.indexOf(section), "reset", selectedEl.dataset.teKey);
    if (isSvgChild(selectedEl)) {
      for (const a of ["x", "y", "width", "height", "cx", "cy", "transform"]) {
        if (`teOrig_${a}` in selectedEl.dataset) selectedEl.setAttribute(a, selectedEl.dataset[`teOrig_${a}`]);
        else selectedEl.removeAttribute(a);
      }
    } else {
      const orig = selectedEl.dataset.teOrigStyle || "";
      if (orig) selectedEl.setAttribute("style", orig);
      else selectedEl.removeAttribute("style");
    }
    recordElementChange(selectedEl);
    flushHistory();
  }

  function nudgeSelected(dx, dy) {
    const element = selectedEl, section = sectionFor(element), index = sections.indexOf(section);
    if (!section || section !== activeSection() || unrenderedSlides.has(index)) { selectBox(null, null); return; }
    const key = JSON.stringify(elementPath(element, section));
    beginChange(index, "nudge", key);
    initElementBaseline(element, section);
    if (isSvgChild(element)) {
      const tag = element.tagName.toLowerCase();
      if (["text", "rect", "image", "use"].includes(tag)) {
        element.setAttribute("x", String(Number(element.getAttribute("x") || 0) + dx));
        element.setAttribute("y", String(Number(element.getAttribute("y") || 0) + dy));
      } else if (tag === "circle" || tag === "ellipse") {
        element.setAttribute("cx", String(Number(element.getAttribute("cx") || 0) + dx));
        element.setAttribute("cy", String(Number(element.getAttribute("cy") || 0) + dy));
      } else {
        const matrix = element.transform.baseVal.consolidate()?.matrix;
        const transform = matrix ? DOMMatrix.fromMatrix(matrix) : new DOMMatrix();
        transform.e += dx; transform.f += dy;
        element.setAttribute("transform", `matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})`);
      }
    } else {
      const current = getComputedStyle(element).transform;
      const transform = new DOMMatrix(current === "none" ? undefined : current);
      transform.e += dx; transform.f += dy;
      element.style.transform = transform.toString();
    }
    recordElementChange(element);
    moveable?.updateRect();
    groupTyping(index, "nudge", key);
  }

  async function loadSlideSource() {
    const index = slideIndex(), id = slideId(index), request = ++sourceRequest;
    drawerSlide = index;
    $("te-drawer-title").textContent = `${id} (${meta.sourceFile || "slides.md"})`;
    $("te-textarea").value = sourceDrafts.get(index)?.markdown ?? "";
    $("te-textarea").placeholder = "Loading Markdown…";
    updateButtons();
    if (visualDirty(index)) {
      $("te-textarea").placeholder = "Save this slide's visual edits before editing its Markdown.";
      return;
    }
    if (sourceDrafts.has(index)) {
      $("te-textarea").placeholder = "";
      return;
    }
    if (!apiBase) await probeServer();
    if (apiBase) {
      try {
        const r = await fetch(`${apiBase}/__xarp/slide?view=${encodeURIComponent(meta.viewId)}&slide=${encodeURIComponent(id)}`, { cache: "no-store" });
        const data = await r.json().catch(() => null);
        recognizeApi(data);
        if (!r.ok || !data?.ok) throw new Error(serviceError(r, data, "Could not load Markdown"));
        if (data.viewId !== meta.viewId || data.sourceFile !== meta.sourceFile || data.slideId !== id || typeof data.markdown !== "string" || typeof data.sourceRevision !== "string") {
          throw new Error("Editor server returned a different slide or source");
        }
        if (request !== sourceRequest || drawerSlide !== index || !drawerOpen || !editActive || visualDirty(index) || sourceDrafts.has(index)) return;
        if (data.sourceRevision !== sourceRevision || (hostedApi && data.buildRevision !== buildRevision)) throw new Error("Slide source changed while loading. Copy your edits before reloading.");
        const baseline = baselines.get(baselineId(index));
        if (baseline.markdown === undefined) baseline.markdown = data.markdown;
        sourceDrafts.set(index, { markdown: data.markdown, original: data.markdown, sourceRevision: data.sourceRevision });
        ensureHistory(index);
        if (request === sourceRequest && drawerSlide === index) {
          $("te-textarea").value = data.markdown;
          $("te-textarea").placeholder = "";
          updateButtons();
        }
        return;
      } catch (error) {
        if (request !== sourceRequest || drawerSlide !== index) return;
        $("te-textarea").placeholder = String(error.message || error);
        setStatus(String(error.message || error), "error");
        return;
      }
    }
    if (request === sourceRequest && drawerSlide === index) {
      $("te-textarea").placeholder = sourceHelp();
      updateButtons();
    }
  }

  async function copyText(text, message) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable in this browser context");
      await navigator.clipboard.writeText(text);
      setStatus(message);
      return true;
    } catch (error) {
      setStatus(`Copy failed: ${error.message || error}`, "error");
      return false;
    }
  }

  async function saveEdits(explicitMarkdown, targetSlide) {
    if (deckRecoveryRevision) return;
    if (savingSlide !== null) return;
    if (publicationRetry) return retryPublication();
    stopTextEditing();
    flushHistory();
    const sIdx = targetSlide ?? (explicitMarkdown !== undefined ? drawerSlide : slideIndex());
    if (sIdx === null) return;
    const invalid = visualEditError(sIdx);
    if (invalid) return setStatus(invalid, "error");
    const id = slideId(sIdx), map = editsBySlide.get(sIdx), draft = sourceDrafts.get(sIdx);
    let markdown = explicitMarkdown ?? (sourceDirty(sIdx) ? draft.markdown : undefined);
    const edits = map ? [...map.values()] : [];
    if (markdown !== undefined && !draft) return setStatus("Load this slide's Markdown before saving", "error");
    if (markdown !== undefined && edits.length) return setStatus("Save the visual edits before replacing this slide's Markdown", "error");
    if (markdown !== undefined && markdown === savedMarkdown(sIdx)) return setStatus("No pending changes on this slide");
    if (markdown === undefined && !visualDirty(sIdx)) return setStatus("No pending changes on this slide");
    savingSlide = sIdx;
    updateButtons();
    try {
    if (!apiBase) await probeServer();
    if (publicationRetry) { savingSlide = null; return await retryPublication(); }
    if (!apiBase && apiError) return setStatus(apiError, "error");
    if (apiBase) {
      await ensureBaseline(sIdx);
      if (markdown === undefined && activeBaselines.get(sIdx) !== savedBaselines.get(sIdx)) markdown = visualMarkdown(sIdx);
    }
    const revision = sourceRevision;

    if (apiBase) {
      if (!revision) return setStatus("Rebuild and reload this deck before saving", "error");
      setStatus(`Saving ${id}…`);
      try {
        const r = await fetch(`${apiBase}/__xarp/save`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewId: meta.viewId, sourceFile: meta.sourceFile, sourceRevision: revision, buildRevision, slideId: id, ...(markdown !== undefined ? { markdown } : { edits }) })
        });
        const data = await r.json().catch(() => null);
        recognizeApi(data);
        if (!data) throw new Error(r.status === 401
          ? serviceError(r, data, "Save failed")
          : "The editor service returned no save receipt. Check the source and rendered deck before retrying. Your edits are still in this tab.");
        if (data.viewId !== meta.viewId || data.sourceFile !== meta.sourceFile || data.slideId !== id) {
          throw new Error(data.error ? serviceError(r, data, "Save failed") : "Editor server returned a different slide or source");
        }
        if (!data.saved) throw new Error(serviceError(r, data, "Save failed"));
        editsBySlide.set(sIdx, new Map());
        if (sourceRevision === revision) sourceRevision = data.sourceRevision;
        if (data.rebuilt && typeof data.buildRevision === "string") buildRevision = data.buildRevision;
        for (const pending of sourceDrafts.values()) {
          if (pending.sourceRevision === revision) pending.sourceRevision = data.sourceRevision;
        }
        if (typeof data.markdown === "string") {
          sourceDrafts.set(sIdx, { markdown: data.markdown, original: data.markdown, sourceRevision: data.sourceRevision });
        } else if (draft && markdown !== undefined) {
          draft.original = markdown;
          draft.markdown = markdown;
          draft.sourceRevision = data.sourceRevision;
        } else {
          sourceDrafts.delete(sIdx);
        }
        const section = sections[sIdx];
        if (selectedEl && section?.contains(selectedEl)) selectBox(null, section);
        applyRenderingReceipt(data, sIdx);
        if (drawerSlide === sIdx) {
          $("te-textarea").value = sourceDrafts.get(sIdx)?.markdown ?? "";
          $("te-textarea").placeholder = sourceDrafts.has(sIdx) ? "" : "Reopen Slide Markdown to load the saved source.";
        }
        if (typeof data.markdown === "string") {
          const nextId = `slide-${sIdx}-baseline-${++baselineSerial}`;
          const rendered = sections[sIdx];
          baselines.set(nextId, { markdown: data.markdown, revision: data.sourceRevision, html: rendered.innerHTML, attributes: [...rendered.attributes].map(attribute => [attribute.name, attribute.value]) });
          activeBaselines.set(sIdx, nextId);
          savedBaselines.set(sIdx, nextId);
        }
        if (!data.rebuilt) {
          apiError = `Saved ${id} to ${meta.sourceFile}. Rebuild failed${hostedApi ? ". The published deck was not updated" : ""}: ${data.error || "check the editor service"}`;
          apiBase = null;
          setStatus(apiError, "error");
        } else if (hostedApi && data.published !== true) {
          if (data.retryable && typeof data.sourceRevision === "string" && typeof data.buildRevision === "string") {
            publicationRetry = { viewId: data.viewId, sourceRevision: data.sourceRevision, buildRevision: data.buildRevision };
          }
          apiError = `Saved and rebuilt ${id}. Publication ${data.published === false ? "failed" : "was not confirmed"}: ${data.error || "ask an agent to publish this deck"}`;
          apiBase = null;
          setStatus(apiError, "error");
        } else if (!r.ok || !data.ok) {
          apiError = `Saved ${id} to ${meta.sourceFile}. The editor service reported an error: ${data.error || `HTTP ${r.status}`}`;
          apiBase = null;
          setStatus(apiError, "error");
        } else {
          apiError = "";
          const others = pendingSlides();
          const pendingViews = Array.isArray(data.pendingViews) ? data.pendingViews.filter(view => typeof view === "string") : [];
          const savedText = hostedApi ? `Saved and published ${id} in ${meta.viewId}` : `Saved ${id} to ${meta.sourceFile}`;
          setStatus(`${savedText}${others.length ? `. Unsaved slides: ${others.map(index => index + 1).join(", ")}` : ""}${pendingViews.length ? `. Other decks need publication: ${pendingViews.join(", ")}` : ""}`, "saved");
        }
      } catch (e) {
        apiError = e instanceof TypeError
          ? "The save connection was interrupted. Check the source and rendered deck before retrying. Your edits are still in this tab."
          : String(e.message || e);
        apiBase = null;
        setStatus(apiError, "error");
      }
      return;
    }
    const text = JSON.stringify({ viewId: meta.viewId, sourceFile: meta.sourceFile, sourceRevision: revision, buildRevision, slideId: id, ...(markdown !== undefined ? { markdown } : { edits }) }, null, 2);
    await copyText(text, `Copied ${id} edits. Source is unchanged`);
    } catch (error) { setStatus(String(error.message || error), "error"); }
    finally { savingSlide = null; pruneBaselines(); updateButtons(); renderOverlay(); }
  }

  async function copyPendingEdits() {
    stopTextEditing();
    try {
    const slides = pendingSlides().map(index => {
      const draft = sourceDrafts.get(index);
      return {
        slideId: slideId(index),
        sourceRevision,
        ...(sourceDirty(index) ? { markdown: draft.markdown } : activeBaselines.get(index) !== savedBaselines.get(index) ? { markdown: visualMarkdown(index) } : { edits: [...(editsBySlide.get(index)?.values() || [])] }),
      };
    });
    if (!slides.length) return setStatus("No pending changes");
    await copyText(JSON.stringify({ viewId: meta.viewId, sourceFile: meta.sourceFile, buildRevision, slides }, null, 2), "Copied all pending edits. Source is unchanged");
    } catch (error) { setStatus(String(error.message || error), "error"); }
  }

  async function retryPublication() {
    if (!publicationRetry || savingSlide !== null) return;
    stopTextEditing();
    const retry = publicationRetry;
    savingSlide = -1;
    updateButtons();
    setStatus(`Publishing ${meta.viewId}…`);
    try {
      const response = await fetch(`${location.origin}/__xarp/retry`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(retry),
      });
      const data = await response.json().catch(() => null);
      recognizeApi(data);
      if (!data || !response.ok || !data.ok || data.published !== true) {
        if (data?.editorApi === true && data.retryable !== true && response.status === 409) publicationRetry = null;
        throw new Error(serviceError(response, data, "Publication was not confirmed"));
      }
      if (data.viewId !== retry.viewId || data.sourceFile !== meta.sourceFile || data.sourceRevision !== retry.sourceRevision || data.buildRevision !== retry.buildRevision) {
        throw new Error("The publication receipt does not match the saved deck");
      }
      const pending = pendingSlides();
      const canAdvance = sourceRevision === data.sourceRevision || pending.length === 0;
      const alreadyRendered = sourceRevision === data.sourceRevision && buildRevision === data.buildRevision;
      if (canAdvance) {
        sourceRevision = data.sourceRevision;
        buildRevision = data.buildRevision;
      }
      const index = meta.slides?.indexOf(data.slideId) ?? -1;
      const section = sections[index];
      if (index >= 0 && !visualDirty(index) && !sourceDirty(index)) {
        if (typeof data.markdown === "string") sourceDrafts.set(index, { markdown: data.markdown, original: data.markdown, sourceRevision: data.sourceRevision });
        if (!alreadyRendered) applyRenderingReceipt({ ...data, rebuilt: true }, index);
        if (drawerSlide === index && sourceDrafts.has(index)) $("te-textarea").value = sourceDrafts.get(index).markdown;
        if (typeof data.markdown === "string" && section) {
          const nextId = `slide-${index}-baseline-${++baselineSerial}`;
          baselines.set(nextId, { markdown: data.markdown, revision: data.sourceRevision, html: section.innerHTML, attributes: [...section.attributes].map(attribute => [attribute.name, attribute.value]) });
          activeBaselines.set(index, nextId);
          savedBaselines.set(index, nextId);
          editsBySlide.set(index, new Map());
        }
      } else if (!alreadyRendered) reloadRequired = true;
      publicationRetry = null;
      apiError = canAdvance ? "" : "Copy pending edits before reloading this updated deck.";
      apiBase = canAdvance ? location.origin : null;
      const pendingViews = Array.isArray(data.pendingViews) ? data.pendingViews.filter(view => typeof view === "string") : [];
      setStatus(`Published ${meta.viewId}${pending.length ? `. Unsaved slides: ${pending.map(index => index + 1).join(", ")}` : ""}${pendingViews.length ? `. Other decks need publication: ${pendingViews.join(", ")}` : ""}${apiError ? `. ${apiError}` : ""}`, "saved");
    } catch (error) {
      apiError = `Publication was not confirmed: ${error.message || error}`;
      setStatus(apiError, "error");
    } finally {
      savingSlide = null;
      pruneBaselines();
      updateButtons();
      renderOverlay();
    }
  }

  async function setEditMode(next) {
    if (next) window.dispatchEvent(new CustomEvent("xarp-mode-request", { detail: { mode: "edit" } }));
    editActive = next;
    document.body.classList.toggle("xarp-edit-active", editActive);
    if (!editActive) {
      stopTextEditing();
      selectBox(null, null);
      hoveredEl = null;
      overlay.innerHTML = "";
    } else {
      ensureMoveable();
      await probeServer();
      try { await ensureBaseline(slideIndex()); } catch (error) { setStatus(String(error.message || error), "error"); }
      if (drawerOpen) await loadSlideSource();
      renderOverlay();
    }
  }

  function findTarget(raw, section) {
    if (!raw || !section?.contains(raw) || raw.closest?.(NAV_SEL) || savingSlide !== null || sourceDirty(slideIndex()) || unrenderedSlides.has(slideIndex())) return null;
    const start = raw.closest?.("[data-pf-mark-generated]") ? raw.closest("svg") : raw;
    const target = start && (start.closest("img,svg text,svg rect,svg circle") || start.closest(TEXT_SEL) || start.closest(BOX_SEL));
    return target && section.contains(target) && !target.closest(".katex,.mermaid,[data-pf-mark-generated]") ? target : null;
  }

  $("te-snap").onclick = () => {
    snapEnabled = !snapEnabled;
    $("te-snap").setAttribute("aria-pressed", String(snapEnabled));
    $("te-snap").textContent = snapEnabled ? "Snap: On" : "Snap: Off";
    updateSnapping();
  };
  window.addEventListener("keydown", event => { if (event.key === "Alt") updateSnapping(true); });
  window.addEventListener("keyup", event => { if (event.key === "Alt") updateSnapping(); });
  window.addEventListener("blur", () => updateSnapping());

  const imagePicker = document.createElement("input");
  imagePicker.type = "file";
  imagePicker.accept = "image/png,image/jpeg,image/gif,image/webp";
  imagePicker.hidden = true;
  document.body.append(imagePicker);
  $("te-image").onclick = () => imagePicker.click();
  imagePicker.onchange = () => { const file = imagePicker.files[0]; imagePicker.value = ""; if (file) void insertImage(file); };

  async function insertImage(file) {
    if (!editActive || savingSlide !== null) return;
    stopTextEditing(); flushHistory();
    const index = slideIndex();
    if (visualDirty(index) || sourceDirty(index)) return setStatus("Save this slide's edits before inserting an image.", "error");
    if (!capabilities.images || !apiBase || reloadRequired) return setStatus("Open a current local editor to insert an image.", "error");
    if (file.size > 8 * 1024 * 1024) return setStatus("Image is too large (maximum 8 MiB).", "error");
    savingSlide = index; updateButtons();
    let ready = false;
    try {
      await ensureBaseline(index);
      const image = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read image")); reader.readAsDataURL(file);
      });
      const response = await fetch(`${apiBase}/__xarp/asset`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewId: meta.viewId, sourceFile: meta.sourceFile, sourceRevision, image }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Image upload failed");
      if (data.sourceRevision !== sourceRevision || data.viewId !== meta.viewId || data.sourceFile !== meta.sourceFile || !/^assets\/xarp\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(data.path)) throw new Error("Image receipt does not match this deck");
      // Stage through ordinary source history so Undo and failed saves retain the insertion.
      beginChange(index, "source");
      const original = savedMarkdown(index);
      const markdown = `${original}\n\n<img src="${data.path}" alt="" width="480">`;
      sourceDrafts.set(index, { original, markdown, sourceRevision });
      flushHistory();
      ready = true;
    } catch (error) { setStatus(error.message, "error"); }
    finally { savingSlide = null; updateButtons(); }
    if (ready) await saveEdits(sourceDrafts.get(index).markdown, index);
  }
  // Native image dragging can present an existing image as a dropped file.
  // Moveable owns these gestures; only external files should reach insertion.
  document.addEventListener("dragstart", event => {
    if (editActive && activeSection()?.contains(event.target) && event.target.closest("img")) event.preventDefault();
  }, true);
  document.addEventListener("dragover", event => {
    if (editActive && activeSection()?.contains(event.target) && event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  document.addEventListener("drop", event => {
    if (!editActive || !activeSection()?.contains(event.target) || !event.dataTransfer?.files.length) return;
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer.files.length !== 1) return setStatus("Insert one image at a time.", "error");
    void insertImage(event.dataTransfer.files[0]);
  });

  const organizer = document.createElement("dialog");
  organizer.className = "xarp-slide-organizer";
  organizer.setAttribute("aria-label", "Organize slides");
  document.body.append(organizer);
  $("te-slides").onclick = () => void openOrganizer();
  async function openOrganizer() {
    stopTextEditing(); flushHistory();
    try {
      const response = await fetch(`${apiBase}/__xarp/deck?view=${encodeURIComponent(meta.viewId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load slides");
      if (data.sourceRevision !== (deckRecoveryRevision ?? sourceRevision) || data.viewId !== meta.viewId || data.sourceFile !== meta.sourceFile) throw new Error("Source changed. Save or copy edits before reloading.");
      organizer.replaceChildren();
      const heading = document.createElement("h2"); heading.textContent = "Slides"; organizer.append(heading);
      const help = document.createElement("p");
      help.textContent = "Changes save immediately and reload the deck. Save pending edits and clear drawing ink first. Drag to reorder, or use the arrow buttons.";
      if (!data.capabilities.resizeDeck) help.textContent += " Fixed section counts allow reordering only; section boundaries stay at their configured positions.";
      organizer.append(help);
      const button = (parent, label, action, disabled = false) => {
        const el = document.createElement("button"); el.type = "button"; el.textContent = label; el.disabled = disabled;
        el.onclick = action; parent.append(el); return el;
      };
      const controls = document.createElement("div"); organizer.append(controls);
      button(controls, "Undo arrangement", () => organize({ action: "undo" }), !data.canUndo);
      button(controls, "Redo arrangement", () => organize({ action: "redo" }), !data.canRedo);
      button(controls, "Close", () => organizer.close());
      if (deckRecoveryRevision) {
        help.textContent = "The arrangement was saved, but rebuilding failed. Use the available Undo or Redo arrangement action to restore the previous source and rebuild it.";
        organizer.showModal();
        return;
      }
      const list = document.createElement("ol"); organizer.append(list);
      let dragging = null;
      data.slides.forEach((slide, index) => {
        const row = document.createElement("li"); row.draggable = true; row.dataset.slideId = slide.id;
        const title = document.createElement("span"); title.textContent = `${index + 1}. ${slide.title}`; row.append(title);
        button(row, "↑", () => organize({ action: "move", slideId: slide.id, to: index - 1 }), index === 0).setAttribute("aria-label", `Move slide ${index + 1} up`);
        button(row, "↓", () => organize({ action: "move", slideId: slide.id, to: index + 1 }), index === data.slides.length - 1).setAttribute("aria-label", `Move slide ${index + 1} down`);
        button(row, "Add after", () => organize({ action: "add", slideId: slide.id }), !data.capabilities.resizeDeck);
        button(row, "Duplicate", () => organize({ action: "duplicate", slideId: slide.id }), !data.capabilities.resizeDeck);
        button(row, "Delete", () => organize({ action: "delete", slideId: slide.id }), !data.capabilities.resizeDeck || data.slides.length === 1);
        row.ondragstart = event => { dragging = slide.id; event.dataTransfer.setData("text/plain", slide.id); };
        row.ondragover = event => { if (dragging) event.preventDefault(); };
        row.ondrop = event => { event.preventDefault(); if (dragging && dragging !== slide.id) void organize({ action: "move", slideId: dragging, to: index }); dragging = null; };
        row.ondragend = () => { dragging = null; };
        list.append(row);
      });
      organizer.showModal();
    } catch (error) { setStatus(error.message, "error"); }
  }
  async function organize(action) {
    if (savingSlide !== null) return;
    organizer.close();
    if (pendingSlides().length || reloadRequired && !(deckRecoveryRevision && ["undo", "redo"].includes(action.action)) || publicationRetry) return setStatus("Save or copy pending edits and reload before organizing slides.", "error");
    const event = new CustomEvent("xarp-before-deck-change", { cancelable: true });
    if (!window.dispatchEvent(event)) return setStatus("Export and clear drawing ink before organizing slides.", "error");
    savingSlide = -1; updateButtons();
    try {
      const response = await fetch(`${apiBase}/__xarp/deck`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewId: meta.viewId, sourceFile: meta.sourceFile, sourceRevision: deckRecoveryRevision ?? sourceRevision, ...action }) });
      const data = await response.json();
      if (!data.saved) throw new Error(data.error || "Slides were not changed");
      if (data.viewId !== meta.viewId || data.sourceFile !== meta.sourceFile || !data.deckChanged) throw new Error("Unexpected deck receipt; reload to check the source");
      if (!data.rebuilt) {
        deckRecoveryRevision = data.sourceRevision;
        reloadRequired = true;
        sections.forEach((_, index) => unrenderedSlides.add(index));
        selectBox(null, null);
        throw new Error(`Source saved, but rebuild failed. Open Slides and use Undo or Redo arrangement to recover. ${data.error}`);
      }
      const rebuilt = new DOMParser().parseFromString(data.html, "text/html");
      const next = JSON.parse(rebuilt.getElementById("xarp-meta").textContent);
      const index = next.slides.indexOf(data.selected);
      savingSlide = null;
      location.hash = `#${Math.max(0, index) + 1}`;
      location.reload();
    } catch (error) { setStatus(error.message, "error"); }
    finally { savingSlide = null; updateButtons(); }
  }

  $("te-done").onclick = () => setEditMode(false);
  $("te-reset").onclick = () => resetSelectedBox();
  $("te-undo").onclick = () => changeHistory("undo");
  $("te-redo").onclick = () => changeHistory("redo");
  $("te-save").onclick = () => saveEdits();
  $("te-copy-edits").onclick = () => copyPendingEdits();
  $("te-save-src").onclick = () => saveEdits($("te-textarea").value);
  $("te-copy").onclick = () => copyText($("te-textarea").value, "Copied Markdown. Source is unchanged");
  $("te-textarea").addEventListener("input", () => {
    const draft = sourceDrafts.get(drawerSlide);
    if (!draft) return;
    draft.markdown = $("te-textarea").value;
    groupTyping(drawerSlide, "source");
    reconcileStaleSlides();
    showPendingStatus();
    updateButtons();
  });
  $("te-boxes").onclick = () => {
    showAllBoxes = !showAllBoxes;
    $("te-boxes").setAttribute("aria-pressed", String(showAllBoxes));
    $("te-boxes").textContent = showAllBoxes ? "Boxes: All" : "Boxes: Hover";
    renderOverlay();
  };
  $("te-source").onclick = async () => {
    drawerOpen = !drawerOpen;
    $("te-source").setAttribute("aria-pressed", String(drawerOpen));
    drawer.classList.toggle("is-open", drawerOpen);
    if (drawerOpen) {
      selectBox(null, activeSection());
      await loadSlideSource();
    }
  };

  document.addEventListener("mousemove", e => {
    if (!editActive || toolbar.contains(e.target) || drawer.contains(e.target) || e.target.closest?.(".moveable-control-box")) return;
    const next = findTarget(e.target, activeSection());
    if (next !== hoveredEl) { hoveredEl = next; renderOverlay(); }
  }, true);

  document.addEventListener("mousedown", e => {
    mouseDown = true;
    if (!editActive || toolbar.contains(e.target) || drawer.contains(e.target) || svgInput?.input.contains(e.target) || e.target.closest?.(".moveable-control-box")) return;
    const section = activeSection(), target = findTarget(e.target, section);
    if (editingText && selectedEl?.contains(e.target)) return;
    if (target) {
      if (target !== selectedEl) selectBox(target, section, e);
    } else {
      selectBox(null, section);
    }
  }, true);

  document.addEventListener("dblclick", e => {
    if (!editActive || toolbar.contains(e.target) || drawer.contains(e.target)) return;
    const section = activeSection(), target = findTarget(e.target, section);
    if (target && (target.matches?.(TEXT_SEL) || target.tagName?.toLowerCase() === "text")) {
      e.preventDefault(); e.stopPropagation();
      selectBox(target, section);
      startTextEditing(target, section);
    }
  }, true);

  document.addEventListener("click", e => {
    if (editActive && activeSection()?.contains(e.target) && !e.target.closest(NAV_SEL) && e.target.closest("a")) e.preventDefault();
  }, true);

  document.addEventListener("input", e => {
    if (editActive && selectedEl && (e.target === selectedEl || selectedEl.contains(e.target))) {
      recordElementChange(selectedEl);
      groupTyping(Number(selectedEl.dataset.teSlide), "text", selectedEl.dataset.teKey);
    }
  }, true);

  document.addEventListener("beforeinput", e => {
    if (!editActive || savingSlide !== null) return;
    const source = e.target === $("te-textarea"), svg = e.target === svgInput?.input;
    const text = selectedEl?.isContentEditable && (e.target === selectedEl || selectedEl.contains(e.target));
    if (!source && !svg && !text) return;
    if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!composing) changeHistory(e.inputType === "historyUndo" ? "undo" : "redo");
      return;
    }
    beginChange(source ? drawerSlide : Number((svg ? svgInput.target : selectedEl).dataset.teSlide), source ? "source" : svg ? "svg-text" : "text", source ? "" : (svg ? svgInput.target : selectedEl).dataset.teKey);
  }, true);
  document.addEventListener("compositionstart", () => { if (editActive) { composing = true; if (pendingGroup) clearTimeout(pendingGroup.timer); updateButtons(); } }, true);
  document.addEventListener("compositionend", () => { if (editActive) { composing = false; if (pendingGroup) groupTyping(pendingGroup.index, pendingGroup.kind, pendingGroup.key); updateButtons(); } }, true);

  window.addEventListener("keydown", e => {
    const a = document.activeElement;
    if (e.target.closest?.(".xarp-color-scheme-picker")) return;
    const typing = a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable || a.closest?.('[contenteditable="true"]'));

    if (organizer.open) {
      if (e.key === "Escape") { e.preventDefault(); organizer.close(); }
      e.stopImmediatePropagation();
      return;
    }
    if (editActive && (composing || e.isComposing || e.keyCode === 229)) return;
    if (editActive && (e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "z" || (e.ctrlKey && e.key.toLowerCase() === "y"))) {
      e.preventDefault(); e.stopImmediatePropagation();
      changeHistory(e.key.toLowerCase() === "y" || e.shiftKey ? "redo" : "undo");
      return;
    }

    if (editActive && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault(); e.stopPropagation();
      return void saveEdits(a === $("te-textarea") ? $("te-textarea").value : undefined);
    }
    if (typing) {
      if (e.key === "Escape" || (e.key === "Enter" && a === svgInput?.input)) { e.preventDefault(); e.stopPropagation(); stopTextEditing(); }
      else e.stopPropagation();
      return;
    }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "e") {
      e.preventDefault(); e.stopPropagation();
      return void setEditMode(!editActive);
    }
    if (!editActive) return;

    if (e.key === "Enter" && selectedEl && (selectedEl.matches?.(TEXT_SEL) || selectedEl.tagName?.toLowerCase() === "text")) {
      e.preventDefault(); e.stopPropagation();
      return void startTextEditing(selectedEl, activeSection());
    }
    if (selectedEl && moveable && savingSlide === null && !sourceDirty(slideIndex()) && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      nudgeSelected(dx, dy);
      return;
    }
    if (e.key.toLowerCase() === "b") { e.preventDefault(); e.stopPropagation(); $("te-boxes").click(); }
    else if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      if (selectedEl) selectBox(null, activeSection());
      else setEditMode(false);
    }
  }, true);

  let observedSlide = slideIndex();
  const slideChanged = () => {
    const index = slideIndex();
    if (index === observedSlide) return;
    observedSlide = index;
    if (!editActive) return;
    selectBox(null, null);
    flushHistory();
    hoveredEl = null;
    if (drawerOpen) void loadSlideSource();
    ensureBaseline(index).catch(error => setStatus(String(error.message || error), "error"));
    showPendingStatus(); updateButtons(); renderOverlay();
  };
  const slideObserver = new MutationObserver(slideChanged);
  for (const slide of slideSvgs) slideObserver.observe(slide, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("hashchange", slideChanged);
  window.addEventListener("beforeunload", event => {
    if (!pendingSlides().length && savingSlide === null) return;
    event.preventDefault();
    event.returnValue = "";
  });
  window.addEventListener("xarp-mode-request", event => {
    if (event.detail?.mode === "draw" && editActive) void setEditMode(false);
  });
  window.addEventListener("xarp-preview-update", event => {
    // A save already patched the current slide and must retain its undo history.
    if (event.detail.sourceRevision === sourceRevision || savingSlide !== null) {
      event.preventDefault(); event.detail.notify = false;
    } else if (editActive || pendingSlides().length) {
      event.preventDefault();
      apiError = "Source changed. Copy pending edits before reloading.";
      showPendingStatus(); updateButtons();
    }
  });
  window.addEventListener("resize", () => { if (editActive) renderOverlay(); });
  updateButtons();
  if (new URLSearchParams(location.search).get("edit") === "1") {
    if (document.readyState === "complete") void setEditMode(true);
    else window.addEventListener("load", () => setEditMode(true));
  }
})();
