import { getPosAdapter } from "@/integrations/pos/adapter";
import { ingestPosOrder } from "@/flows/pos-ingest";
import { findActiveApiKey, touchApiKey } from "@/modules/merchants/repo";
import { sha256 } from "@/server/crypto";
import { getNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { errorResponse } from "@/server/action";

export async function POST(request: Request) {
  try {
    const raw = request.headers
      .get("authorization")
      ?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!raw)
      return Response.json(
        { error: "Missing API key", code: "unauthorized" },
        { status: 401 },
      );
    const db = await getDb();
    const key = await findActiveApiKey(db, sha256(raw));
    if (!key || !key.scopes.includes("pos:write"))
      return Response.json(
        { error: "Invalid API key", code: "unauthorized" },
        { status: 401 },
      );
    const now = await getNow(db);
    const order = getPosAdapter(
      request.headers.get("x-pos-adapter"),
    ).toCanonical(await request.json());
    const result = await ingestPosOrder(
      db,
      { merchantId: key.merchantId, actor: { type: "api", id: key.id }, now },
      order,
    );
    await touchApiKey(db, key.id, now);
    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
