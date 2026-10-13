import { env } from "cloudflare:workers";
import { handleDemoApi } from "../../../hosted/api.ts";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  if (!env.DB)
    return Response.json(
      { error: "The demo database is not connected" },
      { status: 503 },
    );
  return handleDemoApi(request, env.DB, (env as any).DEMO_VERIFICATION_KEY);
}
export const GET = handle;
export const POST = handle;
