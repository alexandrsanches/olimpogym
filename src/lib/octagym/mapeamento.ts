// Interpretação dos dados do conector MCP do Octagym.
//
// A documentação pública descreve as ferramentas (list_stores, list_financial_titles), mas não o
// formato exato dos parâmetros e das respostas. Por isso:
// - os argumentos são montados a partir do inputSchema que o próprio servidor devolve em tools/list;
// - os campos de cada título são lidos por uma lista de nomes prováveis;
// - um exemplo da resposta (com dados pessoais ocultos) fica guardado para a tela de diagnóstico,
//   o que permite ajustar estas listas ao formato real.

import { isDataISO } from "../datas";

type Obj = Record<string, unknown>;

export interface EsquemaFerramenta {
  type?: string;
  properties?: Record<string, { type?: string | string[]; enum?: unknown[]; format?: string; description?: string; items?: unknown }>;
  required?: string[];
}

export interface Paginacao {
  tipo: "pagina" | "offset" | "cursor" | "nenhuma";
  /** nome do parâmetro de página / offset / cursor */
  param?: string;
  /** nome do parâmetro de tamanho da página */
  tamanho?: string;
}

export interface PlanoArgumentos {
  base: Record<string, unknown>;
  paginacao: Paginacao;
  /** nomes dos parâmetros usados, para o diagnóstico */
  explicacao: string[];
}

const RE_DE = /(^|_)(from|start|since|inicio|de|after|gte|min)$|^(start|from|since|data_inicio|inicio)(_|$)/i;
const RE_ATE = /(^|_)(to|end|until|fim|ate|before|lte|max)$|^(end|to|until|data_fim|fim)(_|$)/i;
const RE_DATA = /date|data|due|venc|period|day|competenc|issue|emiss/i;

const VALORES_RECEBER = ["receivable", "receivables", "receber", "a_receber", "income", "revenue", "receita", "inflow", "in", "credit", "entrada"];

function tipos(p: { type?: string | string[] } | undefined): string[] {
  if (!p?.type) return [];
  return Array.isArray(p.type) ? p.type : [p.type];
}

/**
 * Monta os argumentos de list_financial_titles: só contas a receber, vencimento no intervalo e paginação.
 * Usa apenas parâmetros que existem no schema da ferramenta.
 */
export function planejarArgumentos(schema: EsquemaFerramenta | undefined, intervalo: { inicio: string; fim: string }, tamanhoPagina = 100): PlanoArgumentos {
  const props = schema?.properties ?? {};
  const nomes = Object.keys(props);
  const base: Record<string, unknown> = {};
  const explicacao: string[] = [];

  // tipo do título: o parâmetro com enum que contém um valor de "a receber"
  for (const n of nomes) {
    const en = props[n].enum;
    if (!Array.isArray(en)) continue;
    const valor = en.find((v) => typeof v === "string" && VALORES_RECEBER.includes(v.toLowerCase()));
    if (valor !== undefined && /type|kind|tipo|direction|natur|nature|side/i.test(n)) {
      base[n] = valor;
      explicacao.push(`${n}=${String(valor)}`);
      break;
    }
  }
  // sem enum: parâmetro booleano/texto com nome evidente
  if (!Object.keys(base).length) {
    const n = nomes.find((x) => /^(type|kind|tipo|direction)$/i.test(x) && tipos(props[x]).includes("string"));
    if (n) {
      base[n] = "receivable";
      explicacao.push(`${n}=receivable (sem lista de valores no schema)`);
    }
  }

  // intervalo de datas (preferência para vencimento)
  const datas = nomes.filter((n) => RE_DATA.test(n) || /^(from|to|start|end|since|until)$/i.test(n));
  const ordenar = (lista: string[]) => [...lista].sort((a, b) => Number(/due|venc/i.test(b)) - Number(/due|venc/i.test(a)));
  const de = ordenar(datas.filter((n) => RE_DE.test(n)))[0];
  const ate = ordenar(datas.filter((n) => RE_ATE.test(n)))[0];
  if (de) {
    base[de] = intervalo.inicio;
    explicacao.push(`${de}=${intervalo.inicio}`);
  }
  if (ate) {
    base[ate] = intervalo.fim;
    explicacao.push(`${ate}=${intervalo.fim}`);
  }

  // paginação
  const achar = (re: RegExp) => nomes.find((n) => re.test(n));
  const tam = achar(/^(page_size|pagesize|per_page|perpage|limit|size|tamanho)$/i);
  let paginacao: Paginacao = { tipo: "nenhuma" };
  const pagina = achar(/^(page|pagina|page_number)$/i);
  const offset = achar(/^(offset|skip)$/i);
  const cursor = achar(/^(cursor|after|next_cursor|page_token|starting_after)$/i);
  if (pagina) paginacao = { tipo: "pagina", param: pagina, tamanho: tam };
  else if (offset) paginacao = { tipo: "offset", param: offset, tamanho: tam };
  else if (cursor) paginacao = { tipo: "cursor", param: cursor, tamanho: tam };
  else if (tam) paginacao = { tipo: "nenhuma", tamanho: tam };
  if (tam) {
    const max = (props[tam] as { maximum?: number }).maximum;
    base[tam] = typeof max === "number" ? Math.min(max, tamanhoPagina) : tamanhoPagina;
    explicacao.push(`${tam}=${base[tam]}`);
  }
  if (paginacao.param) explicacao.push(`paginação por ${paginacao.tipo} (${paginacao.param})`);
  return { base, paginacao, explicacao };
}

/** Converte o resultado de uma ferramenta MCP (structuredContent ou texto JSON) em objeto. */
export function lerResultado(resultado: { content?: unknown; structuredContent?: unknown; isError?: boolean }): unknown {
  if (resultado.structuredContent !== undefined && resultado.structuredContent !== null) return resultado.structuredContent;
  const partes = Array.isArray(resultado.content) ? resultado.content : [];
  const textos = partes.filter((c): c is { type: "text"; text: string } => !!c && (c as Obj).type === "text" && typeof (c as Obj).text === "string").map((c) => c.text);
  for (const t of textos) {
    try {
      return JSON.parse(t);
    } catch {
      /* não é JSON; tenta o próximo */
    }
  }
  return textos.join("\n");
}

/** Encontra a lista principal de itens dentro da resposta. */
export function extrairLista(dados: unknown): Obj[] {
  if (Array.isArray(dados)) return dados.filter((x): x is Obj => !!x && typeof x === "object");
  if (!dados || typeof dados !== "object") return [];
  const o = dados as Obj;
  for (const chave of ["titles", "financial_titles", "items", "data", "results", "rows", "records", "stores", "list"]) {
    const v = o[chave];
    if (Array.isArray(v)) return v.filter((x): x is Obj => !!x && typeof x === "object");
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const interno = extrairLista(v);
      if (interno.length) return interno;
    }
  }
  // primeira propriedade que for uma lista de objetos
  for (const v of Object.values(o)) if (Array.isArray(v) && v.length && typeof v[0] === "object") return v as Obj[];
  return [];
}

/** Próximo cursor, se a resposta trouxer um. */
export function extrairCursor(dados: unknown): string | null {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;
  const o = dados as Obj;
  const pg = (o.pagination ?? o.meta ?? o.page_info ?? {}) as Obj;
  for (const k of ["next_cursor", "nextCursor", "cursor", "next", "end_cursor"]) {
    const v = o[k] ?? pg[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

/** Lê um caminho como "client.full_name" ou o primeiro de vários caminhos que existir. */
function ler(o: Obj, ...caminhos: string[]): unknown {
  for (const c of caminhos) {
    let atual: unknown = o;
    for (const parte of c.split(".")) {
      if (!atual || typeof atual !== "object") {
        atual = undefined;
        break;
      }
      atual = (atual as Obj)[parte];
    }
    if (atual !== undefined && atual !== null && atual !== "") return atual;
  }
  return undefined;
}

function texto(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") return texto((v as Obj).name ?? (v as Obj).full_name ?? (v as Obj).nome ?? (v as Obj).label);
  return null;
}

/** Valor em centavos: campos *_cents são inteiros; os demais são reais (número ou texto). */
function centavos(o: Obj, camposCentavos: string[], camposReais: string[]): number | null {
  const c = ler(o, ...camposCentavos);
  if (c !== undefined) {
    const n = Number(c);
    if (Number.isFinite(n)) return Math.round(n);
  }
  const r = ler(o, ...camposReais);
  if (r !== undefined) {
    if (typeof r === "number") return Math.round(r * 100);
    if (typeof r === "string") {
      const s = r.replace(/[^\d,.-]/g, "");
      const norm = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
      const n = Number(norm);
      if (Number.isFinite(n)) return Math.round(n * 100);
    }
    if (typeof r === "object" && r) {
      // ex.: { amount: 12990, currency: "BRL" } ou { value: "129.90" }
      return centavos(r as Obj, ["cents", "amount_cents", "value_cents"], ["value", "amount"]);
    }
  }
  return null;
}

/** Data ISO (AAAA-MM-DD) a partir de "2026-03-05", "2026-03-05T10:00:00Z" ou "05/03/2026". */
function data(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m && isDataISO(m[1])) return m[1];
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) {
    const iso = `${br[3]}-${br[2]}-${br[1]}`;
    return isDataISO(iso) ? iso : null;
  }
  return null;
}

export interface TituloReceber {
  id: string;
  store_id: string | null;
  descricao: string;
  cliente: string | null;
  categoria: string | null;
  valor_centavos: number;
  vencimento: string;
  situacao: "aberto" | "pago" | "cancelado";
  data_pagamento: string | null;
  valor_pago_centavos: number | null;
  forma_pagamento: string | null;
}

export type ResultadoMapeamento = { ok: true; titulo: TituloReceber } | { ok: false; motivo: string };

const STATUS_PAGO = /^(paid|pago|paga|settled|liquidad[oa]|received|recebid[oa]|quitad[oa]|baixad[oa]|conciliad[oa]|reconciled|completed|succeeded)$/i;
const STATUS_CANCELADO = /^(cancel+ed|cancelad[oa]|void|voided|refunded|estornad[oa]|deleted|excluid[oa])$/i;
const TIPO_PAGAR = /^(payable|payables|pagar|a_pagar|expense|despesa|outflow|out|debit|saida)$/i;

/** Converte um título do Octagym em conta a receber do sistema. */
export function mapearTitulo(o: Obj): ResultadoMapeamento {
  const id = texto(ler(o, "id", "title_id", "uuid", "financial_title_id"));
  if (!id) return { ok: false, motivo: "título sem id" };

  const tipo = texto(ler(o, "type", "kind", "direction", "nature", "tipo", "title_type"));
  if (tipo && TIPO_PAGAR.test(tipo)) return { ok: false, motivo: "conta a pagar (ignorada)" };

  const valor = centavos(
    o,
    ["amount_cents", "value_cents", "total_cents", "original_amount_cents", "gross_amount_cents", "price_cents"],
    ["amount", "value", "total", "original_amount", "gross_amount", "valor"],
  );
  if (valor == null) return { ok: false, motivo: "título sem valor reconhecido" };

  const vencimento = data(ler(o, "due_date", "due_at", "vencimento", "data_vencimento", "expected_date", "competence_date", "date", "issue_date"));
  if (!vencimento) return { ok: false, motivo: "título sem data de vencimento reconhecida" };

  const status = texto(ler(o, "status", "situation", "situacao", "state"))?.toLowerCase() ?? "";
  let dataPagamento = data(ler(o, "paid_at", "paid_date", "payment_date", "settled_at", "settlement_date", "liquidated_at", "data_pagamento", "received_at"));
  let pagoCentavos = centavos(
    o,
    ["paid_amount_cents", "amount_paid_cents", "paid_cents", "settled_amount_cents", "received_amount_cents"],
    ["paid_amount", "amount_paid", "settled_amount", "received_amount", "valor_pago"],
  );

  let situacao: TituloReceber["situacao"] = "aberto";
  if (STATUS_CANCELADO.test(status)) situacao = "cancelado";
  else if (STATUS_PAGO.test(status)) situacao = "pago";
  else if (!status && dataPagamento) situacao = "pago";
  // pagamento parcial: continua em aberto (o sistema registra a baixa quando quitar)
  if (situacao === "pago") {
    dataPagamento = dataPagamento ?? vencimento;
    pagoCentavos = pagoCentavos ?? valor;
  } else {
    dataPagamento = null;
    pagoCentavos = null;
  }

  const cliente = texto(
    ler(o, "counterparty_name", "counterparty", "client.full_name", "client", "customer_name", "customer", "member_name", "member.client.full_name", "member", "payer_name", "payer", "contact_name"),
  );
  const descricao = texto(ler(o, "description", "descricao", "title", "name", "memo", "history", "historico", "reference")) ?? (cliente ? `Recebimento – ${cliente}` : "Recebimento Octagym");

  return {
    ok: true,
    titulo: {
      id,
      store_id: texto(ler(o, "store_id", "store.id", "unit_id", "branch_id", "filial_id", "unidade_id")),
      descricao: descricao.slice(0, 200),
      cliente: cliente?.slice(0, 200) ?? null,
      categoria: texto(ler(o, "category.name", "category_name", "categoria", "financial_category.name", "account_name")),
      valor_centavos: Math.abs(valor),
      vencimento,
      situacao,
      data_pagamento: dataPagamento,
      valor_pago_centavos: pagoCentavos == null ? null : Math.abs(pagoCentavos),
      forma_pagamento: texto(ler(o, "payment_method", "method", "forma_pagamento", "payment_type"))?.slice(0, 50) ?? null,
    },
  };
}

/** Unidade (filial) do Octagym. */
export function mapearLoja(o: Obj): { id: string; nome: string } | null {
  const id = texto(ler(o, "id", "store_id", "uuid"));
  if (!id) return null;
  return { id, nome: texto(ler(o, "name", "nome", "display_name", "title")) ?? id };
}

const CAMPOS_PESSOAIS = /name|nome|email|phone|telefone|cpf|cnpj|document|documento|address|endereco|birth|nascimento|pix|bank|banco|account_number/i;

/** Cópia do objeto com dados pessoais ocultos, para o diagnóstico. */
export function mascarar(v: unknown, chave = ""): unknown {
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => mascarar(x));
  if (v && typeof v === "object") {
    const r: Obj = {};
    for (const [k, x] of Object.entries(v as Obj)) {
      // nomes de categoria, plano e loja não são pessoais
      const pessoal = CAMPOS_PESSOAIS.test(k) && !/categor|plan|store|loja|account_name|method/i.test(chave + "." + k);
      r[k] = pessoal && (typeof x === "string" || typeof x === "number") ? "•••" : mascarar(x, k);
    }
    return r;
  }
  return v;
}
