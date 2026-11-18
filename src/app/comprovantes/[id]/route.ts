import fs from "node:fs/promises";
import path from "node:path";
import { exigirContexto } from "@/lib/auth";
import { getDb, UPLOADS_DIR } from "@/lib/db";
import { tipoDoComprovante } from "@/lib/form";
import { obterLancamento } from "@/lib/lancamentos";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await exigirContexto();
  const l = obterLancamento(getDb(), Number((await params).id));
  if (!l || !ctx.ids.includes(l.unidade_id) || !l.comprovante_arquivo || l.comprovante_arquivo.includes("/")) {
    return new Response("Não encontrado", { status: 404 });
  }
  try {
    const dados = await fs.readFile(path.join(UPLOADS_DIR, l.comprovante_arquivo));
    const nome = (l.comprovante_nome ?? l.comprovante_arquivo).replace(/["\r\n]/g, "");
    return new Response(dados, {
      headers: {
        "Content-Type": tipoDoComprovante(l.comprovante_arquivo),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(nome)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Arquivo não encontrado no servidor", { status: 404 });
  }
}
