export function curveDemo() {
  return {
    name: 'curve-demo',
    scripts: [new URL('./curve-demo.js', import.meta.url)],
    data: { coefficient: 0.5 },
  };
}
