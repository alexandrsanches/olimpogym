import { exigirContexto, unidadesSelecionadas } from "@/lib/auth";
import { hoje, isDataISO } from "@/lib/datas";
import { getDb, type Tipo } from "@/lib/db";
import { listarLancamentos } from "@/lib/lancamentos";
import { gerarCSV } from "@/lib/planilha";

export async function GET(req: Request) {
  const ctx = await exigirContexto();
  const q = new URL(req.url).searchParams;
  const { ids } = unidadesSelecionadas(ctx, q.get("unidade") ?? undefined);
  const tipo = q.get("tipo");
  const status = q.get("status");
  const inicio = q.get("inicio");
  const fim = q.get("fim");
  const lista = listarLancamentos(getDb(), {
    unidades: ids,
    tipo: tipo === "despesa" || tipo === "receita" ? (tipo as Tipo) : undefined,
    status: status === "aberto" || status === "pago" || status === "vencido" ? status : undefined,
    base: q.get("base") === "pagamento" ? "pagamento" : "vencimento",
    inicio: isDataISO(inicio) ? inicio : undefined,
    fim: isDataISO(fim) ? fim : undefined,
    categoriaId: Number(q.get("categoria")) || undefined,
    busca: q.get("busca")?.slice(0, 100) || undefined,
    hoje: hoje(),
  });
  const nome = `olimpogym-lancamentos-${inicio ?? "inicio"}-a-${fim ?? hoje()}.csv`;
  return new Response(gerarCSV(lista), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
