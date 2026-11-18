import Link from "next/link";
import { exigirContexto, unidadesSelecionadas } from "@/lib/auth";
import { formatData, hoje as hojeSP, intervaloDoMes, isMes, mesAnterior, mesSeguinte, nomeDoMes } from "@/lib/datas";
import { getDb } from "@/lib/db";
import { fluxoDiario } from "@/lib/fluxo";
import { formatBRL } from "@/lib/money";
import { param, SeletorUnidade, type SP } from "../../ui";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export default async function Fluxo({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await exigirContexto();
  const { ids, atual } = unidadesSelecionadas(ctx, param(sp, "unidade"));
  const hoje = hojeSP();
  const mesParam = param(sp, "mes");
  const mes = isMes(mesParam) ? mesParam : hoje.slice(0, 7);
  const todos = param(sp, "dias") === "todos";
  const { inicio, fim } = intervaloDoMes(mes);
  const unidadeQ = atual === "todas" ? "todas" : String(atual);

  const linhas = fluxoDiario(getDb(), ids, inicio, fim, hoje);
  const visiveis = todos ? linhas : linhas.filter((l) => l.previstoReceitas || l.previstoDespesas || l.realizadoReceitas || l.realizadoDespesas || l.data === hoje);
  const soma = (k: "previstoReceitas" | "previstoDespesas" | "realizadoReceitas" | "realizadoDespesas") => linhas.reduce((s, l) => s + l[k], 0);
  const q = (extra: Record<string, string>) => `/fluxo?${new URLSearchParams({ unidade: unidadeQ, mes, ...(todos ? { dias: "todos" } : {}), ...extra })}`;

  return (
    <>
      <div className="cabecalho">
        <div>
          <h1>Fluxo de caixa diário · {nomeDoMes(mes)}</h1>
          <div className="acoes small">
            <Link href={q({ mes: mesAnterior(mes) })}>← mês anterior</Link>
            <Link href={q({ mes: mesSeguinte(mes) })}>próximo mês →</Link>
            <Link href={todos ? `/fluxo?unidade=${unidadeQ}&mes=${mes}` : q({ dias: "todos" })}>{todos ? "só dias com movimento" : "mostrar todos os dias"}</Link>
            <a href={`/exportar?${new URLSearchParams({ unidade: unidadeQ, inicio, fim })}`}>exportar planilha do mês</a>
          </div>
        </div>
        <SeletorUnidade ctx={ctx} atual={atual} base="/fluxo" extra={{ mes }} />
      </div>
      <div className="card">
        <div className="tabela-wrap">
          <table>
            <thead>
              <tr>
                <th>Dia</th>
                <th className="num">Entradas previstas</th>
                <th className="num">Entradas realizadas</th>
                <th className="num">Saídas previstas</th>
                <th className="num">Saídas realizadas</th>
                <th className="num">Saldo do dia</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const dow = DIAS[new Date(`${l.data}T12:00:00Z`).getUTCDay()];
                return (
                  <tr key={l.data} className={l.data === hoje ? "hoje" : l.projetado ? "projetado" : ""}>
                    <td>
                      <Link href={`/lancamentos?${new URLSearchParams({ unidade: unidadeQ, inicio: l.data, fim: l.data })}`}>{formatData(l.data)}</Link>{" "}
                      <span className="muted small">{dow}</span>
                    </td>
                    <td className="num">{l.previstoReceitas ? formatBRL(l.previstoReceitas) : "—"}</td>
                    <td className="num receita">{l.realizadoReceitas ? formatBRL(l.realizadoReceitas) : "—"}</td>
                    <td className="num">{l.previstoDespesas ? formatBRL(l.previstoDespesas) : "—"}</td>
                    <td className="num despesa">{l.realizadoDespesas ? formatBRL(l.realizadoDespesas) : "—"}</td>
                    <td className={`num ${l.saldo < 0 ? "perigo" : ""}`}>{formatBRL(l.saldo)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total do mês</td>
                <td className="num">{formatBRL(soma("previstoReceitas"))}</td>
                <td className="num receita">{formatBRL(soma("realizadoReceitas"))}</td>
                <td className="num">{formatBRL(soma("previstoDespesas"))}</td>
                <td className="num despesa">{formatBRL(soma("realizadoDespesas"))}</td>
                <td className="num">{linhas.length ? formatBRL(linhas[linhas.length - 1].saldo) : "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Até hoje (destacado), o saldo usa só o que foi pago/recebido. Depois de hoje (itálico), é projetado com o que está em aberto; contas já vencidas e
          não pagas entram no dia seguinte a hoje.
        </p>
      </div>
    </>
  );
}
