import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Verificação de saúde para o Docker / monitoramento. */
export function GET() {
  getDb().prepare("SELECT 1").get();
  return Response.json({ ok: true });
}
