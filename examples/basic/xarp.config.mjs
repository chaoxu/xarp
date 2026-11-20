import { editing, drawing, colorSchemes } from '@chaoxu/xarp/plugins';

export default {
  input: 'slides.md',
  output: 'dist',
  colorScheme: 'hanami',
  plugins: [editing(), drawing(), colorSchemes()],
  sections: [
    { label: 'Create', count: 2 },
    { label: 'Present', count: 2 },
  ],
};
