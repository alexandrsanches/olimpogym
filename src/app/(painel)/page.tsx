import Link from "next/link";
import { exigirContexto, unidadesSelecionadas } from "@/lib/auth";
import { formatData, hoje as hojeSP, intervaloDoMes, isMes, mesAnterior, mesSeguinte, nomeDoMes, somarDias } from "@/lib/datas";
import { getDb } from "@/lib/db";
import { pendencias, porCategoria, porUnidade, projecoes, resumoPeriodo, type LinhaCategoria } from "@/lib/fluxo";
import { listarLancamentos } from "@/lib/lancamentos";
import { formatBRL } from "@/lib/money";
import { Mensagens, param, SeletorUnidade, StatusTag, type SP } from "../ui";

function Categorias({ titulo, linhas, cor }: { titulo: string; linhas: LinhaCategoria[]; cor: string }) {
  const max = Math.max(1, ...linhas.map((l) => Math.max(l.previsto, l.realizado)));
  return (
    <div className="card">
      <h2>{titulo}</h2>
      {linhas.length === 0 && <p className="muted">Nada no período.</p>}
      {linhas.map((l) => (
        <div key={l.categoria} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{l.categoria}</span>
            <span className="num small">
              {formatBRL(l.realizado)} <span className="muted">de {formatBRL(l.previsto)}</span>
            </span>
          </div>
          <div className="barra" title={`Previsto ${formatBRL(l.previsto)}`}>
            <span style={{ width: `${(Math.max(l.previsto, l.realizado) / max) * 100}%`, background: `color-mix(in srgb, ${cor} 25%, transparent)` }}>
              <span style={{ width: `${l.previsto ? Math.min(100, (l.realizado / Math.max(l.previsto, l.realizado)) * 100) : 100}%`, background: cor }} />
            </span>
          </div>
        </div>
      ))}
      <p className="muted small" style={{ marginBottom: 0 }}>
        Barra clara = previsto; barra cheia = realizado.
      </p>
    </div>
  );
}

export default async function Painel({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await exigirContexto();
  const { ids, atual } = unidadesSelecionadas(ctx, param(sp, "unidade"));
  const db = getDb();
  const hoje = hojeSP();
  const mesParam = param(sp, "mes");
  const mes = isMes(mesParam) ? mesParam : hoje.slice(0, 7);
  const { inicio, fim } = intervaloDoMes(mes);
  const unidadeQ = atual === "todas" ? "todas" : String(atual);

  const resumo = resumoPeriodo(db, ids, inicio, fim);
  const pend = pendencias(db, ids, hoje);
  const proj = projecoes(db, ids, hoje);
  const catDesp = porCategoria(db, ids, "despesa", inicio, fim);
  const catRec = porCategoria(db, ids, "receita", inicio, fim);
  const unidades = atual === "todas" && ctx.unidades.length > 1 ? porUnidade(db, ctx.unidades, inicio, fim, hoje) : [];
  const proximas = listarLancamentos(db, { unidades: ids, tipo: "despesa", status: "aberto", fim: somarDias(hoje, 15) }).slice(0, 12);

  const link = (q: Record<string, string>) => `/lancamentos?${new URLSearchParams({ unidade: unidadeQ, ...q })}`;

  return (
    <>
      <Mensagens sp={sp} />
      <div className="cabecalho">
        <div>
          <h1>Painel · {nomeDoMes(mes)}</h1>
          <div className="acoes small">
            <Link href={`/?mes=${mesAnterior(mes)}&unidade=${unidadeQ}`}>← mês anterior</Link>
            {mes !== hoje.slice(0, 7) && <Link href={`/?unidade=${unidadeQ}`}>mês atual</Link>}
            <Link href={`/?mes=${mesSeguinte(mes)}&unidade=${unidadeQ}`}>próximo mês →</Link>
          </div>
        </div>
        <SeletorUnidade ctx={ctx} atual={atual} base="/" extra={{ mes: mesParam }} />
      </div>

      <div className="grade">
        <div className="card kpi">
          <div className="rotulo">Saldo em caixa hoje</div>
          <div className={`valor ${proj.saldoAtual < 0 ? "perigo" : ""}`}>{formatBRL(proj.saldoAtual)}</div>
          <div className="det">saldo inicial + tudo que já foi pago/recebido</div>
        </div>
        <div className="card kpi">
          <div className="rotulo">Entradas do mês</div>
          <div className="valor receita">{formatBRL(resumo.realizado.receitas)}</div>
          <div className="det">realizado · previsto {formatBRL(resumo.previsto.receitas)}</div>
        </div>
        <div className="card kpi">
          <div className="rotulo">Saídas do mês</div>
          <div className="valor despesa">{formatBRL(resumo.realizado.despesas)}</div>
          <div className="det">realizado · previsto {formatBRL(resumo.previsto.despesas)}</div>
        </div>
        <div className="card kpi">
          <div className="rotulo">Resultado do mês</div>
          <div className={`valor ${resumo.realizado.saldo < 0 ? "perigo" : ""}`}>{formatBRL(resumo.realizado.saldo)}</div>
          <div className="det">realizado · previsto {formatBRL(resumo.previsto.saldo)}</div>
        </div>
      </div>

      {(pend.despesasVencidas.qtd > 0 || pend.receitasAtrasadas.qtd > 0 || pend.despesasProximos7.qtd > 0) && (
        <div className="grade">
          {pend.despesasVencidas.qtd > 0 && (
            <Link href={link({ tipo: "despesa", status: "vencido" })} className="card kpi alerta" style={{ textDecoration: "none" }}>
              <div className="rotulo">Contas vencidas</div>
              <div className="valor perigo">{formatBRL(pend.despesasVencidas.total)}</div>
              <div className="det">{pend.despesasVencidas.qtd} em aberto · ver lista</div>
            </Link>
          )}
          {pend.despesasProximos7.qtd > 0 && (
            <Link href={link({ tipo: "despesa", status: "aberto", inicio: hoje, fim: somarDias(hoje, 7) })} className="card kpi" style={{ textDecoration: "none" }}>
              <div className="rotulo">A pagar nos próximos 7 dias</div>
              <div className="valor despesa">{formatBRL(pend.despesasProximos7.total)}</div>
              <div className="det">{pend.despesasProximos7.qtd} contas · ver lista</div>
            </Link>
          )}
          {pend.receitasAtrasadas.qtd > 0 && (
            <Link href={link({ tipo: "receita", status: "vencido" })} className="card kpi" style={{ textDecoration: "none" }}>
              <div className="rotulo">Recebimentos atrasados</div>
              <div className="valor">{formatBRL(pend.receitasAtrasadas.total)}</div>
              <div className="det">{pend.receitasAtrasadas.qtd} em aberto · ver lista</div>
            </Link>
          )}
        </div>
      )}

      <div className="grade-2">
        <div className="card">
          <h2>Projeção de caixa</h2>
          <div className="tabela-wrap">
            <table>
              <thead>
                <tr>
                  <th>Até</th>
                  <th className="num">A receber</th>
                  <th className="num">A pagar</th>
                  <th className="num">Saldo projetado</th>
                </tr>
              </thead>
              <tbody>
                {proj.itens.map((p) => (
                  <tr key={p.dias}>
                    <td>
                      {p.dias} dias <span className="muted small">({formatData(p.ate)})</span>
                    </td>
                    <td className="num receita">{formatBRL(p.receitas)}</td>
                    <td className="num despesa">{formatBRL(p.despesas)}</td>
                    <td className={`num ${p.saldoFinal < 0 ? "perigo" : ""}`}>
                      <strong>{formatBRL(p.saldoFinal)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Saldo de hoje + tudo em aberto que vence até a data (inclui atrasados). <Link href={`/fluxo?unidade=${unidadeQ}`}>Ver dia a dia</Link>
          </p>
        </div>

        <div className="card">
          <h2>Próximas contas a pagar</h2>
          {proximas.length === 0 ? (
            <p className="muted">Nenhuma conta em aberto nos próximos 15 dias.</p>
          ) : (
            <div className="tabela-wrap">
              <table>
                <tbody>
                  {proximas.map((l) => (
                    <tr key={l.id}>
                      <td>{formatData(l.vencimento)}</td>
                      <td>
                        <Link href={`/lancamentos/${l.id}`}>{l.descricao}</Link>
                        {ctx.unidades.length > 1 && <div className="muted small">{l.unidade_nome}</div>}
                      </td>
                      <td className="num">{formatBRL(l.valor_centavos)}</td>
                      <td>
                        <StatusTag l={l} hoje={hoje} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {unidades.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Por unidade · {nomeDoMes(mes)}</h2>
          <div className="tabela-wrap">
            <table>
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th className="num">Entradas (real / prev.)</th>
                  <th className="num">Saídas (real / prev.)</th>
                  <th className="num">Resultado realizado</th>
                  <th className="num">Saldo hoje</th>
                </tr>
              </thead>
              <tbody>
                {unidades.map((u) => (
                  <tr key={u.unidade_id}>
                    <td>
                      <Link href={`/?mes=${mes}&unidade=${u.unidade_id}`}>{u.nome}</Link>
                    </td>
                    <td className="num">
                      <span className="receita">{formatBRL(u.realizado.receitas)}</span> <span className="muted small">/ {formatBRL(u.previsto.receitas)}</span>
                    </td>
                    <td className="num">
                      <span className="despesa">{formatBRL(u.realizado.despesas)}</span> <span className="muted small">/ {formatBRL(u.previsto.despesas)}</span>
                    </td>
                    <td className={`num ${u.realizado.saldo < 0 ? "perigo" : ""}`}>{formatBRL(u.realizado.saldo)}</td>
                    <td className={`num ${u.saldoAtual < 0 ? "perigo" : ""}`}>{formatBRL(u.saldoAtual)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grade-2">
        <Categorias titulo="Saídas por categoria" linhas={catDesp} cor="var(--despesa)" />
        <Categorias titulo="Entradas por categoria" linhas={catRec} cor="var(--receita)" />
      </div>
    </>
  );
}
