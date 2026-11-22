(() => {
  if (window.__xarpNarrationBooted) return;
  window.__xarpNarrationBooted = true;

  // Pass pointer events through non-interactive __videoCtl stage iframes so clicking/scrolling
  // any part of an embedded SVG stage counts as interacting with the parent slide.
  function passThroughStageFrames(root = document) {
    for (const frame of root.querySelectorAll('svg[data-marpit-svg] iframe')) {
      if (frame.hasAttribute('data-interactive')) continue;
      const syncFrame = () => {
        try {
          if (frame.contentWindow?.__videoCtl) {
            frame.style.pointerEvents = 'none';
            frame.tabIndex = -1;
          }
        } catch {}
      };
      syncFrame();
      frame.addEventListener('load', syncFrame, { passive: true });
    }
  }
  passThroughStageFrames();

  function readNarrationMeta() {
    try {
      const raw = document.getElementById('xarp-meta')?.textContent;
      if (!raw) return null;
      return JSON.parse(raw)?.plugins?.narration ?? null;
    } catch {
      return null;
    }
  }

  function wantsWatch() {
    try {
      const params = new URLSearchParams(location.search);
      const watchParam = params.get('watch') ?? params.get('mode');
      return watchParam === '1' || watchParam === 'true' || watchParam === 'watch';
    } catch {
      return false;
    }
  }

  function ensureStyle(href) {
    if (!href) return Promise.resolve();
    const existing = [...document.querySelectorAll('link[rel="stylesheet"]')]
      .find(link => link.getAttribute('href') === href);
    if (existing) return Promise.resolve();
    return new Promise(resolve => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      link.addEventListener('load', done, { once: true });
      link.addEventListener('error', done, { once: true });
      setTimeout(done, 250);
      document.head.append(link);
    });
  }

  function loadScript(src) {
    if (!src) return Promise.reject(new Error('Missing script URL'));
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.append(script);
    });
  }

  let bundlePromise = null;
  function loadWatchBundle() {
    if (window.__xarpNarration) return Promise.resolve(window.__xarpNarration);
    if (bundlePromise) return bundlePromise;
    const opts = readNarrationMeta();
    if (!opts?.timelineUrl) return Promise.resolve(null);
    const styleUrl = opts.styleUrl || '_xarp/plugins/narration.css';
    const scriptUrl = opts.scriptUrl || '_xarp/plugins/narration.js';
    bundlePromise = Promise.all([
      ensureStyle(styleUrl),
      loadScript(opts.timelineUrl),
    ])
      .then(() => loadScript(scriptUrl))
      .then(() => window.__xarpNarration || null)
      .catch(err => {
        bundlePromise = null;
        throw err;
      });
    return bundlePromise;
  }

  window.__xarpLoadWatch = async (openOpts) => {
    const api = await loadWatchBundle();
    if (api && openOpts !== false && !api.getState?.().watchActive) {
      api.open(openOpts || { fromCurrentSlide: true });
    }
    return api;
  };

  window.addEventListener('popstate', () => {
    if (wantsWatch() && !window.__xarpNarration) {
      void loadWatchBundle();
    }
  });

  const initialOpts = readNarrationMeta();
  if (wantsWatch() || initialOpts?.launcher === true) {
    void loadWatchBundle();
  }
})();
