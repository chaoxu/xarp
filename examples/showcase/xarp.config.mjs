import { editing, drawing, narration } from '@chaoxu/xarp/plugins';
import { curveDemo } from './plugins/curve.mjs';

export default {
  input: 'slides.md',
  output: 'dist',
  theme: 'showcase.css',
  plugins: [editing(), drawing(), narration(), curveDemo()],
  narration: {
    glossary: { KaTeX: 'Kay-tech' },
  },
  sections: [
    { label: 'Create', count: 6 },
    { label: 'Edit', count: 5 },
    { label: 'Draw', count: 3 },
    { label: 'Present', count: 4 },
    { label: 'Extend', count: 4 },
  ],
};
