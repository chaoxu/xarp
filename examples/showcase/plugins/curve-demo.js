(() => {
  const metadataElement = document.getElementById('xarp-meta');
  if (!metadataElement) return;

  let metadata;
  try {
    metadata = JSON.parse(metadataElement.textContent || '');
  } catch {
    return;
  }
  const initial = Number(metadata?.plugins?.['curve-demo']?.coefficient);
  if (!Number.isFinite(initial)) return;

  function update(input) {
    const example = input.closest('[data-curve-demo]');
    if (!example) return;
    const coefficient = Number(input.value);
    if (!Number.isFinite(coefficient)) return;
    const points = Array.from({ length: 81 }, (_, index) => {
      const x = -2 + index / 20;
      return `${index ? 'L' : 'M'} ${(340 + 115 * x).toFixed(2)} ${(300 - 65 * coefficient * x * x).toFixed(2)}`;
    });
    const path = example.querySelector('[data-curve-path]');
    const output = example.querySelector('output');
    if (!path || !output) return;
    path.setAttribute('d', points.join(' '));
    const formatted = coefficient.toFixed(2);
    output.value = formatted;
    output.textContent = formatted;
    input.setAttribute('aria-valuetext', formatted);
  }

  for (const input of document.querySelectorAll('[data-curve-input]')) {
    input.value = initial;
    input.addEventListener('input', () => update(input));
    input.addEventListener('change', () => update(input));
    // Marp's swipe recognizer listens on the presentation parent. Keep a
    // range drag on the control from becoming a slide swipe on touch devices.
    for (const eventName of ['touchstart', 'touchmove', 'touchend']) {
      input.addEventListener(eventName, event => event.stopPropagation(), { passive: true });
    }
    update(input);
  }

  // Delegation also works if Edit Mode replaces this slide after saving.
  document.addEventListener('input', event => {
    if (event.target instanceof Element && event.target.matches('[data-curve-input]')) update(event.target);
  });
  document.addEventListener('change', event => {
    if (event.target instanceof Element && event.target.matches('[data-curve-input]')) update(event.target);
  });
  document.addEventListener('keydown', event => {
    if (event.target instanceof Element && event.target.matches('[data-curve-input]')) event.stopPropagation();
  }, true);
})();
