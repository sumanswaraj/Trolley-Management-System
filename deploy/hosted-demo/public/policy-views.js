import {
  escapeHtml as escape,
  inputField,
  selectField,
  optionsFor,
  form,
  dataTable,
  pageTitle,
} from './ui.js';

const checkbox = (label, name, checked = false) =>
  `<label class="check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>${label}</label>`;

export function policyView(state) {
  const policy = state.policy;
  if (!policy)
    return pageTitle('Plant rules', 'Only supervisors and administrators can view these rules.');
  return `${pageTitle('Plant rules', 'Configure your actual plant before enabling enforcement. Exceptions require independent approval.')}
    <div class="grid">
      ${
        state.user.role === 'Admin'
          ? `<section class="card"><h3>Enforcement</h3>
        ${form(
          'policy-settings',
          checkbox(
            'Enforce allowed product routes',
            'enforce_routes',
            policy.settings.enforce_routes,
          ) +
            checkbox(
              'Enforce trolley/product compatibility',
              'enforce_categories',
              policy.settings.enforce_categories,
            ) +
            checkbox(
              'Restrict operations by assigned location',
              'scope_operations',
              policy.settings.scope_operations,
            ),
          'Save enforcement',
        )}
        <p class="hint">Existing installations start with enforcement off. Capacity unit checks and outside approvals always apply.</p>
      </section>`
          : ''
      }
      <section class="card"><h3>Trolley compatibility</h3>
        ${form('policy-categories', inputField('Trolley type (exact master value)', 'trolley_type') + inputField('Allowed product category', 'category'), 'Add compatibility')}
        ${dataTable(
          ['Trolley type', 'Category'],
          policy.categories.map(
            (rule) =>
              `<tr><td>${escape(rule.trolley_type)}</td><td>${escape(rule.category)}</td></tr>`,
          ),
        )}
      </section>
      <section class="card"><h3>Allowed route</h3>
        ${form(
          'policy-routes',
          selectField('From', 'source', optionsFor(state.locations)) +
            selectField('To', 'destination', optionsFor(state.locations)) +
            inputField('Product category (Empty for empty trolleys)', 'category') +
            checkbox('Quality release required', 'requires_quality'),
          'Save route',
        )}
        ${dataTable(
          ['From', 'To', 'Category', 'Quality'],
          policy.routes.map(
            (route) =>
              `<tr><td>${escape(route.source)}</td><td>${escape(route.destination)}</td><td>${escape(route.category)}</td><td>${route.requires_quality ? 'Required' : '—'}</td></tr>`,
          ),
        )}
      </section>
      ${
        state.user.role === 'Admin'
          ? `<section class="card"><h3>Location permissions</h3>
        ${form(
          'policy-scopes',
          selectField(
            'User',
            'user_id',
            (state.accounts || [])
              .filter((user) => user.active)
              .map(
                (user) =>
                  `<option value="${user.id}">${escape(user.name)} · ${escape(user.role)}</option>`,
              )
              .join(''),
          ) +
            selectField('Location', 'location', optionsFor(state.locations)) +
            checkbox('May depart from here', 'can_depart') +
            checkbox('May receive or approve here', 'can_receive'),
          'Save permission',
        )}
        ${dataTable(
          ['User ID', 'Location', 'Depart', 'Receive'],
          policy.scopes.map(
            (scope) =>
              `<tr><td>${scope.user_id}</td><td>${escape(scope.location)}</td><td>${scope.can_depart ? 'Yes' : 'No'}</td><td>${scope.can_receive ? 'Yes' : 'No'}</td></tr>`,
          ),
        )}
        <p class="hint">Administrators retain access. Other users need explicit permissions when location restrictions are enabled.</p>
      </section>`
          : ''
      }
    </div>`;
}
