import Link from "next/link";
import { acaoDarBaixa } from "../../acoes";
import { exigirContexto, unidadesSelecionadas } from "@/lib/auth";
import { formatData, hoje as hojeSP, intervaloDoMes, isDataISO, isMes, mesAnterior, mesSeguinte, nomeDoMes } from "@/lib/datas";
import { getDb, type Tipo } from "@/lib/db";
import { listarCategorias, listarLancamentos, type Filtros } from "@/lib/lancamentos";
import { formatBRL } from "@/lib/money";
import { Mensagens, param, SeletorUnidade, StatusTag, type SP } from "../../ui";

export default async function Lancamentos({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await exigirContexto();
  const { ids, atual } = unidadesSelecionadas(ctx, param(sp, "unidade"));
  const db = getDb();
  const hoje = hojeSP();

  const tipoP = param(sp, "tipo");
  const tipo: Tipo | undefined = tipoP === "despesa" || tipoP === "receita" ? tipoP : undefined;
  const statusP = param(sp, "status");
  const status = statusP === "aberto" || statusP === "pago" || statusP === "vencido" ? statusP : undefined;
  const base = param(sp, "base") === "pagamento" ? "pagamento" : "vencimento";
  const busca = param(sp, "busca")?.slice(0, 100) || undefined;
  const categoriaId = Number(param(sp, "categoria")) || undefined;

  // período: intervalo explícito, ou um mês (padrão: mês atual). Contas vencidas: sem limite de data.
  const iniP = param(sp, "inicio");
  const fimP = param(sp, "fim");
  const mesP = param(sp, "mes");
  let inicio: string | undefined;
  let fim: string | undefined;
  let mes: string | undefined;
  if (isDataISO(iniP) || isDataISO(fimP)) {
    inicio = isDataISO(iniP) ? iniP : undefined;
    fim = isDataISO(fimP) ? fimP : undefined;
  } else if (status !== "vencido") {
    mes = isMes(mesP) ? mesP : hoje.slice(0, 7);
    ({ inicio, fim } = intervaloDoMes(mes));
  }

  const filtros: Filtros = { unidades: ids, inicio, fim, base, tipo, status, categoriaId, busca, hoje };
  const lista = listarLancamentos(db, filtros);
  const categorias = listarCategorias(db, tipo);
  const unidadeQ = atual === "todas" ? "todas" : String(atual);

  const atuais: Record<string, string | undefined> = { tipo, status, base: base === "pagamento" ? base : undefined, busca, categoria: categoriaId ? String(categoriaId) : undefined, mes, inicio: mes ? undefined : inicio, fim: mes ? undefined : fim };
  const url = (mudar: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ unidade: unidadeQ, ...atuais, ...mudar })) if (v) q.set(k, v);
    return `/lancamentos?${q}`;
  };

  const total = (f: (l: (typeof lista)[number]) => boolean, valor: (l: (typeof lista)[number]) => number) => lista.filter(f).reduce((s, l) => s + valor(l), 0);
  const totRec = total((l) => l.tipo === "receita", (l) => l.valor_centavos);
  const totDesp = total((l) => l.tipo === "despesa", (l) => l.valor_centavos);
  const pagoRec = total((l) => l.tipo === "receita" && l.status === "pago", (l) => l.valor_pago_centavos ?? l.valor_centavos);
  const pagoDesp = total((l) => l.tipo === "despesa" && l.status === "pago", (l) => l.valor_pago_centavos ?? l.valor_centavos);

  const titulo = tipo === "despesa" ? "Contas a pagar" : tipo === "receita" ? "Recebimentos" : "Lançamentos";
  const periodo = status === "vencido" && !inicio && !fim ? "vencidos até hoje" : mes ? nomeDoMes(mes) : `${formatData(inicio)} a ${formatData(fim)}`;

  return (
    <>
      <Mensagens sp={sp} />
      <div className="cabecalho">
        <div>
          <h1>{titulo}</h1>
          <div className="muted">
            {periodo} · por {base === "pagamento" ? "data de pagamento (realizado)" : "vencimento (previsto)"}
          </div>
          {mes && (
            <div className="acoes small">
              <Link href={url({ mes: mesAnterior(mes) })}>← mês anterior</Link>
              <Link href={url({ mes: mesSeguinte(mes) })}>próximo mês →</Link>
            </div>
          )}
        </div>
        <div className="acoes">
          <SeletorUnidade ctx={ctx} atual={atual} base="/lancamentos" extra={atuais} />
        </div>
      </div>

      <div className="acoes" style={{ marginBottom: 12 }}>
        <nav className="abas">
          <Link href={url({ tipo: "despesa", categoria: undefined })} className={tipo === "despesa" ? "ativa" : ""}>Despesas</Link>
          <Link href={url({ tipo: "receita", categoria: undefined })} className={tipo === "receita" ? "ativa" : ""}>Receitas</Link>
          <Link href={url({ tipo: undefined, categoria: undefined })} className={!tipo ? "ativa" : ""}>Todos</Link>
        </nav>
        <nav className="abas">
          <Link href={url({ status: undefined })} className={!status ? "ativa" : ""}>Todos</Link>
          <Link href={url({ status: "aberto" })} className={status === "aberto" ? "ativa" : ""}>Em aberto</Link>
          <Link href={url({ status: "vencido", mes: undefined })} className={status === "vencido" ? "ativa" : ""}>Vencidos</Link>
          <Link href={url({ status: "pago" })} className={status === "pago" ? "ativa" : ""}>{tipo === "receita" ? "Recebidos" : "Pagos"}</Link>
        </nav>
        <nav className="abas">
          <Link href={url({ base: undefined })} className={base === "vencimento" ? "ativa" : ""}>Previsto</Link>
          <Link href={url({ base: "pagamento" })} className={base === "pagamento" ? "ativa" : ""}>Realizado</Link>
        </nav>
      </div>

      <form className="filtros" method="get">
        <input type="hidden" name="unidade" value={unidadeQ} />
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        {status && <input type="hidden" name="status" value={status} />}
        {base === "pagamento" && <input type="hidden" name="base" value="pagamento" />}
        <label>
          De
          <input type="date" name="inicio" defaultValue={inicio} />
        </label>
        <label>
          Até
          <input type="date" name="fim" defaultValue={fim} />
        </label>
        <label>
          Categoria
          <select name="categoria" defaultValue={categoriaId ?? ""}>
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
                {!tipo ? ` (${c.tipo})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Buscar
          <input type="search" name="busca" defaultValue={busca} placeholder="descrição, fornecedor…" />
        </label>
        <button type="submit">Filtrar</button>
        <a className="botao" href={`/exportar?${new URLSearchParams(Object.entries({ unidade: unidadeQ, tipo, status, base, busca, categoria: categoriaId ? String(categoriaId) : undefined, inicio, fim }).filter((e): e is [string, string] => !!e[1]))}`}>
          Exportar planilha
        </a>
        {ctx.podeEditar && (
          <Link className="botao primario" href={`/lancamentos/novo?tipo=${tipo ?? "despesa"}${atual !== "todas" ? `&unidade=${atual}` : ""}`}>
            + Novo
          </Link>
        )}
      </form>

      <div className="card">
        {lista.length === 0 ? (
          <p className="muted">Nenhum lançamento encontrado.</p>
        ) : (
          <div className="tabela-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vencimento</th>
                  <th>Descrição</th>
                  <th>Categoria</th>
                  {ctx.unidades.length > 1 && <th>Unidade</th>}
                  <th className="num">Valor</th>
                  <th>Status</th>
                  <th>Pago em</th>
                  {ctx.podeEditar && <th></th>}
                </tr>
              </thead>
              <tbody>
                {lista.map((l) => (
                  <tr key={l.id}>
                    <td>{formatData(l.vencimento)}</td>
                    <td>
                      <Link href={`/lancamentos/${l.id}`}>{l.descricao}</Link>
                      {l.fornecedor && <div className="muted small">{l.fornecedor}</div>}
                      <div className="small muted">
                        {l.parcela ? `recorrente · ${l.parcela}ª ` : ""}
                        {l.comprovante_arquivo ? "📎 comprovante " : ""}
                        {l.origem === "octagym" ? "Octagym" : ""}
                      </div>
                    </td>
                    <td className="small">{l.categoria_nome ?? "—"}</td>
                    {ctx.unidades.length > 1 && <td className="small">{l.unidade_nome}</td>}
                    <td className={`num ${l.tipo}`}>
                      {formatBRL(l.valor_centavos)}
                      {l.status === "pago" && l.valor_pago_centavos != null && l.valor_pago_centavos !== l.valor_centavos && (
                        <div className="small muted">pago {formatBRL(l.valor_pago_centavos)}</div>
                      )}
                    </td>
                    <td>
                      <StatusTag l={l} hoje={hoje} />
                    </td>
                    <td className="small">{formatData(l.data_pagamento)}</td>
                    {ctx.podeEditar && (
                      <td>
                        {l.status === "aberto" && (
                          <form action={acaoDarBaixa} className="acoes" style={{ flexWrap: "nowrap" }}>
                            <input type="hidden" name="id" value={l.id} />
                            <input type="hidden" name="voltar" value={url({})} />
                            <input type="date" name="data_pagamento" defaultValue={hoje} aria-label="Data do pagamento" style={{ width: 140 }} />
                            <button type="submit" title="Marcar como pago/recebido com o valor previsto">
                              {l.tipo === "receita" ? "Recebido" : "Pago"}
                            </button>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {(!tipo || tipo === "receita") && (
                  <tr>
                    <td colSpan={ctx.unidades.length > 1 ? 4 : 3}>Receitas ({lista.filter((l) => l.tipo === "receita").length})</td>
                    <td className="num receita">{formatBRL(totRec)}</td>
                    <td colSpan={ctx.podeEditar ? 3 : 2} className="small">recebido {formatBRL(pagoRec)}</td>
                  </tr>
                )}
                {(!tipo || tipo === "despesa") && (
                  <tr>
                    <td colSpan={ctx.unidades.length > 1 ? 4 : 3}>Despesas ({lista.filter((l) => l.tipo === "despesa").length})</td>
                    <td className="num despesa">{formatBRL(totDesp)}</td>
                    <td colSpan={ctx.podeEditar ? 3 : 2} className="small">pago {formatBRL(pagoDesp)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
