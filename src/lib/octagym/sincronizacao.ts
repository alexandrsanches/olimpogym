import type Database from "better-sqlite3";
import { hoje as hojeSP, somarDias } from "../datas";
import type { ConexaoOctagym, FerramentaInfo } from "./cliente";
import { extrairCursor, extrairLista, mapearLoja, mapearTitulo, mascarar, planejarArgumentos, type TituloReceber } from "./mapeamento";

export const FERRAMENTA_TITULOS = "list_financial_titles";
export const FERRAMENTA_LOJAS = "list_stores";

// ---------- configurações (tabela configuracoes) ----------

export interface ConfigOctagym {
  ativo: boolean;
  intervaloMin: number;
  diasPassados: number;
  diasFuturos: number;
  categoriaPadraoId: number | null;
  /** unidade usada para títulos sem filial ou de filial não ligada (null = ignorar esses títulos) */
  unidadePadraoId: number | null;
}

const PADRAO: ConfigOctagym = { ativo: false, intervaloMin: 15, diasPassados: 90, diasFuturos: 120, categoriaPadraoId: null, unidadePadraoId: null };

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
    unidadePadraoId: n("octagym_unidade_padrao", null),
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
    up.run("octagym_unidade_padrao", c.unidadePadraoId == null ? "" : String(c.unidadePadraoId));
  })();
}

// ---------- lojas (filiais) ----------

export interface Loja {
  store_id: string;
  nome: string;
  unidade_id: number | null;
}

export function listarLojas(db: Database.Database): Loja[] {
  return db.prepare("SELECT store_id, nome, unidade_id FROM octagym_lojas ORDER BY nome").all() as Loja[];
}

export function ligarLoja(db: Database.Database, storeId: string, unidadeId: number | null): void {
  db.prepare("UPDATE octagym_lojas SET unidade_id = ?, atualizado_em = datetime('now') WHERE store_id = ?").run(unidadeId, storeId);
}

function registrarLojas(db: Database.Database, lojas: { id: string; nome: string }[]): void {
  const up = db.prepare(`INSERT INTO octagym_lojas (store_id, nome) VALUES (?, ?)
    ON CONFLICT(store_id) DO UPDATE SET nome = excluded.nome, atualizado_em = datetime('now')`);
  db.transaction(() => lojas.forEach((l) => up.run(l.id, l.nome)))();
}

/** Se houver tantas lojas quanto unidades e nenhuma ligação ainda, liga pela ordem do nome. Só sugere; o admin pode mudar. */
function sugerirLigacoes(db: Database.Database): void {
  const lojas = listarLojas(db);
  if (!lojas.length || lojas.some((l) => l.unidade_id != null)) return;
  const unidades = db.prepare("SELECT id FROM unidades WHERE ativo = 1 ORDER BY id").all() as { id: number }[];
  if (lojas.length === 1 && unidades.length >= 1) ligarLoja(db, lojas[0].store_id, unidades[0].id);
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

function novaContagem(): Contagem {
  return { lidos: 0, criados: 0, atualizados: 0, removidos: 0, ignorados: 0, motivosIgnorados: {} };
}

function ignorar(c: Contagem, motivo: string) {
  c.ignorados++;
  c.motivosIgnorados[motivo] = (c.motivosIgnorados[motivo] ?? 0) + 1;
}

/**
 * Cria ou atualiza as receitas a partir dos títulos do Octagym.
 * O Octagym é a fonte de verdade para valor, datas, status, descrição e cliente; categoria,
 * observação e comprovante definidos no sistema são preservados. Título cancelado no Octagym é removido.
 */
export function gravarTitulos(db: Database.Database, titulos: TituloReceber[], cfg: ConfigOctagym, c: Contagem = novaContagem()): Contagem {
  const lojas = new Map(listarLojas(db).map((l) => [l.store_id, l.unidade_id]));
  const unidadesAtivas = new Set((db.prepare("SELECT id FROM unidades").all() as { id: number }[]).map((u) => u.id));
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
    UPDATE lancamentos SET unidade_id=@unidade_id, descricao=@descricao, fornecedor=@fornecedor, valor_centavos=@valor,
      vencimento=@vencimento, status=@status, data_pagamento=@data_pagamento, valor_pago_centavos=@valor_pago,
      forma_pagamento=COALESCE(@forma, forma_pagamento), atualizado_em=datetime('now')
    WHERE id=@id`);
  const remover = db.prepare("DELETE FROM lancamentos WHERE id = ?");

  db.transaction(() => {
    for (const t of titulos) {
      const chave = `octagym:${t.id}`;
      const existente = buscar.get(chave) as Record<string, unknown> | undefined;
      if (t.situacao === "cancelado") {
        if (existente) {
          remover.run(existente.id);
          c.removidos++;
        } else ignorar(c, "cancelado no Octagym");
        continue;
      }
      let unidade = t.store_id ? lojas.get(t.store_id) ?? null : null;
      if (unidade == null) unidade = cfg.unidadePadraoId;
      if (unidade == null || !unidadesAtivas.has(unidade)) {
        ignorar(c, t.store_id ? "filial do Octagym sem unidade ligada" : "título sem filial e sem unidade padrão");
        continue;
      }
      const dados = {
        unidade_id: unidade,
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
          existente.unidade_id !== dados.unidade_id ||
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
  ok: boolean;
  mensagem: string;
  ferramentasFinanceiras: string[];
  temTitulos: boolean;
  temLojas: boolean;
  parametrosTitulos: string[];
  argumentosUsados: string[];
  lojas: { id: string; nome: string }[];
  exemploBruto: unknown;
  exemploInterpretado: unknown;
  contagem?: Omit<Contagem, "motivosIgnorados"> & { motivosIgnorados: Record<string, number> };
}

async function buscarLojas(con: ConexaoOctagym): Promise<{ id: string; nome: string }[]> {
  const dados = await con.chamar(FERRAMENTA_LOJAS, {});
  return extrairLista(dados)
    .map(mapearLoja)
    .filter((l): l is { id: string; nome: string } => !!l);
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
 * Uma rodada completa: lojas + títulos a receber do intervalo configurado.
 * Com `apenasTestar`, não grava lançamentos (só lojas e diagnóstico).
 */
export async function executar(
  db: Database.Database,
  con: ConexaoOctagym,
  opcoes: { apenasTestar?: boolean; hoje?: string } = {},
): Promise<Diagnostico> {
  const cfg = lerConfig(db);
  const hoje = opcoes.hoje ?? hojeSP();
  const diag: Diagnostico = {
    quando: new Date().toISOString(),
    ok: false,
    mensagem: "",
    ferramentasFinanceiras: [],
    temTitulos: false,
    temLojas: false,
    parametrosTitulos: [],
    argumentosUsados: [],
    lojas: [],
    exemploBruto: null,
    exemploInterpretado: null,
  };
  const ferramentas = await con.ferramentas();
  const porNome = new Map(ferramentas.map((f) => [f.name, f]));
  diag.ferramentasFinanceiras = ferramentas.map((f) => f.name).filter((n) => /financ|title|store|cash|receiv/i.test(n));
  const ftitulos = porNome.get(FERRAMENTA_TITULOS);
  diag.temTitulos = !!ftitulos;
  diag.temLojas = porNome.has(FERRAMENTA_LOJAS);
  diag.parametrosTitulos = Object.keys(ftitulos?.inputSchema?.properties ?? {});
  if (!ftitulos) {
    diag.mensagem = `A chave não dá acesso à ferramenta ${FERRAMENTA_TITULOS}. Confira se ela tem o escopo Financeiro — leitura (finance:read) e se o plano inclui o conector MCP.`;
    return diag;
  }

  if (diag.temLojas) {
    diag.lojas = await buscarLojas(con);
    registrarLojas(db, diag.lojas);
    sugerirLigacoes(db);
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
  if (!opcoes.apenasTestar) gravarTitulos(db, titulos, cfg, c);
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
  db.prepare("INSERT INTO configuracoes (chave, valor) VALUES ('octagym_diagnostico', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(JSON.stringify(d));
}

export function lerDiagnostico(db: Database.Database): Diagnostico | null {
  const r = db.prepare("SELECT valor FROM configuracoes WHERE chave = 'octagym_diagnostico'").get() as { valor: string } | undefined;
  try {
    return r ? (JSON.parse(r.valor) as Diagnostico) : null;
  } catch {
    return null;
  }
}
