import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.mjs';
import { accountService } from '../src/services/accounts.mjs';
import { masterService } from '../src/services/masters.mjs';
import { movementService } from '../src/services/movements.mjs';
import { operationService } from '../src/services/operations.mjs';
import { policyService } from '../src/services/policies.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sampleId = (id) => `DEMO-${id}`;
const trolleyId = (index) => sampleId(`TR-${String(index).padStart(3, '0')}`);
const locations = [
  ['STORE-01', 'Main Store', 'Store', 'Stores', 40, 480, 24],
  ['PROD-L01', 'Production Line 01', 'Production', 'Production', 20, 240, 12],
  ['PROD-L02', 'Production Line 02', 'Production', 'Production', 20, 240, 12],
  ['PROD-L03', 'Production Line 03', 'Production', 'Production', 20, 240, 12],
  ['ASSY-01', 'Assembly', 'Assembly', 'Assembly', 14, 180, 12],
  ['QUALITY-01', 'Quality Inspection', 'Quality', 'Quality', 14, 90, 10],
  ['PACK-01', 'Packing', 'Packing', 'Packing', 14, 120, 10],
  ['FG-01', 'Finished Goods', 'Finished Goods', 'Stores', 16, 480, 10],
  ['DISPATCH-01', 'Dispatch', 'Dispatch', 'Dispatch', 12, 60, 8],
  ['MAINT-01', 'Maintenance', 'Maintenance', 'Maintenance', 8, 480, 8],
  ['OUT-01', 'Outside Plant', 'Outside Plant', 'Logistics', 24, 1440, 10],
];
const products = [
  ['RAW-S01', 'Steel Bar Stock Ø40', 'Raw', 'kg', 'B2610-S21'],
  ['CMP-A01', 'Component A – Gear Blank', 'Component', 'pcs', 'B2610-A14'],
  ['CMP-B02', 'Component B – Shaft Sleeve', 'Component', 'pcs', 'B2610-B07'],
  ['CMP-F05', 'Fastener Kit FK-05', 'Component', 'kits', 'B2609-F32'],
  ['WIP-G12', 'Gearbox Sub-assembly', 'WIP', 'pcs', 'B2610-G03'],
  ['ASM-A10', 'Product A – Pump Housing', 'WIP', 'pcs', 'B2610-PA9'],
  ['ASM-B20', 'Product B – Valve Body', 'WIP', 'pcs', 'B2610-PB4'],
  ['ASM-C30', 'Product C – Motor Rotor', 'WIP', 'pcs', 'B2610-PC2'],
  ['FIN-A40', 'Finished Pump Unit PU-40', 'Finished', 'pcs', 'B2610-FA6'],
  ['FIN-B50', 'Finished Valve Unit VU-50', 'Finished', 'pcs', 'B2610-FB1'],
];
const productGroups = {
  Raw: ['Store', 'Production', 'Outside Plant'],
  Component: ['Store', 'Production', 'Assembly', 'Quality', 'Outside Plant'],
  WIP: ['Production', 'Assembly', 'Quality', 'Store', 'Outside Plant'],
  Finished: ['Quality', 'Packing', 'Finished Goods', 'Dispatch', 'Outside Plant'],
};
const trolleyTypes = {
  'Material Trolley': { capacity: 500, material: 'Raw Material', categories: ['Raw', 'Component'] },
  'Component Trolley': { capacity: 350, material: 'Component', categories: ['Component', 'Raw'] },
  'Finished Goods': { capacity: 600, material: 'Finished Goods', categories: ['Finished', 'WIP'] },
  'WIP Trolley': { capacity: 400, material: 'WIP', categories: ['WIP', 'Component'] },
  'Rework Trolley': {
    capacity: 300,
    material: 'Rework',
    categories: ['Raw', 'Component', 'WIP', 'Finished'],
  },
};
const categoryTypes = {
  Raw: 'Material Trolley',
  Component: 'Component Trolley',
  WIP: 'WIP Trolley',
  Finished: 'Finished Goods',
};
const accounts = [
  ['demo.manager', 'Sunita Rao (sample)', 'Plant Manager'],
  ['demo.supervisor', 'Ramesh Iyer (sample)', 'Supervisor'],
  ['demo.operator', 'Rahul Kumar (sample)', 'Operator'],
  ['demo.quality', 'Neha Sharma (sample)', 'Quality User'],
  ['demo.store', 'Amit Verma (sample)', 'Store User'],
];

function requirePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256)
    throw new Error(
      'Set ADMIN_PASSWORD to 12–256 characters in .env before starting the isolated demo.',
    );
}

export function seedDemo(repository, password) {
  requirePassword(password);
  const existingUser = repository.get("SELECT id FROM users WHERE username <> 'admin' LIMIT 1");
  const tables = [
    'locations',
    'products',
    'trolleys',
    'movements',
    'audit',
    'readers',
    'alerts',
    'verifications',
  ];
  if (existingUser || tables.some((table) => repository.get(`SELECT 1 FROM ${table} LIMIT 1`)))
    return { seeded: false, reason: 'Existing demo records preserved' };
  const account = accountService(repository, password);
  const admin = repository.get(
    "SELECT id, username, name, role FROM users WHERE username = 'admin'",
  );
  const masters = masterService(repository);
  const policies = policyService(repository);
  const movements = movementService(repository, policies);
  const operations = operationService(repository, policies);
  for (const [username, name, role] of accounts)
    account.create(admin, { username, name, role, password });
  const users = Object.fromEntries(
    repository.all('SELECT id, username, name, role FROM users').map((user) => [user.role, user]),
  );
  for (const [id, name, group, department, capacity, expected] of locations) {
    masters.create(admin, 'locations', {
      id: sampleId(id),
      name,
      group_name: group,
      department,
      bay_capacity: capacity,
      expected_minutes: expected,
      external: group === 'Outside Plant',
    });
  }
  for (const [id, name, category, unit, batch] of products) {
    masters.create(admin, 'products', {
      id: sampleId(id),
      name,
      category,
      unit,
      default_batch: batch,
      allowed_locations: locations
        .filter((location) => productGroups[category].includes(location[2]))
        .map((location) => sampleId(location[0])),
    });
  }
  for (const [type, info] of Object.entries(trolleyTypes))
    for (const category of info.categories)
      policies.addRule(admin, 'categories', { trolley_type: type, category });
  policies.configure(admin, {
    enforce_categories: true,
    outside_approval: true,
    mismatch_approval: true,
  });
  let index = 0;
  const transfer = (trolley, destination, product, input = {}) => {
    const current = masters.detail(admin, 'trolleys', trolley);
    return movements.request(users[input.role || 'Operator'], {
      trolley,
      destination: sampleId(destination),
      source: current.location,
      version: current.version,
      key: `sample:${trolley}:${destination}:${input.step || 'assignment'}`,
      product: product ? sampleId(product[0]) : null,
      batch: product ? product[4] : '',
      qty: product ? 25 + (index % 50) : 0,
      expected: Date.now() + (destination === 'OUT-01' ? 1440 : 120) * 60000,
      movement_type: input.type || 'Transfer',
      in_transit: input.inTransit ?? false,
      remarks: 'Sample plant assignment for the isolated development demo.',
      reason: 'Sample workflow',
      department: current.department,
      ...input.metadata,
    });
  };
  for (const [id, , group, department, , , quantity] of locations) {
    const pool = products.filter((product) => productGroups[product[2]].includes(group));
    for (let position = 0; position < quantity; position++) {
      index += 1;
      const product =
        group === 'Store' || group === 'Maintenance' ? null : pool[position % pool.length];
      const type = product
        ? index % 10 === 0
          ? 'Rework Trolley'
          : categoryTypes[product[2]]
        : Object.keys(trolleyTypes)[index % 5];
      const info = trolleyTypes[type];
      const source = id === 'STORE-01' ? id : id === 'OUT-01' ? 'DISPATCH-01' : 'STORE-01';
      const trolley = trolleyId(index);
      masters.create(admin, 'trolleys', {
        id: trolley,
        type,
        capacity: info.capacity,
        unit: product?.[3] || (type === 'Material Trolley' ? 'kg' : 'pcs'),
        location: sampleId(source),
        assigned_area: sampleId(id),
        material_type: info.material,
        department,
        qr_value: trolley,
        rfid: sampleId(`RFID-${String(index).padStart(4, '0')}`),
        tag_condition: index === 116 ? 'Damaged' : 'Good',
      });
      if (id === 'STORE-01') continue;
      const role =
        group === 'Quality' ? 'Quality User' : group === 'Production' ? 'Store User' : 'Operator';
      const typeName =
        {
          Production: 'Production Issue',
          Quality: 'Quality Inspection',
          Packing: 'Packing',
          Dispatch: 'Dispatch',
          Maintenance: 'Maintenance',
          'Outside Plant': 'Outside Plant',
        }[group] || 'Transfer';
      let revision;
      if (index === 119 || index === 120) {
        const previous = transfer(trolley, id, product, {
          type: typeName,
          step: 'review',
          inTransit: false,
        });
        movements.transition(users.Supervisor, previous.id, index === 119 ? 'reject' : 'correct', {
          reason: 'Sample review: confirm the supplier handoff details before submitting again.',
        });
        if (index === 120) revision = previous.id;
      }
      const movement = transfer(trolley, id, product, {
        role,
        type: typeName,
        inTransit: index % 13 === 0,
        ...(revision ? { metadata: { revision_of: revision } } : {}),
      });
      if (movement.state === 'Pending' && index < 127)
        movements.transition(users.Supervisor, movement.id, 'approve', {
          reason: 'Sample supplier handoff approved for this development demonstration.',
        });
    }
  }
  const roundTrip = trolleyId(1);
  transfer(roundTrip, 'PROD-L01', products[1], {
    role: 'Store User',
    type: 'Production Issue',
    step: 'round-trip-issue',
  });
  transfer(roundTrip, 'STORE-01', null, {
    role: 'Store User',
    type: 'Production Return',
    step: 'round-trip-return',
  });
  const verificationTrolleys = repository.all(
    "SELECT id, product FROM trolleys WHERE status = 'Waiting' ORDER BY id LIMIT 3",
  );
  for (const [position, trolley] of verificationTrolleys.entries()) {
    const wrongProduct = products.find(
      (product) => sampleId(product[0]) !== trolley.product && product[3] === 'pcs',
    );
    const verification = operations.verify(users['Quality User'], {
      trolley: trolley.id,
      product: sampleId(wrongProduct[0]),
      remarks: 'Sample scanned label mismatch for supervisor review.',
    });
    const approval = operations.requestApproval(users['Quality User'], {
      verification: verification.id,
      reason: 'Sample quality review of a scanned product label mismatch.',
    });
    if (position > 0)
      operations.decide(users.Supervisor, approval.id, {
        decision: position === 1 ? 'Approved' : 'Correction Required',
        remarks:
          position === 1
            ? 'Sample label review approved by the supervisor.'
            : 'Sample correction: scan the assigned product label again.',
      });
  }
  const incident = operations.report(users.Operator, {
    trolley: trolleyId(2),
    type: 'Trolley missing',
    priority: 'High',
    message: 'Sample missing-trolley report: confirm the assigned store bay.',
  });
  operations.updateAlert(users.Supervisor, incident.id, {
    status: 'Acknowledged',
    remarks: 'Sample store search assigned to the next shift.',
  });
  const maintenance = operations.report(users.Operator, {
    trolley: trolleyId(116),
    type: 'Trolley maintenance due',
    priority: 'Medium',
    message: 'Sample damaged QR label requires inspection and replacement.',
  });
  operations.updateAlert(users.Supervisor, maintenance.id, {
    status: 'Resolved',
    remarks:
      'Sample maintenance review completed; tag condition remains visible in the master record.',
  });
  operations.report(users.Operator, {
    trolley: trolleyId(119),
    type: 'Outside plant',
    priority: 'Low',
    message: 'Sample supplier handoff recorded; follow up before the actual return deadline.',
  });
  operations.notify(users.Supervisor, {
    userId: users.Operator.id,
    title: 'Sample shift handover',
    message: 'Review the sample pending outside-plant requests and quality exceptions.',
    kind: 'info',
    entity: 'DEMO-PLANT',
  });
  return {
    seeded: true,
    trolleys: 128,
    locations: locations.length,
    products: products.length,
    users: 6,
  };
}

function acquireLock(filename) {
  mkdirSync(dirname(filename), { recursive: true });
  if (existsSync(filename)) {
    const pid = Number(readFileSync(filename, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1)
      throw new Error(
        'Demo lock is invalid. Confirm no demo is running before removing data/demo.lock.',
      );
    try {
      process.kill(pid, 0);
      throw new Error(
        'The isolated demo is already running. Stop it before starting or resetting it.',
      );
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
      unlinkSync(filename);
    }
  }
  const descriptor = openSync(filename, 'wx', 0o600);
  writeFileSync(descriptor, String(process.pid));
  return () => {
    closeSync(descriptor);
    unlinkSync(filename);
  };
}

function archiveDemo(filename) {
  if (!existsSync(filename)) return null;
  const destination = join(
    dirname(filename),
    'demo-backups',
    new Date().toISOString().replaceAll(':', '-'),
  );
  mkdirSync(destination, { recursive: true });
  for (const suffix of ['', '-wal', '-shm'])
    if (existsSync(filename + suffix))
      renameSync(filename + suffix, join(destination, 'demo.sqlite' + suffix));
  return destination;
}

export function prepareDemoDatabase(directory, { reset = false } = {}) {
  const filename = join(directory, 'demo.sqlite');
  const normal = join(directory, 'trolley.sqlite');
  if (
    existsSync(filename) &&
    (lstatSync(filename).isSymbolicLink() ||
      (existsSync(normal) &&
        statSync(filename).ino === statSync(normal).ino &&
        statSync(filename).dev === statSync(normal).dev))
  )
    throw new Error(
      'The demo database must be a separate file from the normal application database.',
    );
  const release = acquireLock(join(directory, 'demo.lock'));
  try {
    return { filename, release, archived: reset ? archiveDemo(filename) : null };
  } catch (error) {
    release();
    throw error;
  }
}

export function startDemo({
  password = process.env.ADMIN_PASSWORD,
  port = Number(process.env.DEMO_PORT || 8081),
  reset = process.env.DEMO_RESET === '1',
} = {}) {
  requirePassword(password);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error('DEMO_PORT must be a port from 1 to 65535.');
  const { filename, release, archived } = prepareDemoDatabase(join(projectRoot, 'data'), { reset });
  let app;
  try {
    app = createApp({ dbPath: filename, adminPassword: password, secureCookie: false });
    const result = seedDemo(app.repository, password);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      app.server.close(() => {
        app.repository.close();
        release();
      });
      setTimeout(() => app.server.closeAllConnections(), 5000).unref();
    };
    app.server.once('error', (error) => {
      app.repository.close();
      release();
      console.error(JSON.stringify({ event: 'demo_failed', message: error.message }));
      process.exitCode = 1;
    });
    app.server.listen(port, '127.0.0.1', () =>
      console.log(
        JSON.stringify({
          event: 'demo_started',
          url: `http://127.0.0.1:${port}`,
          database: 'data/demo.sqlite',
          ...result,
          ...(archived ? { archived } : {}),
        }),
      ),
    );
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, close);
    return { ...app, result, close };
  } catch (error) {
    app?.repository.close();
    release();
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    startDemo();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
