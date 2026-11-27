/** Replays the CSS "film title" rise whenever the station title text changes. */
export function watchTitleChange(el: HTMLElement): void {
  let previous = el.textContent;
  new MutationObserver(() => {
    const next = el.textContent;
    if (next === previous) return;
    previous = next;
    el.classList.remove('title-rise');
    void el.offsetWidth; // restart the animation
    el.classList.add('title-rise');
  }).observe(el, { childList: true, characterData: true, subtree: true });
}
