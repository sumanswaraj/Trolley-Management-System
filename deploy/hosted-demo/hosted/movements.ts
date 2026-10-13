import type { Repository } from "./database.ts";
import {
  fail,
  text,
  number,
  permit,
  locationPermission,
  evaluate,
} from "./policy.ts";

export async function requestMovement(repo: Repository, user: any, input: any) {
  const trolley = text(input.trolley, "trolley"),
    destination = text(input.destination, "destination");
  const key = text(input.key, "request key", 100),
    qty = number(input.qty, "quantity");
  const version = number(input.version, "version", 1),
    expected = number(input.expected, "expected time", 1);
  if (!Number.isSafeInteger(version) || !Number.isSafeInteger(expected))
    fail(400, "Invalid version or expected time");
  const product = input.product ? text(input.product, "product") : null;
  const batch = typeof input.batch === "string" ? input.batch.trim() : "";
  const reason =
    typeof input.exceptionReason === "string"
      ? input.exceptionReason.trim()
      : "";
  if (
    batch.length > 120 ||
    reason.length > 500 ||
    (qty > 0 && (!product || !batch)) ||
    (qty === 0 && product)
  )
    fail(400, "Invalid load declaration");
  const payload = JSON.stringify({
    trolley,
    destination,
    key,
    qty,
    version,
    expected,
    product,
    batch,
    reason,
    user: user.id,
  });
  const existing = await repo.get("SELECT * FROM movements WHERE key=?", key);
  if (existing) {
    if (existing.payload !== payload) fail(409, "Request key already used");
    return existing;
  }
  const current = await repo.get(
    "SELECT * FROM trolleys WHERE id=? AND active=1",
    trolley,
  );
  const location = await repo.get(
    "SELECT * FROM locations WHERE id=?",
    destination,
  );
  if (!current || !location) fail(400, "Unknown trolley or destination");
  await locationPermission(repo, user, current.location, "depart");
  if (current.version !== version)
    fail(409, "Trolley changed. Refresh and retry");
  if (
    expected <= Date.now() ||
    current.location === destination ||
    qty > current.capacity
  )
    fail(400, "Check expected time, destination and capacity");
  const productRecord = product
    ? await repo.get("SELECT * FROM products WHERE id=?", product)
    : null;
  if (product && !productRecord) fail(400, "Unknown product");
  const policy = await evaluate(
    repo,
    current,
    destination,
    productRecord,
    qty,
    batch,
  );
  if (policy.flags.length && reason.length < 10)
    fail(
      400,
      `Policy mismatch: ${policy.flags.join("; ")}. Add an exception reason of at least 10 characters`,
    );
  const state =
    location.external || policy.flags.length || policy.quality
      ? "Pending"
      : "In Transit";
  const guard = repo.guard(
    "EXISTS(SELECT 1 FROM trolleys WHERE id=? AND version=? AND active=1) AND NOT EXISTS(SELECT 1 FROM movements WHERE trolley=? AND state IN ('Pending','In Transit'))",
    trolley,
    version,
    trolley,
  );
  const statements = [
    guard.statement,
    repo.statement(
      `INSERT INTO movements(trolley,source,destination,product,batch,qty,state,requested_by,created,expected,key,payload,version,policy_flags,exception_reason,requires_quality)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      trolley,
      current.location,
      destination,
      product,
      batch,
      qty,
      state,
      user.id,
      Date.now(),
      expected,
      key,
      payload,
      version,
      JSON.stringify(policy.flags),
      reason,
      Number(policy.quality),
    ),
  ];
  if (state === "In Transit")
    statements.push(
      repo.statement(
        "UPDATE trolleys SET status='In Transit',product=?,batch=?,qty=?,version=version+1 WHERE id=?",
        product,
        batch,
        qty,
        trolley,
      ),
    );
  statements.push(
    repo.audit(user, "Movement requested", trolley, { destination, state }),
    guard.cleanup,
  );
  try {
    await repo.batch(statements);
  } catch (error) {
    const retry = await repo.get("SELECT * FROM movements WHERE key=?", key);
    if (retry && retry.payload === payload) return retry;
    fail(409, "Trolley has an open movement or changed. Refresh and retry");
  }
  return repo.get("SELECT * FROM movements WHERE key=?", key);
}
export async function transition(
  repo: Repository,
  user: any,
  id: number,
  action: string,
  input: any,
) {
  const movement = await repo.get("SELECT * FROM movements WHERE id=?", id);
  if (!movement) fail(404, "Movement not found");
  await locationPermission(repo, user, movement.destination, "receive");
  const flags = JSON.parse(movement.policy_flags);
  const destination = await repo.get(
    "SELECT * FROM locations WHERE id=?",
    movement.destination,
  );
  let guard, statements;
  if (action === "receive") {
    if (movement.state !== "In Transit")
      fail(409, "Only an in-transit movement can be received");
    guard = repo.guard(
      "EXISTS(SELECT 1 FROM movements WHERE id=? AND state='In Transit') AND EXISTS(SELECT 1 FROM trolleys WHERE id=? AND version=?)",
      id,
      movement.trolley,
      movement.version + 1,
    );
    statements = [
      guard.statement,
      repo.statement(
        "UPDATE movements SET state='Received',received=?,received_by=? WHERE id=?",
        Date.now(),
        user.id,
        id,
      ),
      repo.statement(
        "UPDATE trolleys SET location=?,status=?,version=version+1 WHERE id=?",
        movement.destination,
        destination.external
          ? "Outside Plant"
          : movement.qty > 0
            ? "In Use"
            : "Available",
        movement.trolley,
      ),
    ];
  } else {
    permit(
      user,
      movement.requires_quality
        ? flags.length || destination.external
          ? ["Admin"]
          : ["Admin", "Quality User"]
        : ["Admin", "Supervisor"],
    );
    if (movement.requested_by === user.id)
      fail(403, "Use a different demo role to review your request");
    if (movement.state !== "Pending") fail(409, "Request already decided");
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (
      reason.length > 500 ||
      (action === "approve" && flags.length && reason.length < 10)
    )
      fail(400, "An exception approval needs a reason of 10 to 500 characters");
    guard = repo.guard(
      "EXISTS(SELECT 1 FROM movements WHERE id=? AND state='Pending') AND EXISTS(SELECT 1 FROM trolleys WHERE id=? AND version=?)",
      id,
      movement.trolley,
      movement.version,
    );
    statements = [
      guard.statement,
      repo.statement(
        "UPDATE movements SET state=?,approved_by=?,decision_reason=? WHERE id=?",
        action === "approve" ? "In Transit" : "Rejected",
        user.id,
        reason,
        id,
      ),
    ];
    if (action === "approve")
      statements.push(
        repo.statement(
          "UPDATE trolleys SET status='In Transit',product=?,batch=?,qty=?,version=version+1 WHERE id=?",
          movement.product,
          movement.batch,
          movement.qty,
          movement.trolley,
        ),
      );
  }
  statements.push(
    repo.audit(user, `Movement ${action}`, movement.trolley, { movement: id }),
    guard.cleanup,
  );
  try {
    await repo.batch(statements);
  } catch {
    fail(409, "Movement state changed. Refresh and retry");
  }
  return repo.get("SELECT * FROM movements WHERE id=?", id);
}
