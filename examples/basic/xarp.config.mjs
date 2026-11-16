import { editing, drawing } from '@chaoxu/xarp/plugins';

export default {
  input: 'slides.md',
  output: 'dist',
  plugins: [editing(), drawing()],
  sections: [
    { label: 'Create', count: 2 },
    { label: 'Present', count: 2 },
  ],
};
