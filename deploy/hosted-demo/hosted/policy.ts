import type { Repository } from "./database.ts";
export function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
export function text(value: any, label: string, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(400, `Invalid ${label}`);
  return value.trim();
}
export function number(value: any, label: string, minimum = 0) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum)
    fail(400, `Invalid ${label}`);
  return value;
}
export function permit(user: any, roles: string[]) {
  if (!roles.includes(user.role))
    fail(403, "Your role cannot perform this action");
}
export async function locationPermission(
  repo: Repository,
  user: any,
  location: string,
  action: "depart" | "receive",
) {
  if (user.role === "Admin") return;
  const settings = await repo.get("SELECT * FROM plant_settings WHERE id=1");
  if (!settings.scope_operations) return;
  const scope = await repo.get(
    "SELECT * FROM user_locations WHERE user_id=? AND location=?",
    user.id,
    location,
  );
  if (!scope?.[action === "depart" ? "can_depart" : "can_receive"])
    fail(403, `Your account cannot ${action} here`);
}
export async function evaluate(
  repo: Repository,
  trolley: any,
  destination: string,
  product: any,
  qty: number,
  batch: string,
) {
  const settings = await repo.get("SELECT * FROM plant_settings WHERE id=1");
  const flags = [];
  if (qty > 0 && trolley.unit !== product.unit)
    fail(400, "Product and capacity units must match");
  if (
    qty > 0 &&
    settings.enforce_categories &&
    !(await repo.get(
      "SELECT category FROM trolley_categories WHERE trolley_type=? AND category=?",
      trolley.type,
      product.category,
    ))
  )
    flags.push("Product category is not approved for this trolley type");
  const route = await repo.get(
    "SELECT * FROM allowed_routes WHERE source=? AND destination=? AND category=?",
    trolley.location,
    destination,
    qty > 0 ? product.category : "Empty",
  );
  if (settings.enforce_routes && !route)
    flags.push("Route is not approved for this product category");
  if (
    qty > 0 &&
    trolley.qty > 0 &&
    (trolley.product !== product.id || trolley.batch !== batch)
  )
    flags.push("Declared product or batch differs from the current load");
  return { flags, quality: Boolean(route?.requires_quality) };
}
