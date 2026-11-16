/** Advanced backgrounds have decorative sections as well as the slide content. */
export const contentSectionSelector = 'section:not([data-marpit-advanced-background="background"]):not([data-marpit-advanced-background="pseudo"])';

export function contentSection(slide: Element) {
  return slide.querySelector<HTMLElement>(`:scope > foreignObject > ${contentSectionSelector}`);
}

export function contentSections(root: ParentNode) {
  return [...root.querySelectorAll('svg[data-marpit-svg]')].map(contentSection);
}
