import showcase from './xarp.config.mjs';

export default {
  ...showcase,
  output: 'dist-quick',
  slides: ['welcome', 'mathematics', 'edit-text', 'draw-route', 'curve', 'start'],
  sections: [
    { label: 'Create', count: 2 },
    { label: 'Edit', count: 1 },
    { label: 'Draw', count: 1 },
    { label: 'Extend', count: 2 },
  ],
};
