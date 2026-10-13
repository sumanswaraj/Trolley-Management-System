import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/sqlite-core";

// This database is the private demo's sandbox. Native Site authentication controls entry.
export const users = sqliteTable("users", {
  id: integer("id").primaryKey(),
  username: text("username").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  active: integer("active").notNull().default(1),
});
export const locations = sqliteTable("locations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  external: integer("external").notNull().default(0),
});
export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
});
export const trolleys = sqliteTable("trolleys", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  capacity: real("capacity").notNull(),
  location: text("location")
    .notNull()
    .references(() => locations.id),
  status: text("status").notNull(),
  product: text("product").references(() => products.id),
  batch: text("batch").notNull().default(""),
  qty: real("qty").notNull().default(0),
  unit: text("unit").notNull(),
  version: integer("version").notNull().default(1),
  active: integer("active").notNull().default(1),
});
export const movements = sqliteTable(
  "movements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    trolley: text("trolley")
      .notNull()
      .references(() => trolleys.id),
    source: text("source").notNull(),
    destination: text("destination")
      .notNull()
      .references(() => locations.id),
    product: text("product").references(() => products.id),
    batch: text("batch").notNull(),
    qty: real("qty").notNull(),
    state: text("state").notNull(),
    requested_by: integer("requested_by")
      .notNull()
      .references(() => users.id),
    approved_by: integer("approved_by").references(() => users.id),
    received_by: integer("received_by").references(() => users.id),
    created: integer("created").notNull(),
    expected: integer("expected").notNull(),
    received: integer("received"),
    key: text("key").notNull().unique(),
    payload: text("payload").notNull(),
    version: integer("version").notNull(),
    policy_flags: text("policy_flags").notNull().default("[]"),
    exception_reason: text("exception_reason").notNull().default(""),
    requires_quality: integer("requires_quality").notNull().default(0),
    decision_reason: text("decision_reason").notNull().default(""),
  },
  (table) => [
    uniqueIndex("one_open_movement")
      .on(table.trolley)
      .where(sql`${table.state} IN ('Pending','In Transit')`),
  ],
);
export const audit = sqliteTable("audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actor: integer("actor")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  detail: text("detail").notNull(),
  ts: integer("ts").notNull(),
});
export const settings = sqliteTable("plant_settings", {
  id: integer("id").primaryKey(),
  enforce_routes: integer("enforce_routes").notNull().default(0),
  enforce_categories: integer("enforce_categories").notNull().default(0),
  scope_operations: integer("scope_operations").notNull().default(0),
});
export const categories = sqliteTable(
  "trolley_categories",
  {
    trolley_type: text("trolley_type").notNull(),
    category: text("category").notNull(),
  },
  (table) => [primaryKey({ columns: [table.trolley_type, table.category] })],
);
export const routes = sqliteTable(
  "allowed_routes",
  {
    source: text("source")
      .notNull()
      .references(() => locations.id),
    destination: text("destination")
      .notNull()
      .references(() => locations.id),
    category: text("category").notNull(),
    requires_quality: integer("requires_quality").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.destination, table.category] }),
  ],
);
export const scopes = sqliteTable(
  "user_locations",
  {
    user_id: integer("user_id")
      .notNull()
      .references(() => users.id),
    location: text("location")
      .notNull()
      .references(() => locations.id),
    can_depart: integer("can_depart").notNull().default(0),
    can_receive: integer("can_receive").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.user_id, table.location] })],
);
export const guards = sqliteTable(
  "command_guards",
  {
    id: text("id").primaryKey(),
    ok: integer("ok").notNull(),
  },
  (table) => [check("command_is_current", sql`${table.ok} = 1`)],
);
export const demoMetadata = sqliteTable("demo_metadata", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
});
