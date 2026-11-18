import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { somarMeses } from "./datas";
import { emUnidades, type Status, type Tipo } from "./db";

export const FORMAS_PAGAMENTO = ["Pix", "Boleto", "Cartão de crédito", "Cartão de débito", "Dinheiro", "Transferência", "Débito automático", "Outro"] as const;

export interface Categoria {
  id: number;
  nome: string;
  tipo: Tipo;
  ativo: number;
}

export interface Unidade {
  id: number;
  nome: string;
  ativo: number;
}

export function listarUnidades(db: Database.Database, incluirInativas = false): Unidade[] {
  return db.prepare(`SELECT * FROM unidades ${incluirInativas ? "" : "WHERE ativo = 1"} ORDER BY nome`).all() as Unidade[];
}

export function salvarUnidade(db: Database.Database, nome: string, id?: number | null): string | null {
  const n = nome.trim().slice(0, 60);
  if (!n) return "Informe o nome da unidade.";
  const existe = db.prepare("SELECT id FROM unidades WHERE nome = ? AND id IS NOT ?").get(n, id ?? null);
  if (existe) return "Já existe uma unidade com esse nome.";
  if (id) db.prepare("UPDATE unidades SET nome = ? WHERE id = ?").run(n, id);
  else db.prepare("INSERT INTO unidades (nome) VALUES (?)").run(n);
  return null;
}

export function alternarUnidade(db: Database.Database, id: number): void {
  db.prepare("UPDATE unidades SET ativo = 1 - ativo WHERE id = ?").run(id);
}

export interface Lancamento {
  id: number;
  unidade_id: number;
  unidade_nome?: string | null;
  tipo: Tipo;
  descricao: string;
  fornecedor: string | null;
  categoria_id: number | null;
  categoria_nome?: string | null;
  valor_centavos: number;
  vencimento: string;
  status: Status;
  data_pagamento: string | null;
  valor_pago_centavos: number | null;
  forma_pagamento: string | null;
  comprovante_arquivo: string | null;
  comprovante_nome: string | null;
  recorrencia_id: string | null;
  parcela: number | null;
  observacao: string | null;
  origem: string;
  import_chave: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface DadosLancamento {
  unidade_id: number;
  tipo: Tipo;
  descricao: string;
  fornecedor?: string | null;
  categoria_id?: number | null;
  valor_centavos: number;
  vencimento: string;
  forma_pagamento?: string | null;
  observacao?: string | null;
}

export interface DadosPagamento {
  data_pagamento: string;
  valor_pago_centavos?: number | null;
  forma_pagamento?: string | null;
  comprovante_arquivo?: string | null;
  comprovante_nome?: string | null;
}

export function listarCategorias(db: Database.Database, tipo?: Tipo, incluirInativas = false): Categoria[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (tipo) {
    where.push("tipo = ?");
    params.push(tipo);
  }
  if (!incluirInativas) where.push("ativo = 1");
  const sql = `SELECT * FROM categorias ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY tipo, nome`;
  return db.prepare(sql).all(...params) as Categoria[];
}

export function criarCategoria(db: Database.Database, nome: string, tipo: Tipo): void {
  db.prepare("INSERT INTO categorias (nome, tipo) VALUES (?, ?) ON CONFLICT(nome, tipo) DO UPDATE SET ativo = 1").run(nome.trim(), tipo);
}

/** Renomeia a categoria. Os lançamentos ligados a ela passam a mostrar o nome novo. */
export function renomearCategoria(db: Database.Database, id: number, nome: string): string | null {
  const n = nome.trim().slice(0, 60);
  if (!n) return "Informe o nome da categoria.";
  const cat = db.prepare("SELECT tipo FROM categorias WHERE id = ?").get(id) as { tipo: Tipo } | undefined;
  if (!cat) return "Categoria não encontrada.";
  const existe = db.prepare("SELECT 1 FROM categorias WHERE nome = ? AND tipo = ? AND id <> ?").get(n, cat.tipo, id);
  if (existe) return `Já existe uma categoria de ${cat.tipo} com esse nome.`;
  db.prepare("UPDATE categorias SET nome = ? WHERE id = ?").run(n, id);
  return null;
}

export function alternarCategoria(db: Database.Database, id: number): void {
  db.prepare("UPDATE categorias SET ativo = 1 - ativo WHERE id = ?").run(id);
}

/**
 * Cria um lançamento. Com `meses` > 1, cria uma série mensal (mesmo dia de vencimento),
 * todas ligadas pelo mesmo recorrencia_id. Retorna os ids criados.
 */
export function criarLancamento(
  db: Database.Database,
  dados: DadosLancamento,
  opcoes: { meses?: number; usuarioId?: number | null; pagamento?: DadosPagamento | null } = {},
): number[] {
  const meses = Math.max(1, Math.min(opcoes.meses ?? 1, 60));
  const recorrenciaId = meses > 1 ? randomUUID() : null;
  const dia = Number(dados.vencimento.slice(8, 10));
  const insert = db.prepare(`
    INSERT INTO lancamentos (unidade_id, tipo, descricao, fornecedor, categoria_id, valor_centavos, vencimento,
      forma_pagamento, observacao, recorrencia_id, parcela, criado_por)
    VALUES (@unidade_id, @tipo, @descricao, @fornecedor, @categoria_id, @valor_centavos, @vencimento,
      @forma_pagamento, @observacao, @recorrencia_id, @parcela, @criado_por)`);
  const ids: number[] = [];
  db.transaction(() => {
    for (let i = 0; i < meses; i++) {
      const r = insert.run({
        unidade_id: dados.unidade_id,
        tipo: dados.tipo,
        descricao: dados.descricao.trim(),
        fornecedor: dados.fornecedor?.trim() || null,
        categoria_id: dados.categoria_id ?? null,
        valor_centavos: dados.valor_centavos,
        vencimento: i === 0 ? dados.vencimento : somarMeses(dados.vencimento, i, dia),
        forma_pagamento: dados.forma_pagamento || null,
        observacao: dados.observacao?.trim() || null,
        recorrencia_id: recorrenciaId,
        parcela: recorrenciaId ? i + 1 : null,
        criado_por: opcoes.usuarioId ?? null,
      });
      ids.push(Number(r.lastInsertRowid));
    }
    if (opcoes.pagamento) darBaixa(db, ids[0], opcoes.pagamento);
  })();
  return ids;
}

export function obterLancamento(db: Database.Database, id: number): Lancamento | undefined {
  return db
    .prepare(`SELECT l.*, c.nome AS categoria_nome, u.nome AS unidade_nome FROM lancamentos l
      LEFT JOIN categorias c ON c.id = l.categoria_id LEFT JOIN unidades u ON u.id = l.unidade_id WHERE l.id = ?`)
    .get(id) as Lancamento | undefined;
}

/**
 * Atualiza um lançamento. Com escopo "futuros", os campos descritivos e o valor também são
 * aplicados às próximas parcelas em aberto da mesma série (o vencimento de cada uma é mantido).
 */
export function atualizarLancamento(db: Database.Database, id: number, dados: DadosLancamento, escopo: "este" | "futuros" = "este"): void {
  const atual = obterLancamento(db, id);
  if (!atual) throw new Error("Lançamento não encontrado");
  const campos = {
    unidade_id: dados.unidade_id,
    descricao: dados.descricao.trim(),
    fornecedor: dados.fornecedor?.trim() || null,
    categoria_id: dados.categoria_id ?? null,
    valor_centavos: dados.valor_centavos,
    forma_pagamento: dados.forma_pagamento || null,
    observacao: dados.observacao?.trim() || null,
  };
  db.transaction(() => {
    db.prepare(`
      UPDATE lancamentos SET unidade_id=@unidade_id, descricao=@descricao, fornecedor=@fornecedor, categoria_id=@categoria_id,
        valor_centavos=@valor_centavos, forma_pagamento=@forma_pagamento, observacao=@observacao,
        vencimento=@vencimento, atualizado_em=datetime('now')
      WHERE id=@id`).run({ ...campos, vencimento: dados.vencimento, id });
    if (escopo === "futuros" && atual.recorrencia_id) {
      db.prepare(`
        UPDATE lancamentos SET unidade_id=@unidade_id, descricao=@descricao, fornecedor=@fornecedor, categoria_id=@categoria_id,
          valor_centavos=@valor_centavos, forma_pagamento=@forma_pagamento, observacao=@observacao,
          atualizado_em=datetime('now')
        WHERE recorrencia_id=@rid AND vencimento > @venc AND status='aberto' AND id <> @id`).run({
        ...campos,
        rid: atual.recorrencia_id,
        venc: atual.vencimento,
        id,
      });
    }
  })();
}

/** Marca como pago (despesa) ou recebido (receita). */
export function darBaixa(db: Database.Database, id: number, pg: DadosPagamento): void {
  const atual = obterLancamento(db, id);
  if (!atual) throw new Error("Lançamento não encontrado");
  db.prepare(`
    UPDATE lancamentos SET status='pago', data_pagamento=@data, valor_pago_centavos=@valor,
      forma_pagamento=COALESCE(@forma, forma_pagamento),
      comprovante_arquivo=COALESCE(@arquivo, comprovante_arquivo),
      comprovante_nome=COALESCE(@nome, comprovante_nome),
      atualizado_em=datetime('now')
    WHERE id=@id`).run({
    id,
    data: pg.data_pagamento,
    valor: pg.valor_pago_centavos ?? atual.valor_centavos,
    forma: pg.forma_pagamento || null,
    arquivo: pg.comprovante_arquivo || null,
    nome: pg.comprovante_nome || null,
  });
}

/** Desfaz a baixa (volta para "em aberto"). O comprovante é mantido. */
export function reabrir(db: Database.Database, id: number): void {
  db.prepare(`UPDATE lancamentos SET status='aberto', data_pagamento=NULL, valor_pago_centavos=NULL, atualizado_em=datetime('now') WHERE id=?`).run(id);
}

export function anexarComprovante(db: Database.Database, id: number, arquivo: string, nome: string): string | null {
  const atual = obterLancamento(db, id);
  db.prepare(`UPDATE lancamentos SET comprovante_arquivo=?, comprovante_nome=?, atualizado_em=datetime('now') WHERE id=?`).run(arquivo, nome, id);
  return atual?.comprovante_arquivo ?? null;
}

/** Exclui e devolve os nomes dos arquivos de comprovante que ficaram órfãos. */
export function excluirLancamento(db: Database.Database, id: number, escopo: "este" | "futuros" = "este"): string[] {
  const atual = obterLancamento(db, id);
  if (!atual) return [];
  const alvos =
    escopo === "futuros" && atual.recorrencia_id
      ? (db
          .prepare(`SELECT id, comprovante_arquivo FROM lancamentos WHERE recorrencia_id=? AND (id=? OR (vencimento > ? AND status='aberto'))`)
          .all(atual.recorrencia_id, id, atual.vencimento) as { id: number; comprovante_arquivo: string | null }[])
      : [{ id, comprovante_arquivo: atual.comprovante_arquivo }];
  const del = db.prepare("DELETE FROM lancamentos WHERE id=?");
  db.transaction(() => alvos.forEach((a) => del.run(a.id)))();
  return alvos.map((a) => a.comprovante_arquivo).filter((a): a is string => !!a);
}

export interface Filtros {
  /** Unidades visíveis/selecionadas. */
  unidades: number[];
  inicio?: string;
  fim?: string;
  /** "vencimento" filtra pela data prevista; "pagamento" pela data em que foi pago/recebido. */
  base?: "vencimento" | "pagamento";
  tipo?: Tipo;
  status?: Status | "vencido";
  categoriaId?: number;
  busca?: string;
  hoje?: string;
}

export function listarLancamentos(db: Database.Database, f: Filtros): Lancamento[] {
  const where: string[] = [emUnidades("l.unidade_id", f.unidades)];
  const params: Record<string, unknown> = {};
  const col = f.base === "pagamento" ? "l.data_pagamento" : "l.vencimento";
  if (f.inicio) {
    where.push(`${col} >= @inicio`);
    params.inicio = f.inicio;
  }
  if (f.fim) {
    where.push(`${col} <= @fim`);
    params.fim = f.fim;
  }
  if (f.tipo) {
    where.push("l.tipo = @tipo");
    params.tipo = f.tipo;
  }
  if (f.status === "vencido") {
    where.push("l.status = 'aberto' AND l.vencimento < @hoje");
    params.hoje = f.hoje;
  } else if (f.status) {
    where.push("l.status = @status");
    params.status = f.status;
  }
  if (f.categoriaId) {
    where.push("l.categoria_id = @cat");
    params.cat = f.categoriaId;
  }
  if (f.busca) {
    where.push("(l.descricao LIKE @busca OR l.fornecedor LIKE @busca OR l.observacao LIKE @busca)");
    params.busca = `%${f.busca}%`;
  }
  const sql = `
    SELECT l.*, c.nome AS categoria_nome, u.nome AS unidade_nome FROM lancamentos l
    LEFT JOIN categorias c ON c.id = l.categoria_id
    LEFT JOIN unidades u ON u.id = l.unidade_id
    WHERE ${where.join(" AND ")}
    ORDER BY ${col} ASC, l.id ASC`;
  return db.prepare(sql).all(params) as Lancamento[];
}

export interface ItemImportacao {
  vencimento: string;
  descricao: string;
  fornecedor: string | null;
  valor_centavos: number;
  pago: boolean;
  data_pagamento: string | null;
  forma_pagamento: string | null;
  categoria: string | null;
  chave: string;
}

/**
 * Grava receitas importadas. Linhas já importadas antes (mesma chave) são ignoradas.
 * A categoria do arquivo é usada se existir com o mesmo nome; senão, usa a categoria padrão.
 */
export function importarReceitas(
  db: Database.Database,
  itens: ItemImportacao[],
  opcoes: { unidadeId: number; lote: string; categoriaPadraoId: number | null; usuarioId?: number | null },
): { inseridos: number; duplicados: number } {
  const cats = new Map(listarCategorias(db, "receita", true).map((c) => [c.nome.toLowerCase(), c.id]));
  const ins = db.prepare(`
    INSERT INTO lancamentos (unidade_id, tipo, descricao, fornecedor, categoria_id, valor_centavos, vencimento, status,
      data_pagamento, valor_pago_centavos, forma_pagamento, origem, import_chave, criado_por)
    VALUES (@unidade, 'receita', @descricao, @fornecedor, @categoria_id, @valor, @vencimento, @status,
      @data_pagamento, @valor_pago, @forma, @origem, @chave, @usuario)
    ON CONFLICT(import_chave) DO NOTHING`);
  let inseridos = 0;
  db.transaction(() => {
    for (const it of itens) {
      const r = ins.run({
        unidade: opcoes.unidadeId,
        descricao: it.descricao,
        fornecedor: it.fornecedor,
        categoria_id: (it.categoria && cats.get(it.categoria.toLowerCase())) || opcoes.categoriaPadraoId,
        valor: it.valor_centavos,
        vencimento: it.vencimento,
        status: it.pago ? "pago" : "aberto",
        data_pagamento: it.pago ? it.data_pagamento : null,
        valor_pago: it.pago ? it.valor_centavos : null,
        forma: it.forma_pagamento,
        origem: `importacao:${opcoes.lote}`,
        chave: `octagym:${opcoes.unidadeId}:${it.chave}`,
        usuario: opcoes.usuarioId ?? null,
      });
      inseridos += r.changes;
    }
  })();
  return { inseridos, duplicados: itens.length - inseridos };
}

export interface LoteImportacao {
  origem: string;
  unidade_nome: string;
  quantidade: number;
  total: number;
  criado_em: string;
}

export function listarLotes(db: Database.Database, unidades: number[]): LoteImportacao[] {
  return db
    .prepare(`SELECT l.origem, MIN(u.nome) AS unidade_nome, COUNT(*) AS quantidade, SUM(l.valor_centavos) AS total, MIN(l.criado_em) AS criado_em
      FROM lancamentos l JOIN unidades u ON u.id = l.unidade_id
      WHERE l.origem LIKE 'importacao:%' AND ${emUnidades("l.unidade_id", unidades)}
      GROUP BY l.origem ORDER BY criado_em DESC LIMIT 20`)
    .all() as LoteImportacao[];
}

export function desfazerLote(db: Database.Database, origem: string, unidades: number[]): number {
  if (!origem.startsWith("importacao:")) return 0;
  return db.prepare(`DELETE FROM lancamentos WHERE origem = ? AND ${emUnidades("unidade_id", unidades)}`).run(origem).changes;
}
