import {
  escapeHtml as escape,
  formatTime,
  inputField,
  selectField,
  optionsFor,
  form,
  dataTable,
  pageTitle,
} from './ui.js';

export function readerView(state, secret) {
  const data = state.readerData;
  if (!data) return pageTitle('Readers & tags', 'Administrator access required.');
  return `${pageTitle('Readers & tags', 'Provision reader identities, map RFID tags and review signed observations.')}
    <div class="callout">Reader observations do not change the operational location. Confirm arrival in Move / scan after checking the physical trolley.</div>
    ${
      secret
        ? `<section class="card secret"><h3>Save this credential now</h3><p>Reader: ${escape(secret.id)}</p><code>${escape(secret.secret)}</code>
      <p class="hint">This credential is displayed once. Store it securely in the reader adapter. It will not appear in reader lists.</p>
      <button class="btn" id="hide-secret">I have saved it</button></section>`
        : ''
    }
    ${!data.configured ? '<div class="callout">The server owner must configure DEVICE_ENCRYPTION_KEY to provision and authenticate readers. Existing manual workflows remain available.</div>' : ''}
    <div class="grid">
      <section class="card"><h3>Provision reader</h3>
        ${form('readers', inputField('Reader ID', 'id') + inputField('Reader name', 'name') + selectField('Installed location', 'location', optionsFor(state.locations)), 'Create reader')}
      </section>
      <section class="card"><h3>Assign RFID / QR tag</h3>
        ${form('tags', inputField('Tag value', 'tag') + selectField('Trolley', 'trolley', state.trolleys.map((trolley) => `<option>${escape(trolley.id)}</option>`).join('')), 'Assign tag')}
        ${dataTable(
          ['Tag', 'Trolley'],
          data.tags.map(
            (tag) => `<tr><td>${escape(tag.tag)}</td><td>${escape(tag.trolley)}</td></tr>`,
          ),
        )}
      </section>
    </div>
    <section class="card mt"><h3>Registered readers</h3>
      ${dataTable(
        ['Reader', 'Location', 'Last observed', 'Status', 'Actions'],
        data.readers.map(
          (reader) => `<tr>
        <td>${escape(reader.name)}<div class="hint">${escape(reader.id)}</div></td><td>${escape(reader.location)}</td>
        <td>${reader.last_seen ? formatTime(reader.last_seen) : 'No events received'}</td><td>${reader.active ? 'Active' : 'Inactive'}</td>
        <td>${reader.active ? `<button class="btn" data-reader-rotate="${escape(reader.id)}">Rotate key</button> <button class="btn danger" data-reader-disable="${escape(reader.id)}">Deactivate</button>` : '—'}</td>
      </tr>`,
        ),
      )}
    </section>
    <section class="card mt"><h3>Latest reader observations</h3>
      ${dataTable(
        ['Observed', 'Reader', 'Location', 'Tag', 'Trolley'],
        data.events.map(
          (event) => `<tr>
        <td>${formatTime(event.observed_at)}</td><td>${escape(event.reader)}</td><td>${escape(event.location)}</td><td>${escape(event.tag)}</td>
        <td>${escape(event.trolley || 'Unknown tag')}</td>
      </tr>`,
        ),
      )}
    </section>`;
}
