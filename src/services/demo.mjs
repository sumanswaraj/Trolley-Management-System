import { fail } from '../errors.mjs';
import { requireRole } from '../security.mjs';

const marker = 'demo-reference-v1';
const departments = {
  Store: 'Stores',
  Production: 'Production',
  Assembly: 'Assembly',
  Quality: 'Quality',
  Packing: 'Packing',
  'Finished Goods': 'Stores',
  Dispatch: 'Dispatch',
  Maintenance: 'Maintenance',
  'Outside Plant': 'Logistics',
};
const returnMinutes = {
  Store: 480,
  Production: 240,
  Assembly: 180,
  Quality: 90,
  Packing: 120,
  'Finished Goods': 480,
  Dispatch: 60,
  Maintenance: 480,
  'Outside Plant': 1440,
};
const locations = [
  ['STORE-01', 'Main Store', 'Store', 40],
  ['PROD-L01', 'Production Line 01', 'Production', 20],
  ['PROD-L02', 'Production Line 02', 'Production', 20],
  ['PROD-L03', 'Production Line 03', 'Production', 20],
  ['ASSY-01', 'Assembly', 'Assembly', 14],
  ['QUALITY-01', 'Quality Inspection', 'Quality', 14],
  ['PACK-01', 'Packing', 'Packing', 14],
  ['FG-01', 'Finished Goods', 'Finished Goods', 16],
  ['DISPATCH-01', 'Dispatch', 'Dispatch', 12],
  ['MAINT-01', 'Maintenance', 'Maintenance', 8],
  ['OUT-01', 'Outside Plant', 'Outside Plant', 24],
];
const allowed = {
  Raw: ['Store', 'Production', 'Outside Plant'],
  Component: ['Store', 'Production', 'Assembly', 'Quality', 'Outside Plant'],
  WIP: ['Production', 'Assembly', 'Quality', 'Store', 'Outside Plant'],
  Finished: ['Quality', 'Packing', 'Finished Goods', 'Dispatch', 'Outside Plant'],
};
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
const types = {
  Raw: ['Material Trolley', 500, 'Raw Material'],
  Component: ['Component Trolley', 350, 'Component'],
  WIP: ['WIP Trolley', 400, 'WIP'],
  Finished: ['Finished Goods', 600, 'Finished Goods'],
};
const pools = {
  Store: ['RAW-S01', 'CMP-A01', 'CMP-B02', 'CMP-F05'],
  Production: ['CMP-A01', 'CMP-B02', 'WIP-G12', 'ASM-A10', 'ASM-B20', 'RAW-S01'],
  Assembly: ['CMP-A01', 'CMP-F05', 'ASM-A10', 'ASM-C30', 'WIP-G12'],
  Quality: ['ASM-A10', 'ASM-B20', 'ASM-C30', 'FIN-A40', 'FIN-B50'],
  Packing: ['FIN-A40', 'FIN-B50'],
  Dispatch: ['FIN-A40', 'FIN-B50'],
  'Outside Plant': ['ASM-C30', 'CMP-A01', 'WIP-G12'],
};
const plan = [
  [28, 'STORE-01', 'Available'],
  [12, 'PROD-L01', 'In Use'],
  [15, 'PROD-L02', 'In Use'],
  [10, 'PROD-L03', 'In Use'],
  [8, 'ASSY-01', 'In Use'],
  [3, 'QUALITY-01', 'In Use'],
  [7, 'QUALITY-01', 'Waiting'],
  [4, 'PACK-01', 'In Use'],
  [2, 'PACK-01', 'Waiting'],
  [5, 'PACK-01', 'Available'],
  [11, 'FG-01', 'Available'],
  [7, 'DISPATCH-01', 'In Use'],
  [3, 'DISPATCH-01', 'Available'],
  [3, 'MAINT-01', 'Maintenance'],
  [10, 'OUT-01', 'Outside Plant'],
];
const sampleIds = Array.from(
  { length: 128 },
  (_, index) => `TR-${String(index + 1).padStart(3, '0')}`,
);
const placeholders = sampleIds.map(() => '?').join(',');

function samples(now, actor) {
  const results = [];
  for (const [count, locationId, status] of plan) {
    const [, , group] = locations.find(([id]) => id === locationId);
    for (let index = 0; index < count; index++) {
      const number = results.length + 1;
      const loaded = !['Available', 'Maintenance'].includes(status);
      const pool = pools[group] || pools.Production;
      const product = loaded
        ? products.find(([id]) => id === pool[(number - 1) % pool.length])
        : null;
      const category = product?.[2] || (number % 3 ? 'Component' : 'Raw');
      const [type, capacity, material] =
        !loaded && number % 13 === 0 ? ['Rework Trolley', 300, 'Rework'] : types[category];
      results.push({
        id: sampleIds[number - 1],
        type,
        capacity,
        material_type: material,
        unit: product?.[3] || (category === 'Raw' ? 'kg' : 'pcs'),
        department: departments[group],
        assigned_area: locationId,
        qr: `QR-${sampleIds[number - 1]}`,
        rfid: `RFID-${(0x5a10c000 + number * 7919).toString(16).toUpperCase()}`,
        location: locationId,
        previous_location: locationId,
        status,
        product: product?.[0] || null,
        batch: product?.[4] || '',
        qty: loaded ? 20 + ((number * 17) % 280) : 0,
        created: now,
        last_moved: now,
        since: now,
        expected: loaded ? now + returnMinutes[group] * 60000 : null,
        operator_id: actor,
        active: 1,
        uses: 0,
        flags: '[]',
        tag_health:
          number % 37 === 0 ? 'RFID signal weak' : number % 53 === 0 ? 'QR unreadable' : 'Good',
        maintenance_due: status === 'Maintenance' ? now + 86400000 : null,
      });
    }
  }
  return results;
}

export function demoService(repository) {
  const populate = (user, reset) => {
    const now = Date.now();
    for (const [id, name, group, capacity] of locations) {
      repository.run(
        `INSERT INTO locations(id,name,external,group_name,capacity,department,expected_minutes) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,external=excluded.external,group_name=excluded.group_name,capacity=excluded.capacity,department=excluded.department,expected_minutes=excluded.expected_minutes`,
        id,
        name,
        Number(group === 'Outside Plant'),
        group,
        capacity,
        departments[group],
        returnMinutes[group],
      );
    }
    for (const [id, name, category, unit, batch] of products) {
      repository.run(
        `INSERT INTO products(id,name,category,unit,default_batch,allowed_groups) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,unit=excluded.unit,default_batch=excluded.default_batch,allowed_groups=excluded.allowed_groups`,
        id,
        name,
        category,
        unit,
        batch,
        JSON.stringify(allowed[category]),
      );
    }
    for (const [category, [type]] of Object.entries(types)) {
      const accepted =
        type === 'Material Trolley' || type === 'Component Trolley'
          ? ['Raw', 'Component']
          : type === 'WIP Trolley'
            ? ['WIP', 'Component']
            : ['Finished', 'WIP'];
      for (const allowedCategory of accepted)
        repository.run(
          'INSERT INTO trolley_categories(trolley_type,category) VALUES (?,?) ON CONFLICT DO NOTHING',
          type,
          allowedCategory,
        );
    }
    for (const category of ['Raw', 'Component', 'WIP', 'Finished'])
      repository.run(
        "INSERT INTO trolley_categories(trolley_type,category) VALUES ('Rework Trolley',?) ON CONFLICT DO NOTHING",
        category,
      );
    for (const [source] of locations) {
      for (const [destination, , group] of locations) {
        if (source === destination) continue;
        for (const category of [
          'Empty',
          ...Object.keys(allowed).filter((key) => allowed[key].includes(group)),
        ])
          repository.run(
            'INSERT INTO allowed_routes(source,destination,category,requires_quality) VALUES (?,?,?,?) ON CONFLICT DO NOTHING',
            source,
            destination,
            category,
            Number(source === 'QUALITY-01' && destination === 'PACK-01' && category !== 'Empty'),
          );
      }
    }
    for (const sample of samples(now, user.id)) {
      const existing = repository.get('SELECT * FROM trolleys WHERE id = ?', sample.id);
      if (existing) {
        const { id, qr, rfid, created, uses, ...values } = sample;
        repository.run(
          `UPDATE trolleys SET ${Object.keys(values)
            .map((key) => `${key}=?`)
            .join(',')},version=version+1 WHERE id=?`,
          ...Object.values(values),
          id,
        );
        repository.audit(user, 'Demo trolley restored', id, {
          previous: {
            location: existing.location,
            status: existing.status,
            product: existing.product,
            batch: existing.batch,
            qty: existing.qty,
          },
          current: {
            location: sample.location,
            status: sample.status,
            product: sample.product,
            batch: sample.batch,
            qty: sample.qty,
          },
        });
      } else {
        repository.run(
          `INSERT INTO trolleys(${Object.keys(sample).join(',')}) VALUES (${Object.keys(sample)
            .map(() => '?')
            .join(',')})`,
          ...Object.values(sample),
        );
        for (const tag of [sample.qr, sample.rfid])
          repository.run('INSERT INTO trolley_tags(tag,trolley) VALUES (?,?)', tag, sample.id);
      }
    }
    repository.audit(user, reset ? 'Demo restored' : 'Demo loaded', marker, {
      trolleys: sampleIds.length,
      locations: locations.length,
      products: products.length,
      history_preserved: true,
      snapshot_at: now,
    });
    return {
      trolleys: sampleIds.length,
      locations: locations.length,
      products: products.length,
      history_preserved: true,
    };
  };
  return {
    load(user) {
      requireRole(user, ['Admin']);
      return repository.transaction(() => {
        const occupied = ['locations', 'products', 'trolleys', 'movements'].some((table) =>
          repository.get(`SELECT 1 FROM ${table} LIMIT 1`),
        );
        if (occupied) fail(409, 'Load the sample plant only into an empty operational database');
        return populate(user, false);
      });
    },
    reset(user, input = {}) {
      requireRole(user, ['Admin']);
      if (input.confirm !== 'RESET DEMO DATA')
        fail(400, 'Confirm with RESET DEMO DATA; recorded history is preserved');
      return repository.transaction(() => {
        if (
          !repository.get(
            "SELECT id FROM audit WHERE entity = ? AND action = 'Demo loaded' LIMIT 1",
            marker,
          )
        )
          fail(409, 'This database was not created with the reference sample plant');
        if (
          repository.get(
            `SELECT id FROM movements WHERE trolley IN (${placeholders}) AND state IN ('Pending','In Transit') LIMIT 1`,
            ...sampleIds,
          ) ||
          repository.get(
            `SELECT id FROM approval_requests WHERE trolley IN (${placeholders}) AND status IN ('Pending','Correction Requested') LIMIT 1`,
            ...sampleIds,
          )
        )
          fail(
            409,
            'Finish or reject pending sample requests and receive sample trolleys before restoring demo data',
          );
        const locationIds = locations.map(([id]) => id);
        const productIds = products.map(([id]) => id);
        if (
          repository.get(
            `SELECT id FROM movements WHERE (source IN (${locationIds.map(() => '?').join(',')}) OR destination IN (${locationIds.map(() => '?').join(',')})) AND trolley NOT IN (${placeholders}) AND state IN ('Pending','In Transit') LIMIT 1`,
            ...locationIds,
            ...locationIds,
            ...sampleIds,
          ) ||
          repository.get(
            `SELECT id FROM trolleys WHERE id NOT IN (${placeholders}) AND qty > 0 AND product IN (${productIds.map(() => '?').join(',')}) LIMIT 1`,
            ...sampleIds,
            ...productIds,
          )
        )
          fail(
            409,
            'Sample master records are in use by other trolleys; finish those operations before restoring demo data',
          );
        return populate(user, true);
      });
    },
  };
}
