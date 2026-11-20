import { randomUUID } from 'node:crypto';
import { parseSource, requireValue } from '../source.js';

export interface DeckAction {
  action: 'move' | 'add' | 'duplicate' | 'delete' | 'undo' | 'redo';
  slideId?: string;
  to?: number;
}

/** Structural edits assign stable IDs once, preserving existing named IDs. */
export function editDeck(source: string, request: DeckAction) {
  const document = parseSource(source);
  requireValue(!document.editingError, document.editingError ?? 'Source mapping unavailable');
  const slides = document.slides.map(slide => ({
    id: slide.explicitId ? slide.id : `xarp-${randomUUID()}`,
    body: slide.body,
  }));
  const index = document.slides.findIndex(slide => slide.id === request.slideId);
  requireValue(index >= 0, 'The slide is not in this deck');
  let selected = slides[index]!.id;
  if (request.action === 'move') {
    requireValue(Number.isInteger(request.to) && request.to! >= 0 && request.to! < slides.length, 'Invalid slide position');
    slides.splice(request.to!, 0, slides.splice(index, 1)[0]!);
  } else if (request.action === 'add' || request.action === 'duplicate') {
    selected = `xarp-${randomUUID()}`;
    slides.splice(index + 1, 0, { id: selected, body: request.action === 'add' ? '# New slide' : slides[index]!.body });
  } else if (request.action === 'delete') {
    requireValue(slides.length > 1, 'A deck must contain at least one slide');
    slides.splice(index, 1);
    selected = slides[Math.min(index, slides.length - 1)]!.id;
  } else throw new Error('Unknown deck action');
  const updatedSource = `${document.prefix}\n${slides.map(slide => `<!-- slide: ${slide.id} -->\n\n${slide.body}`).join('\n\n---\n\n')}\n`;
  const parsed = parseSource(updatedSource);
  requireValue(!parsed.editingError && parsed.slides.length === slides.length && parsed.slides.every((slide, i) => slide.id === slides[i]!.id), 'The operation changed slide boundaries unexpectedly');
  return { updatedSource, selected };
}
