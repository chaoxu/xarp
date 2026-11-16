// Served by dev only. Static exports have no background connections.
(() => {
  let version = Number(document.currentScript.dataset.version);
  let banner;
  const poll = async () => {
    try {
      const response = await fetch('/__xarp/version', { cache: 'no-store' });
      if (!response.ok) return;
      const update = await response.json();
      if (update.version === version) return;
      version = update.version;
      const event = new CustomEvent('xarp-preview-update', { cancelable: true, detail: { ...update, notify: true } });
      if (window.dispatchEvent(event)) return location.reload();
      if (!event.detail.notify || banner) return;
      banner = document.createElement('button');
      banner.type = 'button';
      banner.id = 'xarp-preview-update';
      banner.textContent = 'Source updated. Reload when ready.';
      Object.assign(banner.style, { position: 'fixed', bottom: '12px', right: '12px', zIndex: '2147483647', padding: '8px 12px', background: 'var(--pf-bg, white)', color: 'var(--pf-fg, black)', border: '1px solid var(--pf-border, #ccc)', borderRadius: '4px', cursor: 'pointer' });
      banner.addEventListener('click', () => location.reload());
      document.body.append(banner);
    } catch { /* The preview can be restarted while the page stays open. */ }
    finally { setTimeout(poll, 1000); }
  };
  setTimeout(poll, 1000);
})();
