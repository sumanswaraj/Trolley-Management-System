export function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

export function icon(name, size = '') {
  return `<svg class="ic ${esc(size)}" aria-hidden="true"><use href="#i-${esc(name)}"></use></svg>`;
}
