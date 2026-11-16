(() => {
  const metadata = JSON.parse(document.getElementById('xarp-meta').textContent);
  const initial = metadata.plugins['curve-demo'].coefficient;

  function update(input) {
    const example = input.closest('[data-curve-demo]');
    const coefficient = Number(input.value);
    const points = Array.from({ length: 81 }, (_, index) => {
      const x = -2 + index / 20;
      return `${index ? 'L' : 'M'} ${(340 + 115 * x).toFixed(2)} ${(300 - 65 * coefficient * x * x).toFixed(2)}`;
    });
    example.querySelector('[data-curve-path]').setAttribute('d', points.join(' '));
    example.querySelector('output').value = coefficient.toFixed(2);
  }

  for (const input of document.querySelectorAll('[data-curve-input]')) {
    input.value = initial;
    update(input);
  }
  // Delegation also works if Edit Mode replaces this slide after saving.
  document.addEventListener('input', event => {
    if (event.target.matches('[data-curve-input]')) update(event.target);
  });
  document.addEventListener('keydown', event => {
    if (event.target.matches('[data-curve-input]')) event.stopPropagation();
  }, true);
})();
