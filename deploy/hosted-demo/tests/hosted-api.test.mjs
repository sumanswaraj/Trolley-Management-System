import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handleDemoApi } from "../hosted/api.ts";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(
    readFileSync(
      new URL("../drizzle/0000_kind_thena.sql", import.meta.url),
      "utf8",
    ),
  );
  const prepare = (sql) => ({
    sql,
    values: [],
    bind(...values) {
      this.values = values;
      return this;
    },
    async first() {
      return sqlite.prepare(this.sql).get(...this.values) || null;
    },
    async all() {
      return { results: sqlite.prepare(this.sql).all(...this.values) };
    },
    async run() {
      const result = sqlite.prepare(this.sql).run(...this.values);
      return { meta: { changes: result.changes } };
    },
  });
  return {
    sqlite,
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
const request = (db, path, body, role = "Admin", authenticated = true) =>
  handleDemoApi(
    new Request("https://demo.test/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(authenticated ? { "oai-authenticated-user-id": "test-owner" } : {}),
        cookie: "demo_role=" + encodeURIComponent(role),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    db,
  );
const payload = (overrides = {}) => ({
  trolley: "TR-001",
  destination: "LINE-1",
  product: "GEAR",
  batch: "B-DEMO",
  qty: 20,
  version: 1,
  expected: Date.now() + 3600000,
  key: crypto.randomUUID(),
  ...overrides,
});

test("hosted demo rejects anonymous callers and shares database records across requests", async () => {
  const db = database();
  try {
    assert.equal(
      (await request(db, "state", undefined, "Admin", false)).status,
      401,
    );
    const state = await (await request(db, "state")).json();
    assert.equal(state.trolleys.length, 24);
    assert.equal(state.demoMode, true);
    const moved = await (
      await request(db, "movements", payload(), "Operator")
    ).json();
    assert.equal(moved.state, "In Transit");
    assert.equal(
      (await request(db, `movements/${moved.id}/receive`, {}, "Store User"))
        .status,
      200,
    );
    const persisted = await (await request(db, "state")).json();
    assert.equal(
      persisted.trolleys.find((t) => t.id === "TR-001").location,
      "LINE-1",
    );
    assert.equal(persisted.movements.length, 1);
    assert.throws(() => db.sqlite.exec("DELETE FROM audit"), /append-only/);
  } finally {
    db.sqlite.close();
  }
});

test("hosted batch guard blocks concurrent departures and matching retries deduplicate", async () => {
  const db = database();
  try {
    await request(db, "state");
    const body = payload();
    const results = await Promise.all([
      request(db, "movements", body, "Operator"),
      request(db, "movements", body, "Operator"),
    ]);
    assert.deepEqual(
      results.map((r) => r.status),
      [201, 201],
    );
    assert.equal(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM movements").get().n,
      1,
    );
    assert.equal(
      (await request(db, "movements", payload(), "Operator")).status,
      409,
    );
    assert.equal(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM command_guards").get().n,
      0,
    );
  } finally {
    db.sqlite.close();
  }
});

test("outside-plant demo requires independent role approval and confirms receipt separately", async () => {
  const db = database();
  try {
    const pending = await (
      await request(
        db,
        "movements",
        payload({ destination: "OUTSIDE" }),
        "Operator",
      )
    ).json();
    assert.equal(pending.state, "Pending");
    assert.equal(
      (await request(db, `movements/${pending.id}/approve`, {}, "Operator"))
        .status,
      403,
    );
    assert.equal(
      (await request(db, `movements/${pending.id}/approve`, {}, "Supervisor"))
        .status,
      200,
    );
    assert.equal(
      (await request(db, `movements/${pending.id}/receive`, {}, "Store User"))
        .status,
      200,
    );
    assert.equal(
      db.sqlite.prepare("SELECT status FROM trolleys WHERE id='TR-001'").get()
        .status,
      "Outside Plant",
    );
  } finally {
    db.sqlite.close();
  }
});
