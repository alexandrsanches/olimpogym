import type Database from "better-sqlite3";
import { hoje as hojeSP, somarDias } from "../datas";
import type { ConexaoOctagym, FerramentaInfo } from "./cliente";
import { extrairCursor, extrairLista, mapearLoja, mapearTitulo, mascarar, planejarArgumentos, type TituloReceber } from "./mapeamento";

// No Octagym cada unidade da academia é uma empresa com a sua própria chave de API.
// Tudo o que vem pela chave de uma unidade é gravado nessa unidade.

export const FERRAMENTA_TITULOS = "list_financial_titles";
export const FERRAMENTA_LOJAS = "list_stores";

// ---------- configurações gerais (tabela configuracoes) ----------

export interface ConfigOctagym {
  ativo: boolean;
  intervaloMin: number;
  diasPassados: number;
  diasFuturos: number;
  categoriaPadraoId: number | null;
}

const PADRAO: ConfigOctagym = { ativo: false, intervaloMin: 15, diasPassados: 90, diasFuturos: 120, categoriaPadraoId: null };

export function lerConfig(db: Database.Database): ConfigOctagym {
  const linhas = db.prepare("SELECT chave, valor FROM configuracoes WHERE chave LIKE 'octagym_%'").all() as { chave: string; valor: string }[];
  const m = Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
  const n = (k: string, padrao: number | null) => (m[k] !== undefined && m[k] !== "" ? Number(m[k]) : padrao);
  return {
    ativo: m.octagym_ativo === "1",
    intervaloMin: n("octagym_intervalo_min", PADRAO.intervaloMin)!,
    diasPassados: n("octagym_dias_passados", PADRAO.diasPassados)!,
    diasFuturos: n("octagym_dias_futuros", PADRAO.diasFuturos)!,
    categoriaPadraoId: n("octagym_categoria_padrao", null),
  };
}

export function salvarConfig(db: Database.Database, c: ConfigOctagym): void {
  const up = db.prepare("INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor");
  db.transaction(() => {
    up.run("octagym_ativo", c.ativo ? "1" : "0");
    up.run("octagym_intervalo_min", String(Math.max(5, Math.min(c.intervaloMin, 1440))));
    up.run("octagym_dias_passados", String(Math.max(1, Math.min(c.diasPassados, 365))));
    up.run("octagym_dias_futuros", String(Math.max(0, Math.min(c.diasFuturos, 365))));
    up.run("octagym_categoria_padrao", c.categoriaPadraoId == null ? "" : String(c.categoriaPadraoId));
  })();
}

// ---------- chaves por unidade ----------

export interface ChaveUnidade {
  unidade_id: number;
  unidade_nome: string;
  /** só os últimos caracteres, para identificar a chave sem mostrá-la */
  final: string | null;
  empresa: string | null;
  atualizado_em: string | null;
}

/** Todas as unidades ativas, com a situação da chave de cada uma. Nunca devolve a chave inteira. */
export function listarChaves(db: Database.Database): ChaveUnidade[] {
  return (
    db
      .prepare(`SELECT u.id AS unidade_id, u.nome AS unidade_nome, k.chave, k.empresa, k.atualizado_em
        FROM unidades u LEFT JOIN octagym_chaves k ON k.unidade_id = u.id WHERE u.ativo = 1 ORDER BY u.nome`)
      .all() as (Omit<ChaveUnidade, "final"> & { chave: string | null })[]
  ).map(({ chave, ...r }) => ({ ...r, final: chave ? chave.slice(-4) : null }));
}

/** Chaves para uso interno da sincronização. */
export function chavesParaSincronizar(db: Database.Database): { unidade_id: number; unidade_nome: string; chave: string }[] {
  return db
    .prepare(`SELECT k.unidade_id, u.nome AS unidade_nome, k.chave FROM octagym_chaves k JOIN unidades u ON u.id = k.unidade_id
      WHERE u.ativo = 1 ORDER BY u.nome`)
    .all() as { unidade_id: number; unidade_nome: string; chave: string }[];
}

export function validarChave(chave: string): string | null {
  const c = chave.trim();
  if (!/^(og|ea)_[A-Za-z0-9_-]{8,}$/.test(c)) return "Chave inválida: ela começa com og_live_ (ou ea_live_) e não tem espaços.";
  return null;
}

export function salvarChave(db: Database.Database, unidadeId: number, chave: string): string | null {
  const erro = validarChave(chave);
  if (erro) return erro;
  const existe = db.prepare("SELECT 1 FROM unidades WHERE id = ?").get(unidadeId);
  if (!existe) return "Unidade não encontrada.";
  const repetida = db.prepare("SELECT 1 FROM octagym_chaves WHERE chave = ? AND unidade_id <> ?").get(chave.trim(), unidadeId);
  if (repetida) return "Essa chave já está cadastrada em outra unidade.";
  db.prepare(`INSERT INTO octagym_chaves (unidade_id, chave) VALUES (?, ?)
    ON CONFLICT(unidade_id) DO UPDATE SET chave = excluded.chave, empresa = NULL, atualizado_em = datetime('now')`).run(unidadeId, chave.trim());
  return null;
}

export function removerChave(db: Database.Database, unidadeId: number): void {
  db.prepare("DELETE FROM octagym_chaves WHERE unidade_id = ?").run(unidadeId);
  db.prepare("DELETE FROM configuracoes WHERE chave = ?").run(`octagym_diagnostico_${unidadeId}`);
}

function registrarEmpresa(db: Database.Database, unidadeId: number, nome: string | null): void {
  if (nome) db.prepare("UPDATE octagym_chaves SET empresa = ? WHERE unidade_id = ?").run(nome.slice(0, 120), unidadeId);
}

// ---------- gravação dos títulos ----------

export interface Contagem {
  lidos: number;
  criados: number;
  atualizados: number;
  removidos: number;
  ignorados: number;
  motivosIgnorados: Record<string, number>;
}

export function novaContagem(): Contagem {
  return { lidos: 0, criados: 0, atualizados: 0, removidos: 0, ignorados: 0, motivosIgnorados: {} };
}

function ignorar(c: Contagem, motivo: string) {
  c.ignorados++;
  c.motivosIgnorados[motivo] = (c.motivosIgnorados[motivo] ?? 0) + 1;
}

/** Chave estável do lançamento: a unidade entra porque cada unidade é uma empresa (ids podem se repetir). */
export function chaveImportacao(unidadeId: number, tituloId: string): string {
  return `octagym:${unidadeId}:${tituloId}`;
}

/**
 * Cria ou atualiza as receitas da unidade a partir dos títulos do Octagym.
 * O Octagym é a fonte de verdade para valor, datas, status, descrição e cliente; categoria,
 * observação e comprovante definidos no sistema são preservados. Título cancelado no Octagym é removido.
 */
export function gravarTitulos(db: Database.Database, unidadeId: number, titulos: TituloReceber[], cfg: ConfigOctagym, c: Contagem = novaContagem()): Contagem {
  const categorias = new Map(
    (db.prepare("SELECT id, nome FROM categorias WHERE tipo = 'receita'").all() as { id: number; nome: string }[]).map((x) => [x.nome.toLowerCase(), x.id]),
  );
  const buscar = db.prepare("SELECT * FROM lancamentos WHERE import_chave = ?");
  const inserir = db.prepare(`
    INSERT INTO lancamentos (unidade_id, tipo, descricao, fornecedor, categoria_id, valor_centavos, vencimento, status,
      data_pagamento, valor_pago_centavos, forma_pagamento, origem, import_chave)
    VALUES (@unidade_id, 'receita', @descricao, @fornecedor, @categoria_id, @valor, @vencimento, @status,
      @data_pagamento, @valor_pago, @forma, 'octagym', @chave)`);
  const atualizar = db.prepare(`
    UPDATE lancamentos SET descricao=@descricao, fornecedor=@fornecedor, valor_centavos=@valor,
      vencimento=@vencimento, status=@status, data_pagamento=@data_pagamento, valor_pago_centavos=@valor_pago,
      forma_pagamento=COALESCE(@forma, forma_pagamento), atualizado_em=datetime('now')
    WHERE id=@id`);
  const remover = db.prepare("DELETE FROM lancamentos WHERE id = ?");

  db.transaction(() => {
    for (const t of titulos) {
      const chave = chaveImportacao(unidadeId, t.id);
      const existente = buscar.get(chave) as Record<string, unknown> | undefined;
      if (t.situacao === "cancelado") {
        if (existente) {
          remover.run(existente.id);
          c.removidos++;
        } else ignorar(c, "cancelado no Octagym");
        continue;
      }
      const dados = {
        unidade_id: unidadeId,
        descricao: t.descricao,
        fornecedor: t.cliente,
        valor: t.valor_centavos,
        vencimento: t.vencimento,
        status: t.situacao === "pago" ? "pago" : "aberto",
        data_pagamento: t.situacao === "pago" ? t.data_pagamento : null,
        valor_pago: t.situacao === "pago" ? t.valor_pago_centavos : null,
        forma: t.forma_pagamento,
      };
      if (!existente) {
        inserir.run({ ...dados, chave, categoria_id: (t.categoria && categorias.get(t.categoria.toLowerCase())) || cfg.categoriaPadraoId });
        c.criados++;
      } else {
        const mudou =
          existente.descricao !== dados.descricao ||
          existente.fornecedor !== dados.fornecedor ||
          existente.valor_centavos !== dados.valor ||
          existente.vencimento !== dados.vencimento ||
          existente.status !== dados.status ||
          existente.data_pagamento !== dados.data_pagamento ||
          existente.valor_pago_centavos !== dados.valor_pago ||
          (dados.forma != null && existente.forma_pagamento !== dados.forma);
        if (mudou) {
          atualizar.run({ ...dados, id: existente.id });
          c.atualizados++;
        }
      }
    }
  })();
  return c;
}

// ---------- busca no Octagym ----------

export interface Diagnostico {
  quando: string;
  unidade_id: number;
  ok: boolean;
  mensagem: string;
  empresa: string | null;
  ferramentasFinanceiras: string[];
  temTitulos: boolean;
  parametrosTitulos: string[];
  argumentosUsados: string[];
  exemploBruto: unknown;
  exemploInterpretado: unknown;
  contagem?: Contagem;
}

/** Busca todos os títulos a receber do intervalo, seguindo a paginação (com limite de segurança). */
async function buscarTitulos(con: ConexaoOctagym, ferramenta: FerramentaInfo, intervalo: { inicio: string; fim: string }, limitePaginas = 50) {
  const plano = planejarArgumentos(ferramenta.inputSchema, intervalo);
  const brutos: Record<string, unknown>[] = [];
  let pagina = 1;
  let offset = 0;
  let cursor: string | null = null;
  const vistos = new Set<string>();
  for (let i = 0; i < limitePaginas; i++) {
    const args: Record<string, unknown> = { ...plano.base };
    if (plano.paginacao.tipo === "pagina") args[plano.paginacao.param!] = pagina;
    if (plano.paginacao.tipo === "offset") args[plano.paginacao.param!] = offset;
    if (plano.paginacao.tipo === "cursor" && cursor) args[plano.paginacao.param!] = cursor;
    const dados = await con.chamar(ferramenta.name, args);
    const lista = extrairLista(dados);
    // proteção contra servidor que ignora a paginação e devolve sempre a mesma página
    const novos = lista.filter((x) => {
      const id = String(x.id ?? JSON.stringify(x));
      if (vistos.has(id)) return false;
      vistos.add(id);
      return true;
    });
    brutos.push(...novos);
    const tamanho = plano.paginacao.tamanho ? Number(plano.base[plano.paginacao.tamanho]) : 0;
    if (!novos.length || plano.paginacao.tipo === "nenhuma") break;
    if (plano.paginacao.tipo === "cursor") {
      cursor = extrairCursor(dados);
      if (!cursor) break;
    } else {
      if (tamanho && lista.length < tamanho) break;
      pagina++;
      offset += lista.length;
    }
  }
  return { brutos, plano };
}

/**
 * Uma rodada para uma unidade: títulos a receber do intervalo configurado, pela chave dessa unidade.
 * Com `apenasTestar`, lê só a primeira página e não grava lançamentos.
 */
export async function executar(
  db: Database.Database,
  con: ConexaoOctagym,
  unidadeId: number,
  opcoes: { apenasTestar?: boolean; hoje?: string } = {},
): Promise<Diagnostico> {
  const cfg = lerConfig(db);
  const hoje = opcoes.hoje ?? hojeSP();
  const diag: Diagnostico = {
    quando: new Date().toISOString(),
    unidade_id: unidadeId,
    ok: false,
    mensagem: "",
    empresa: null,
    ferramentasFinanceiras: [],
    temTitulos: false,
    parametrosTitulos: [],
    argumentosUsados: [],
    exemploBruto: null,
    exemploInterpretado: null,
  };
  const ferramentas = await con.ferramentas();
  const porNome = new Map(ferramentas.map((f) => [f.name, f]));
  diag.ferramentasFinanceiras = ferramentas.map((f) => f.name).filter((n) => /financ|title|store|cash|receiv/i.test(n));
  const ftitulos = porNome.get(FERRAMENTA_TITULOS);
  diag.temTitulos = !!ftitulos;
  diag.parametrosTitulos = Object.keys(ftitulos?.inputSchema?.properties ?? {});
  if (!ftitulos) {
    diag.mensagem = `A chave não dá acesso à ferramenta ${FERRAMENTA_TITULOS}. Confira se ela tem o escopo Financeiro — leitura (finance:read) e se o plano inclui o conector MCP.`;
    return diag;
  }

  // nome da filial no Octagym, só para conferência na tela
  if (porNome.has(FERRAMENTA_LOJAS)) {
    try {
      const lojas = extrairLista(await con.chamar(FERRAMENTA_LOJAS, {}))
        .map(mapearLoja)
        .filter((l): l is { id: string; nome: string } => !!l);
      diag.empresa = lojas.map((l) => l.nome).join(", ") || null;
      registrarEmpresa(db, unidadeId, diag.empresa);
    } catch {
      /* opcional: a falha aqui não impede a sincronização */
    }
  }

  const intervalo = { inicio: somarDias(hoje, -cfg.diasPassados), fim: somarDias(hoje, cfg.diasFuturos) };
  const { brutos, plano } = await buscarTitulos(con, ftitulos, intervalo, opcoes.apenasTestar ? 1 : 50);
  diag.argumentosUsados = plano.explicacao;
  const c = novaContagem();
  c.lidos = brutos.length;
  const titulos: TituloReceber[] = [];
  for (const b of brutos) {
    const m = mapearTitulo(b);
    if (m.ok) {
      // filtro local de segurança: só o intervalo pedido
      if (m.titulo.vencimento < intervalo.inicio || m.titulo.vencimento > intervalo.fim) ignorar(c, "fora do intervalo de datas");
      else titulos.push(m.titulo);
    } else ignorar(c, m.motivo);
  }
  if (brutos.length) {
    diag.exemploBruto = mascarar(brutos[0]);
    const m = mapearTitulo(brutos[0]);
    diag.exemploInterpretado = m.ok ? { ...m.titulo, cliente: m.titulo.cliente ? "•••" : null } : m;
  }
  if (!opcoes.apenasTestar) gravarTitulos(db, unidadeId, titulos, cfg, c);
  diag.contagem = c;
  diag.ok = true;
  diag.mensagem = opcoes.apenasTestar
    ? `Conexão OK. ${brutos.length} títulos lidos na 1ª página; ${titulos.length} reconhecidos como contas a receber.`
    : `${c.criados} criados, ${c.atualizados} atualizados, ${c.removidos} removidos, ${c.ignorados} ignorados (de ${c.lidos} lidos).`;
  return diag;
}

// ---------- histórico ----------

export interface Execucao {
  id: number;
  gatilho: string;
  inicio: string;
  fim: string | null;
  ok: number | null;
  mensagem: string | null;
  lidos: number;
  criados: number;
  atualizados: number;
  removidos: number;
  ignorados: number;
}

export function iniciarExecucao(db: Database.Database, gatilho: string): number {
  return Number(db.prepare("INSERT INTO octagym_execucoes (gatilho) VALUES (?)").run(gatilho).lastInsertRowid);
}

export function concluirExecucao(db: Database.Database, id: number, ok: boolean, mensagem: string, c?: Contagem): void {
  db.prepare(`UPDATE octagym_execucoes SET fim = datetime('now'), ok = ?, mensagem = ?, lidos = ?, criados = ?, atualizados = ?, removidos = ?, ignorados = ? WHERE id = ?`).run(
    ok ? 1 : 0,
    mensagem.slice(0, 2000),
    c?.lidos ?? 0,
    c?.criados ?? 0,
    c?.atualizados ?? 0,
    c?.removidos ?? 0,
    c?.ignorados ?? 0,
    id,
  );
  // mantém só o histórico recente
  db.prepare("DELETE FROM octagym_execucoes WHERE id NOT IN (SELECT id FROM octagym_execucoes ORDER BY id DESC LIMIT 200)").run();
}

export function listarExecucoes(db: Database.Database, limite = 15): Execucao[] {
  return db.prepare("SELECT * FROM octagym_execucoes ORDER BY id DESC LIMIT ?").all(limite) as Execucao[];
}

export function ultimaExecucaoAutomatica(db: Database.Database): Execucao | undefined {
  return db.prepare("SELECT * FROM octagym_execucoes WHERE gatilho = 'automatico' ORDER BY id DESC LIMIT 1").get() as Execucao | undefined;
}

export function salvarDiagnostico(db: Database.Database, d: Diagnostico): void {
  db.prepare("INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(
    `octagym_diagnostico_${d.unidade_id}`,
    JSON.stringify(d),
  );
}

export function lerDiagnosticos(db: Database.Database): Map<number, Diagnostico> {
  const linhas = db.prepare("SELECT valor FROM configuracoes WHERE chave LIKE 'octagym_diagnostico_%'").all() as { valor: string }[];
  const m = new Map<number, Diagnostico>();
  for (const l of linhas) {
    try {
      const d = JSON.parse(l.valor) as Diagnostico;
      m.set(d.unidade_id, d);
    } catch {
      /* ignora registro corrompido */
    }
  }
  return m;
}
