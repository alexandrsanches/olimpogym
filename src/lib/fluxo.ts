import type Database from "better-sqlite3";
import { somarDias } from "./datas";
import { emUnidades, type Tipo } from "./db";

// Todas as funções recebem a lista de unidades a considerar (uma unidade ou várias = consolidado).

export interface SaldoInicial {
  unidade_id: number;
  valor_centavos: number;
  /** Data de referência: pagamentos até esta data (inclusive) já estão contados no saldo inicial. */
  data: string;
}

export function listarSaldosIniciais(db: Database.Database): SaldoInicial[] {
  return db.prepare("SELECT unidade_id, valor_centavos, data FROM saldos_iniciais").all() as SaldoInicial[];
}

export function definirSaldoInicial(db: Database.Database, s: SaldoInicial): void {
  db.prepare(`INSERT INTO saldos_iniciais (unidade_id, valor_centavos, data) VALUES (?, ?, ?)
    ON CONFLICT(unidade_id) DO UPDATE SET valor_centavos = excluded.valor_centavos, data = excluded.data`).run(s.unidade_id, s.valor_centavos, s.data);
}

export interface Totais {
  receitas: number;
  despesas: number;
  saldo: number;
}

export interface ResumoPeriodo {
  /** Tudo que vence no período (pago ou não). */
  previsto: Totais;
  /** O que foi efetivamente pago/recebido no período (pela data do pagamento). */
  realizado: Totais;
  /** Em aberto com vencimento no período. */
  emAberto: Totais;
}

function totais(receitas: number, despesas: number): Totais {
  return { receitas, despesas, saldo: receitas - despesas };
}

export function resumoPeriodo(db: Database.Database, unidades: number[], inicio: string, fim: string): ResumoPeriodo {
  const u = emUnidades("unidade_id", unidades);
  const prev = db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='receita' THEN valor_centavos END),0) AS r,
        COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor_centavos END),0) AS d,
        COALESCE(SUM(CASE WHEN tipo='receita' AND status='aberto' THEN valor_centavos END),0) AS ra,
        COALESCE(SUM(CASE WHEN tipo='despesa' AND status='aberto' THEN valor_centavos END),0) AS da
      FROM lancamentos WHERE ${u} AND vencimento BETWEEN ? AND ?`)
    .get(inicio, fim) as { r: number; d: number; ra: number; da: number };
  const real = db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='receita' THEN COALESCE(valor_pago_centavos, valor_centavos) END),0) AS r,
        COALESCE(SUM(CASE WHEN tipo='despesa' THEN COALESCE(valor_pago_centavos, valor_centavos) END),0) AS d
      FROM lancamentos WHERE ${u} AND status='pago' AND data_pagamento BETWEEN ? AND ?`)
    .get(inicio, fim) as { r: number; d: number };
  return {
    previsto: totais(prev.r, prev.d),
    realizado: totais(real.r, real.d),
    emAberto: totais(prev.ra, prev.da),
  };
}

export interface LinhaCategoria {
  categoria: string;
  previsto: number;
  realizado: number;
}

/** Por categoria: previsto pelo vencimento no período, realizado pela data de pagamento no período. */
export function porCategoria(db: Database.Database, unidades: number[], tipo: Tipo, inicio: string, fim: string): LinhaCategoria[] {
  return db
    .prepare(`
      SELECT COALESCE(c.nome, 'Sem categoria') AS categoria,
        COALESCE(SUM(CASE WHEN l.vencimento BETWEEN @i AND @f THEN l.valor_centavos END),0) AS previsto,
        COALESCE(SUM(CASE WHEN l.status='pago' AND l.data_pagamento BETWEEN @i AND @f
          THEN COALESCE(l.valor_pago_centavos, l.valor_centavos) END),0) AS realizado
      FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
      WHERE ${emUnidades("l.unidade_id", unidades)} AND l.tipo=@t
        AND (l.vencimento BETWEEN @i AND @f OR (l.status='pago' AND l.data_pagamento BETWEEN @i AND @f))
      GROUP BY 1 ORDER BY MAX(previsto, realizado) DESC`)
    .all({ t: tipo, i: inicio, f: fim }) as LinhaCategoria[];
}

/**
 * Saldo em caixa no fim do dia `data`, somando as contas das unidades, considerando só o que
 * foi efetivamente pago/recebido. Cada unidade parte do seu próprio saldo inicial.
 */
export function saldoRealizadoAte(db: Database.Database, unidades: number[], data: string): number {
  const u = emUnidades("un.id", unidades);
  const r = db
    .prepare(`
      SELECT
        COALESCE((SELECT SUM(s.valor_centavos) FROM saldos_iniciais s JOIN unidades un ON un.id = s.unidade_id WHERE ${u}), 0)
        + COALESCE((
          SELECT SUM(CASE WHEN l.tipo='receita' THEN 1 ELSE -1 END * COALESCE(l.valor_pago_centavos, l.valor_centavos))
          FROM lancamentos l JOIN unidades un ON un.id = l.unidade_id
          LEFT JOIN saldos_iniciais s ON s.unidade_id = l.unidade_id
          WHERE ${u} AND l.status='pago' AND l.data_pagamento <= @data
            AND l.data_pagamento > COALESCE(s.data, '0000-01-01')
        ), 0) AS saldo`)
    .get({ data }) as { saldo: number };
  return r.saldo;
}

export interface Pendencias {
  despesasVencidas: { qtd: number; total: number };
  receitasAtrasadas: { qtd: number; total: number };
  despesasProximos7: { qtd: number; total: number };
}

export function pendencias(db: Database.Database, unidades: number[], hoje: string): Pendencias {
  const q = db.prepare(`SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_centavos),0) AS total FROM lancamentos
    WHERE ${emUnidades("unidade_id", unidades)} AND status='aberto' AND tipo=? AND vencimento BETWEEN ? AND ?`);
  const ontem = somarDias(hoje, -1);
  return {
    despesasVencidas: q.get("despesa", "0000-01-01", ontem) as { qtd: number; total: number },
    receitasAtrasadas: q.get("receita", "0000-01-01", ontem) as { qtd: number; total: number },
    despesasProximos7: q.get("despesa", hoje, somarDias(hoje, 7)) as { qtd: number; total: number },
  };
}

export interface Projecao {
  dias: number;
  ate: string;
  receitas: number;
  despesas: number;
  saldoFinal: number;
}

/**
 * Projeção de caixa: saldo realizado hoje + tudo que está em aberto com vencimento até hoje+N dias.
 * Itens já vencidos e ainda em aberto entram na projeção (presume-se que serão pagos/recebidos).
 */
export function projecoes(db: Database.Database, unidades: number[], hoje: string, horizontes = [30, 60, 90]): { saldoAtual: number; itens: Projecao[] } {
  const saldoAtual = saldoRealizadoAte(db, unidades, hoje);
  const q = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='receita' THEN valor_centavos END),0) AS r,
      COALESCE(SUM(CASE WHEN tipo='despesa' THEN valor_centavos END),0) AS d
    FROM lancamentos WHERE ${emUnidades("unidade_id", unidades)} AND status='aberto' AND vencimento <= ?`);
  const itens = horizontes.map((dias) => {
    const ate = somarDias(hoje, dias);
    const { r, d } = q.get(ate) as { r: number; d: number };
    return { dias, ate, receitas: r, despesas: d, saldoFinal: saldoAtual + r - d };
  });
  return { saldoAtual, itens };
}

export interface LinhaDia {
  data: string;
  previstoReceitas: number;
  previstoDespesas: number;
  realizadoReceitas: number;
  realizadoDespesas: number;
  /** Saldo em caixa no fim do dia: realizado até hoje; depois de hoje, projetado com o que está em aberto. */
  saldo: number;
  projetado: boolean;
}

/** Fluxo de caixa dia a dia no intervalo (inclusive). */
export function fluxoDiario(db: Database.Database, unidades: number[], inicio: string, fim: string, hoje: string): LinhaDia[] {
  const u = emUnidades("unidade_id", unidades);
  const prev = db
    .prepare(`SELECT vencimento AS d,
        SUM(CASE WHEN tipo='receita' THEN valor_centavos ELSE 0 END) AS r,
        SUM(CASE WHEN tipo='despesa' THEN valor_centavos ELSE 0 END) AS x
      FROM lancamentos WHERE ${u} AND vencimento BETWEEN ? AND ? GROUP BY vencimento`)
    .all(inicio, fim) as { d: string; r: number; x: number }[];
  const real = db
    .prepare(`SELECT data_pagamento AS d,
        SUM(CASE WHEN tipo='receita' THEN COALESCE(valor_pago_centavos, valor_centavos) ELSE 0 END) AS r,
        SUM(CASE WHEN tipo='despesa' THEN COALESCE(valor_pago_centavos, valor_centavos) ELSE 0 END) AS x
      FROM lancamentos WHERE ${u} AND status='pago' AND data_pagamento BETWEEN ? AND ? GROUP BY data_pagamento`)
    .all(inicio, fim) as { d: string; r: number; x: number }[];
  // em aberto, para a parte projetada (depois de hoje); vencidos em aberto entram no dia seguinte a hoje
  const abertos = db
    .prepare(`SELECT MAX(vencimento, ?) AS d,
        SUM(CASE WHEN tipo='receita' THEN valor_centavos ELSE -valor_centavos END) AS mov
      FROM lancamentos WHERE ${u} AND status='aberto' AND vencimento <= ? GROUP BY 1`)
    .all(somarDias(hoje, 1), fim) as { d: string; mov: number }[];

  const mPrev = new Map(prev.map((p) => [p.d, p]));
  const mReal = new Map(real.map((p) => [p.d, p]));
  const mAberto = new Map(abertos.map((p) => [p.d, p.mov]));

  const linhas: LinhaDia[] = [];
  let saldo: number;
  if (inicio > hoje) {
    // período no futuro: parte do saldo de hoje mais o que está em aberto até a véspera do início
    saldo = saldoRealizadoAte(db, unidades, hoje);
    for (const a of abertos) if (a.d < inicio) saldo += a.mov;
  } else {
    saldo = saldoRealizadoAte(db, unidades, somarDias(inicio, -1));
  }
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) {
    const p = mPrev.get(d);
    const r = mReal.get(d);
    const projetado = d > hoje;
    if (projetado) saldo += mAberto.get(d) ?? 0;
    else saldo += (r?.r ?? 0) - (r?.x ?? 0);
    linhas.push({
      data: d,
      previstoReceitas: p?.r ?? 0,
      previstoDespesas: p?.x ?? 0,
      realizadoReceitas: r?.r ?? 0,
      realizadoDespesas: r?.x ?? 0,
      saldo,
      projetado,
    });
  }
  return linhas;
}

export interface LinhaUnidade {
  unidade_id: number;
  nome: string;
  previsto: Totais;
  realizado: Totais;
  saldoAtual: number;
}

/** Comparativo entre unidades no período. */
export function porUnidade(db: Database.Database, unidades: { id: number; nome: string }[], inicio: string, fim: string, hoje: string): LinhaUnidade[] {
  return unidades.map((un) => {
    const r = resumoPeriodo(db, [un.id], inicio, fim);
    return { unidade_id: un.id, nome: un.nome, previsto: r.previsto, realizado: r.realizado, saldoAtual: saldoRealizadoAte(db, [un.id], hoje) };
  });
}
