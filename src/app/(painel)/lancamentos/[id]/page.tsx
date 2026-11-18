import Link from "next/link";
import { notFound } from "next/navigation";
import { acaoAnexarComprovante, acaoAtualizarLancamento, acaoDarBaixa, acaoExcluirLancamento, acaoReabrir } from "../../../acoes";
import { exigirContexto } from "@/lib/auth";
import { formatData, hoje as hojeSP } from "@/lib/datas";
import { getDb } from "@/lib/db";
import { FORMAS_PAGAMENTO, listarCategorias, obterLancamento } from "@/lib/lancamentos";
import { centavosParaInput, formatBRL } from "@/lib/money";
import { Mensagens, StatusTag, type SP } from "../../../ui";
import { CamposLancamento } from "../campos";

export default async function Detalhe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await exigirContexto();
  const id = Number((await params).id);
  const db = getDb();
  const l = Number.isInteger(id) ? obterLancamento(db, id) : undefined;
  if (!l || !ctx.ids.includes(l.unidade_id)) notFound();
  const hoje = hojeSP();
  const despesa = l.tipo === "despesa";
  const categorias = listarCategorias(db, l.tipo);
  const pago = l.status === "pago";
  const ed = ctx.podeEditar;

  return (
    <>
      <Mensagens sp={sp} />
      <div className="cabecalho">
        <div>
          <div className="muted small">
            <Link href={`/lancamentos?tipo=${l.tipo}&mes=${l.vencimento.slice(0, 7)}&unidade=${l.unidade_id}`}>← {despesa ? "Contas a pagar" : "Recebimentos"}</Link>
          </div>
          <h1>
            {l.descricao} <StatusTag l={l} hoje={hoje} />
          </h1>
          <div className="muted">
            {despesa ? "Despesa" : "Receita"} · {l.unidade_nome} · {formatBRL(l.valor_centavos)} · vence {formatData(l.vencimento)}
            {l.parcela ? ` · recorrente (${l.parcela}ª parcela)` : ""}
            {l.origem.startsWith("importacao") ? " · importado" : ""}
          </div>
        </div>
      </div>

      <div className="grade-2">
        <div className="card">
          <h2>{pago ? (despesa ? "Pagamento" : "Recebimento") : "Dar baixa"}</h2>
          {pago ? (
            <>
              <p>
                {despesa ? "Pago" : "Recebido"} em <strong>{formatData(l.data_pagamento)}</strong>, valor{" "}
                <strong>{formatBRL(l.valor_pago_centavos ?? l.valor_centavos)}</strong>
                {l.forma_pagamento ? ` · ${l.forma_pagamento}` : ""}
              </p>
              {ed && (
                <form action={acaoReabrir}>
                  <input type="hidden" name="id" value={l.id} />
                  <button type="submit">Desfazer baixa (voltar para em aberto)</button>
                </form>
              )}
            </>
          ) : ed ? (
            <form action={acaoDarBaixa} className="grid">
              <input type="hidden" name="id" value={l.id} />
              <label>
                Data do pagamento
                <input type="date" name="data_pagamento" required defaultValue={hoje} />
              </label>
              <label>
                Valor pago (R$)
                <input name="valor_pago" inputMode="decimal" defaultValue={centavosParaInput(l.valor_centavos)} />
              </label>
              <label>
                Forma de pagamento
                <select name="forma_pagamento" defaultValue={l.forma_pagamento ?? ""}>
                  <option value="">—</option>
                  {FORMAS_PAGAMENTO.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label>
                Comprovante (opcional)
                <input type="file" name="comprovante" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*" />
              </label>
              <div className="inteiro">
                <button className="primario" type="submit">
                  Confirmar {despesa ? "pagamento" : "recebimento"}
                </button>
              </div>
            </form>
          ) : (
            <p className="muted">Em aberto.</p>
          )}
        </div>

        <div className="card">
          <h2>Comprovante</h2>
          {l.comprovante_arquivo ? (
            <p>
              <a href={`/comprovantes/${l.id}`} target="_blank" rel="noopener">
                📎 {l.comprovante_nome ?? "abrir comprovante"}
              </a>
            </p>
          ) : (
            <p className="muted">Nenhum comprovante anexado.</p>
          )}
          {ed && (
            <form action={acaoAnexarComprovante} className="acoes">
              <input type="hidden" name="id" value={l.id} />
              <input type="file" name="comprovante" required accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*" />
              <button type="submit">{l.comprovante_arquivo ? "Substituir" : "Anexar"}</button>
            </form>
          )}
        </div>
      </div>

      {ed ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Editar</h2>
          <form action={acaoAtualizarLancamento} className="grid">
            <input type="hidden" name="id" value={l.id} />
            <CamposLancamento ctx={ctx} categorias={categorias} tipo={l.tipo} l={l} />
            {l.recorrencia_id && (
              <fieldset className="inteiro">
                <legend className="muted small">Aplicar a alteração em</legend>
                <label className="check">
                  <input type="radio" name="escopo" value="este" defaultChecked /> Só neste lançamento
                </label>
                <label className="check">
                  <input type="radio" name="escopo" value="futuros" /> Neste e nos próximos meses em aberto (o vencimento de cada um não muda)
                </label>
              </fieldset>
            )}
            <div className="inteiro">
              <button className="primario" type="submit">
                Salvar alterações
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <p>
            <strong>Fornecedor/cliente:</strong> {l.fornecedor ?? "—"} · <strong>Categoria:</strong> {l.categoria_nome ?? "—"}
          </p>
          {l.observacao && <p style={{ whiteSpace: "pre-wrap" }}>{l.observacao}</p>}
        </div>
      )}

      {ed && (
        <details className="card">
          <summary>Excluir lançamento</summary>
          <form action={acaoExcluirLancamento} className="acoes" style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={l.id} />
            {l.recorrencia_id && (
              <select name="escopo" defaultValue="este" aria-label="O que excluir">
                <option value="este">Só este</option>
                <option value="futuros">Este e os próximos em aberto</option>
              </select>
            )}
            <button className="perigo" type="submit">
              Excluir definitivamente
            </button>
          </form>
        </details>
      )}
    </>
  );
}
