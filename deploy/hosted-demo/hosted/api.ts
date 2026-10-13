import QRCode from "qrcode";
import { repository } from "./database.ts";
import { DEMO_ROLES, seedDemo } from "./seed.ts";
import { fail, text, number, permit } from "./policy.ts";
import { requestMovement, transition } from "./movements.ts";

function reply(data: any, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
async function listPage(repo: any, kind: string, params: URLSearchParams) {
  const limit = Number(params.get("limit") || 50),
    cursor = Number(params.get("before") || 0);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(cursor) ||
    cursor < 0
  )
    fail(400, "Invalid page parameters");
  const alias = kind === "audit" ? "a" : "m",
    timeColumn = kind === "audit" ? "ts" : "created";
  const conditions = [],
    values = [];
  if (cursor) {
    conditions.push(`${alias}.id<?`);
    values.push(cursor);
  }
  for (const [name, operator] of [
    ["from", ">="],
    ["to", "<="],
  ]) {
    if (params.has(name)) {
      const value = Number(params.get(name));
      if (!Number.isSafeInteger(value) || value < 1)
        fail(400, "Invalid time filter");
      conditions.push(`${alias}.${timeColumn}${operator}?`);
      values.push(value);
    }
  }
  if (params.has("trolley")) {
    conditions.push(`${alias}.${kind === "audit" ? "entity" : "trolley"}=?`);
    values.push(params.get("trolley"));
  }
  const select =
    kind === "audit"
      ? "SELECT a.*,u.name AS actor_name FROM audit a JOIN users u ON a.actor=u.id"
      : "SELECT m.*,u.name AS requester FROM movements m JOIN users u ON m.requested_by=u.id";
  const rows = await repo.all(
    `${select}${conditions.length ? " WHERE " + conditions.join(" AND ") : ""} ORDER BY ${alias}.id DESC LIMIT ?`,
    ...values,
    limit + 1,
  );
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items.at(-1).id : null };
}

/** Hosted identity is dispatch-owned. Demo role selection is explicitly a sandbox feature. */
export async function handleDemoApi(
  request: Request,
  db: D1Database,
  verificationKey?: string,
) {
  const requestId = crypto.randomUUID();
  try {
    const url = new URL(request.url),
      path = url.pathname;
    const identity = request.headers.get("oai-authenticated-user-id");
    const verifiedService = Boolean(
      verificationKey &&
      request.headers.get("x-demo-verification-key") === verificationKey,
    );
    if (!identity && !verifiedService)
      fail(401, "Sign in with ChatGPT to open this private demo");
    if (!["GET", "POST"].includes(request.method))
      fail(405, "Method not allowed");
    if (
      request.method === "POST" &&
      request.headers.get("origin") &&
      request.headers.get("origin") !== url.origin
    )
      fail(403, "Cross-origin request blocked");
    const repo = repository(db);
    await seedDemo(repo);
    let input: any = {};
    if (request.method === "POST") {
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        fail(415, "Use JSON");
      const body = await request.text();
      if (new TextEncoder().encode(body).length > 32768)
        fail(413, "Request too large");
      try {
        input = JSON.parse(body || "{}");
      } catch {
        fail(400, "Invalid JSON");
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        fail(400, "Invalid request");
    }
    let selectedRole = "Admin";
    try {
      selectedRole = decodeURIComponent(
        (request.headers.get("cookie") || "")
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("demo_role="))
          ?.slice(10) || "Admin",
      );
    } catch {}
    if (!DEMO_ROLES.includes(selectedRole)) selectedRole = "Admin";
    const user = await repo.get(
      "SELECT id,name,role,username FROM users WHERE role=? AND active=1 ORDER BY id LIMIT 1",
      selectedRole,
    );
    if (!user) fail(403, "Demo actor unavailable");
    const manager = ["Admin", "Supervisor"].includes(user.role);
    if (path === "/api/demo/role" && request.method === "POST") {
      if (!DEMO_ROLES.includes(input.role)) fail(400, "Unknown demo role");
      return reply({ ok: true }, 200, {
        "Set-Cookie": `demo_role=${encodeURIComponent(input.role)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`,
      });
    }
    if (path === "/api/health")
      return reply({ status: "ok", database: "connected" });
    const label = path.match(/^\/api\/trolleys\/([^/]+)\/label$/);
    if (label) {
      const id = decodeURIComponent(label[1]);
      if (!(await repo.get("SELECT id FROM trolleys WHERE id=?", id)))
        fail(404, "Trolley not found");
      const svg = await QRCode.toString(id, {
        type: "svg",
        width: 320,
        margin: 4,
        errorCorrectionLevel: "M",
      });
      return new Response(svg, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    }
    if (path === "/api/me") return reply(user);
    if (path === "/api/state")
      return reply({
        user,
        demoMode: true,
        locations: await repo.all("SELECT * FROM locations ORDER BY id"),
        products: await repo.all("SELECT * FROM products ORDER BY id"),
        trolleys: await repo.all("SELECT * FROM trolleys ORDER BY id"),
        activeMovements: await repo.all(
          "SELECT m.*,u.name AS requester FROM movements m JOIN users u ON m.requested_by=u.id WHERE state IN ('Pending','In Transit') ORDER BY m.id DESC",
        ),
        movements: (await listPage(repo, "movements", new URLSearchParams()))
          .items,
        audit: manager
          ? (await listPage(repo, "audit", new URLSearchParams())).items
          : [],
      });
    if (path === "/api/users" && request.method === "GET") {
      permit(user, ["Admin"]);
      return reply(await repo.all("SELECT * FROM users ORDER BY id"));
    }
    if (
      path.startsWith("/api/users") ||
      path === "/api/login" ||
      path === "/api/logout"
    )
      fail(
        403,
        "The private demo uses ChatGPT sign-in and sample roles. User administration belongs to the full installation.",
      );
    if (path === "/api/history")
      return reply(await listPage(repo, "movements", url.searchParams));
    if (path === "/api/audit") {
      permit(user, ["Admin", "Supervisor"]);
      return reply(await listPage(repo, "audit", url.searchParams));
    }
    if (path === "/api/reports/summary") {
      const from = Number(
          url.searchParams.get("from") || Date.now() - 30 * 86400000,
        ),
        to = Number(url.searchParams.get("to") || Date.now());
      if (
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        from < 1 ||
        from > to
      )
        fail(400, "Invalid report times");
      const totals = await repo.get(
        `SELECT COUNT(*) AS requested,SUM(CASE WHEN state='Received' THEN 1 ELSE 0 END) AS received,
        SUM(CASE WHEN state='Rejected' THEN 1 ELSE 0 END) AS rejected,AVG(CASE WHEN received IS NOT NULL THEN received-created END) AS mean_receipt_ms
        FROM movements WHERE created>=? AND created<=?`,
        from,
        to,
      );
      const daily = await repo.all(
        "SELECT date(created/1000,'unixepoch') AS day,COUNT(*) AS count FROM movements WHERE created>=? AND created<=? GROUP BY day ORDER BY day",
        from,
        to,
      );
      return reply({ from, to, totals, daily, timezone: "UTC" });
    }
    if (path === "/api/movements" && request.method === "POST")
      return reply(await requestMovement(repo, user, input), 201);
    const action = path.match(
      /^\/api\/movements\/(\d+)\/(approve|reject|receive)$/,
    );
    if (action && request.method === "POST")
      return reply(
        await transition(repo, user, Number(action[1]), action[2], input),
      );
    const master = path.match(/^\/api\/(locations|products|trolleys)$/);
    if (master && request.method === "POST") {
      permit(user, ["Admin", "Supervisor"]);
      const id = text(input.id, "ID", 40),
        kind = master[1];
      let statement;
      if (kind === "locations")
        statement = repo.statement(
          "INSERT INTO locations VALUES(?,?,?)",
          id,
          text(input.name, "name"),
          Number(input.external === true),
        );
      if (kind === "products")
        statement = repo.statement(
          "INSERT INTO products VALUES(?,?,?,?)",
          id,
          text(input.name, "name"),
          text(input.category || "Unspecified", "category"),
          text(input.unit || "pcs", "unit", 20),
        );
      if (kind === "trolleys") {
        const location = text(input.location, "location");
        if (!(await repo.get("SELECT id FROM locations WHERE id=?", location)))
          fail(400, "Unknown location");
        statement = repo.statement(
          "INSERT INTO trolleys(id,type,capacity,location,status,unit) VALUES(?,?,?,?,'Available',?)",
          id,
          text(input.type, "type"),
          number(input.capacity, "capacity", 1),
          location,
          text(input.unit || "pcs", "unit", 20),
        );
      }
      await repo.batch([
        statement!,
        repo.audit(user, "Master created", id, { kind }),
      ]);
      return reply({ ok: true }, 201);
    }
    if (path === "/api/policies" && request.method === "GET") {
      permit(user, ["Admin", "Supervisor"]);
      return reply({
        settings: await repo.get("SELECT * FROM plant_settings WHERE id=1"),
        categories: await repo.all("SELECT * FROM trolley_categories"),
        routes: await repo.all("SELECT * FROM allowed_routes"),
        scopes:
          user.role === "Admin"
            ? await repo.all("SELECT * FROM user_locations")
            : [],
      });
    }
    if (path === "/api/policies/settings" && request.method === "POST") {
      permit(user, ["Admin"]);
      for (const key of [
        "enforce_routes",
        "enforce_categories",
        "scope_operations",
      ])
        if (typeof input[key] !== "boolean")
          fail(400, "Provide enforcement booleans");
      await repo.batch([
        repo.statement(
          "UPDATE plant_settings SET enforce_routes=?,enforce_categories=?,scope_operations=? WHERE id=1",
          Number(input.enforce_routes),
          Number(input.enforce_categories),
          Number(input.scope_operations),
        ),
        repo.audit(user, "Plant policy updated", "plant", input),
      ]);
      return reply({ ok: true });
    }
    const policy = path.match(/^\/api\/policies\/(categories|routes|scopes)$/);
    if (policy && request.method === "POST") {
      permit(user, ["Admin", "Supervisor"]);
      let statement;
      if (policy[1] === "categories")
        statement = repo.statement(
          "INSERT OR IGNORE INTO trolley_categories VALUES(?,?)",
          text(input.trolley_type, "type"),
          text(input.category, "category"),
        );
      if (policy[1] === "routes") {
        const source = text(input.source, "source"),
          destination = text(input.destination, "destination");
        if (
          source === destination ||
          !(await repo.get("SELECT id FROM locations WHERE id=?", source)) ||
          !(await repo.get("SELECT id FROM locations WHERE id=?", destination))
        )
          fail(400, "Invalid route");
        statement = repo.statement(
          "INSERT INTO allowed_routes VALUES(?,?,?,?) ON CONFLICT(source,destination,category) DO UPDATE SET requires_quality=excluded.requires_quality",
          source,
          destination,
          text(input.category, "category"),
          Number(input.requires_quality === true),
        );
      }
      if (policy[1] === "scopes") {
        permit(user, ["Admin"]);
        const userId = number(input.user_id, "user ID", 1),
          location = text(input.location, "location");
        if (
          !(await repo.get("SELECT id FROM users WHERE id=?", userId)) ||
          !(await repo.get("SELECT id FROM locations WHERE id=?", location))
        )
          fail(400, "Unknown user or location");
        statement = repo.statement(
          "INSERT INTO user_locations VALUES(?,?,?,?) ON CONFLICT(user_id,location) DO UPDATE SET can_depart=excluded.can_depart,can_receive=excluded.can_receive",
          userId,
          location,
          Number(input.can_depart === true),
          Number(input.can_receive === true),
        );
      }
      await repo.batch([
        statement!,
        repo.audit(user, "Plant rule configured", policy[1], input),
      ]);
      return reply({ ok: true });
    }
    if (path === "/api/readers" && request.method === "GET") {
      permit(user, ["Admin"]);
      return reply({ configured: false, readers: [], tags: [], events: [] });
    }
    fail(404, "API route not found");
  } catch (error: any) {
    const status =
      error.status ||
      (/UNIQUE constraint|FOREIGN KEY|CHECK constraint/.test(error.message)
        ? 409
        : 500);
    return reply(
      {
        error:
          status === 500
            ? "Demo backend error"
            : error.status
              ? error.message
              : "Record already exists or state changed",
        requestId,
      },
      status,
    );
  }
}
