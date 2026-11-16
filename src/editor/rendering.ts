import { load } from 'cheerio';

/** Compare build artifacts, which have no browser or editor state mixed in. */
export function renderingChanges(previous: string, next: string, slideIds: string[], savedSlide: string) {
  const before = load(previous), after = load(next);
  const oldSlides = before('svg[data-marpit-svg]'), newSlides = after('svg[data-marpit-svg]');
  const changedSlides = slideIds.filter((id, index) => id !== savedSlide && before.html(oldSlides[index]) !== after.html(newSlides[index]));
  const styles = 'head style, head link[rel="stylesheet"]';
  const deckStyleChanged = before(styles).toString() !== after(styles).toString()
    || oldSlides.length !== newSlides.length || newSlides.length !== slideIds.length;
  return { changedSlides, deckStyleChanged };
}
