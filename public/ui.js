/** Escape every value from a user or API before inserting it into HTML. */
export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}
export const formatTime = (timestamp) => new Date(timestamp).toLocaleString();
export const canManagePlant = (user) => ['Admin', 'Supervisor'].includes(user.role);

export function inputField(label, name, type = 'text', attributes = '') {
  return `<label>${label}<input name="${name}" type="${type}" required ${attributes}></label>`;
}
export function selectField(label, name, options, required = true) {
  return `<label>${label}<select name="${name}" aria-label="${escapeHtml(label)}" ${required ? 'required' : ''}>${options}</select></label>`;
}
export function optionsFor(records) {
  return records
    .map(
      (record) =>
        `<option value="${escapeHtml(record.id)}">${escapeHtml(record.id)} · ${escapeHtml(record.name)}</option>`,
    )
    .join('');
}
export function form(id, fields, submitLabel) {
  return `<form id="${id}">
    ${fields}
    <div class="error" role="alert"></div>
    <button type="submit">${submitLabel}</button>
  </form>`;
}
export function dataTable(headers, rows) {
  if (!rows.length) return '<div class="empty">No records yet.</div>';
  return `<div class="table"><table>
    <thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table></div>`;
}
export function pageTitle(title, subtitle) {
  return `<h1>${title}</h1><p class="subtitle">${subtitle}</p>`;
}
