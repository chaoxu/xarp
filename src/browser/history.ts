import { createHistory } from '../editor/history.js';

Object.assign(window, { XarpHistory: Object.freeze({ create: createHistory }) });
