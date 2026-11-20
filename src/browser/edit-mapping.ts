import { applyVisualEdits } from '../editor/slide-edits.js';
import { renderToString } from 'katex';

Object.assign(window, { XarpEdits: Object.freeze({ applyVisualEdits, renderMath: renderToString }) });
