import type { Repository } from "./database.ts";
export const DEMO_ROLES = [
  "Admin",
  "Supervisor",
  "Operator",
  "Quality User",
  "Store User",
];

export async function seedDemo(repo: Repository) {
  if (await repo.get("SELECT id FROM demo_metadata WHERE id='seed-v1'")) return;
  const statements = DEMO_ROLES.map((role, index) =>
    repo.statement(
      "INSERT OR IGNORE INTO users(id,username,name,role,active) VALUES(?,?,?,?,1)",
      index + 1,
      `demo-${index + 1}`,
      `Demo ${role}`,
      role,
    ),
  );
  for (const [id, name, external] of [
    ["STORE", "Central store", 0],
    ["LINE-1", "Production line 1", 0],
    ["LINE-2", "Production line 2", 0],
    ["QUALITY", "Quality inspection", 0],
    ["PACK", "Packing", 0],
    ["OUTSIDE", "Supplier / outside plant", 1],
  ])
    statements.push(
      repo.statement(
        "INSERT OR IGNORE INTO locations VALUES(?,?,?)",
        id,
        name,
        external,
      ),
    );
  statements.push(
    repo.statement(
      "INSERT OR IGNORE INTO products VALUES('GEAR','Gear component','Component','pcs')",
    ),
  );
  statements.push(
    repo.statement(
      "INSERT OR IGNORE INTO products VALUES('VALVE','Valve body','Component','pcs')",
    ),
  );
  statements.push(
    repo.statement("INSERT OR IGNORE INTO plant_settings(id) VALUES(1)"),
  );
  statements.push(
    repo.statement(
      "INSERT OR IGNORE INTO trolley_categories VALUES('Component Trolley','Component')",
    ),
  );
  for (const destination of [
    "LINE-1",
    "LINE-2",
    "QUALITY",
    "PACK",
    "OUTSIDE",
  ]) {
    statements.push(
      repo.statement(
        "INSERT OR IGNORE INTO allowed_routes VALUES(?,?,?,?)",
        "STORE",
        destination,
        "Component",
        destination === "QUALITY" ? 1 : 0,
      ),
    );
  }
  for (let index = 1; index <= 24; index++) {
    const location =
      index <= 12
        ? "STORE"
        : index <= 18
          ? "LINE-1"
          : index <= 21
            ? "LINE-2"
            : "QUALITY";
    statements.push(
      repo.statement(
        `INSERT OR IGNORE INTO trolleys(id,type,capacity,location,status,product,batch,qty,unit,version,active)
      VALUES(?,?,?,?,?,NULL,'',0,'pcs',1,1)`,
        `TR-${String(index).padStart(3, "0")}`,
        "Component Trolley",
        100,
        location,
        "Available",
      ),
    );
  }
  statements.push(
    repo.statement(
      "INSERT OR IGNORE INTO demo_metadata VALUES('seed-v1','Sample plant masters; no synthetic movement history')",
    ),
  );
  await repo.batch(statements);
}
