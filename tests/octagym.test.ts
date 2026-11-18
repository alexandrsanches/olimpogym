import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { abrirBanco } from "@/lib/db";
import { listarLancamentos } from "@/lib/lancamentos";
import { conectar } from "@/lib/octagym/cliente";
import { extrairLista, lerResultado, mapearTitulo, mascarar, planejarArgumentos } from "@/lib/octagym/mapeamento";
import { executar, gravarTitulos, lerConfig, ligarLoja, listarLojas, salvarConfig } from "@/lib/octagym/sincronizacao";

describe("interpretação dos títulos", () => {
  it("monta os argumentos a partir do schema da ferramenta", () => {
    const p = planejarArgumentos(
      {
        type: "object",
        properties: {
          type: { type: "string", enum: ["payable", "receivable"] },
          due_date_from: { type: "string" },
          due_date_to: { type: "string" },
          issue_date_from: { type: "string" },
          page: { type: "integer" },
          page_size: { type: "integer", maximum: 50 } as never,
        },
      },
      { inicio: "2026-01-01", fim: "2026-12-31" },
    );
    expect(p.base).toEqual({ type: "receivable", due_date_from: "2026-01-01", due_date_to: "2026-12-31", page_size: 50 });
    expect(p.paginacao).toEqual({ tipo: "pagina", param: "page", tamanho: "page_size" });

    const q = planejarArgumentos({ properties: { kind: { type: "string", enum: ["a_pagar", "a_receber"] }, start_date: { type: "string" }, end_date: { type: "string" }, limit: { type: "number" }, offset: { type: "number" } } }, { inicio: "2026-01-01", fim: "2026-02-01" });
    expect(q.base).toMatchObject({ kind: "a_receber", start_date: "2026-01-01", end_date: "2026-02-01", limit: 100 });
    expect(q.paginacao.tipo).toBe("offset");
    // schema vazio não quebra
    expect(planejarArgumentos(undefined, { inicio: "a", fim: "b" }).base).toEqual({});
  });

  it("reconhece formatos diferentes de título", () => {
    const a = mapearTitulo({ id: "t1", type: "receivable", amount_cents: 12990, due_date: "2026-03-05", status: "paid", paid_at: "2026-03-06T10:00:00Z", description: "Mensalidade março", client: { full_name: "Ana" }, store_id: "s1", payment_method: "pix" });
    expect(a).toEqual({
      ok: true,
      titulo: { id: "t1", store_id: "s1", descricao: "Mensalidade março", cliente: "Ana", categoria: null, valor_centavos: 12990, vencimento: "2026-03-05", situacao: "pago", data_pagamento: "2026-03-06", valor_pago_centavos: 12990, forma_pagamento: "pix" },
    });
    const b = mapearTitulo({ id: 7, valor: "1.250,50", vencimento: "10/04/2026", situacao: "aberto", store: { id: "s2" }, category: { name: "Planos" } });
    expect(b.ok && b.titulo).toMatchObject({ id: "7", valor_centavos: 125050, vencimento: "2026-04-10", situacao: "aberto", store_id: "s2", categoria: "Planos", descricao: "Recebimento Octagym" });
    expect(mapearTitulo({ id: "x", amount: 99.9, due_date: "2026-01-01", status: "cancelled" }).ok && mapearTitulo({ id: "x", amount: 99.9, due_date: "2026-01-01", status: "cancelled" })).toMatchObject({ titulo: { situacao: "cancelado", valor_centavos: 9990 } });
    expect(mapearTitulo({ id: "p", type: "payable", amount_cents: 1, due_date: "2026-01-01" })).toEqual({ ok: false, motivo: "conta a pagar (ignorada)" });
    expect(mapearTitulo({ id: "s", amount_cents: 1 })).toEqual({ ok: false, motivo: "título sem data de vencimento reconhecida" });
    // pagamento parcial continua em aberto
    expect(mapearTitulo({ id: "pp", amount_cents: 1000, paid_amount_cents: 400, due_date: "2026-01-01", status: "partially_paid" }).ok).toBe(true);
    const pp = mapearTitulo({ id: "pp", amount_cents: 1000, paid_amount_cents: 400, due_date: "2026-01-01", status: "partially_paid" });
    expect(pp.ok && pp.titulo.situacao).toBe("aberto");
  });

  it("lê a lista dentro de respostas variadas e oculta dados pessoais", () => {
    expect(extrairLista({ success: true, data: { titles: [{ id: 1 }] } })).toEqual([{ id: 1 }]);
    expect(extrairLista([{ id: 2 }])).toEqual([{ id: 2 }]);
    expect(lerResultado({ content: [{ type: "text", text: '{"items":[{"id":3}]}' }] })).toEqual({ items: [{ id: 3 }] });
    expect(lerResultado({ structuredContent: { a: 1 }, content: [] })).toEqual({ a: 1 });
    expect(mascarar({ id: 1, client: { full_name: "Ana", email: "a@b.c" }, category: { name: "Planos" }, amount_cents: 10 })).toEqual({
      id: 1,
      client: { full_name: "•••", email: "•••" },
      category: { name: "Planos" },
      amount_cents: 10,
    });
  });
});

describe("gravação das contas a receber", () => {
  const base = { store_id: "s1", descricao: "Mensalidade", cliente: "Ana", categoria: null, valor_centavos: 10000, vencimento: "2026-03-10", data_pagamento: null, valor_pago_centavos: null, forma_pagamento: null } as const;

  it("cria, atualiza, preserva a categoria escolhida e remove cancelados", () => {
    const db = abrirBanco(":memory:");
    db.prepare("INSERT INTO octagym_lojas (store_id, nome, unidade_id) VALUES ('s1', 'Centro', 2), ('s9', 'Sem ligação', NULL)").run();
    const cfg = { ...lerConfig(db), categoriaPadraoId: 11 };
    let c = gravarTitulos(db, [{ ...base, id: "a", situacao: "aberto" }, { ...base, id: "b", store_id: "s9", situacao: "aberto" }, { ...base, id: "c", store_id: null, situacao: "aberto" }], cfg);
    expect(c).toMatchObject({ criados: 1, ignorados: 2 });
    let [l] = listarLancamentos(db, { unidades: [1, 2] });
    expect(l).toMatchObject({ unidade_id: 2, tipo: "receita", origem: "octagym", status: "aberto", categoria_id: 11, valor_centavos: 10000 });

    // usuário muda a categoria; Octagym marca como pago
    db.prepare("UPDATE lancamentos SET categoria_id = 12, observacao = 'ok' WHERE id = ?").run(l.id);
    c = gravarTitulos(db, [{ ...base, id: "a", situacao: "pago", data_pagamento: "2026-03-11", valor_pago_centavos: 10000 }], cfg);
    expect(c.atualizados).toBe(1);
    [l] = listarLancamentos(db, { unidades: [1, 2] });
    expect(l).toMatchObject({ status: "pago", data_pagamento: "2026-03-11", categoria_id: 12, observacao: "ok" });

    // sem mudança: nada a atualizar
    expect(gravarTitulos(db, [{ ...base, id: "a", situacao: "pago", data_pagamento: "2026-03-11", valor_pago_centavos: 10000 }], cfg).atualizados).toBe(0);

    // unidade padrão para títulos sem filial
    expect(gravarTitulos(db, [{ ...base, id: "c", store_id: null, situacao: "aberto" }], { ...cfg, unidadePadraoId: 1 }).criados).toBe(1);

    // cancelado no Octagym: some daqui
    expect(gravarTitulos(db, [{ ...base, id: "a", situacao: "cancelado" }], cfg).removidos).toBe(1);
    expect(listarLancamentos(db, { unidades: [1, 2] }).map((x) => x.import_chave)).toEqual(["octagym:c"]);
  });
});

// ---------- servidor MCP falso, no formato documentado pelo Octagym ----------

const CHAVE = "og_live_teste";
const TITULOS = Array.from({ length: 7 }, (_, i) => ({
  id: `tit-${i + 1}`,
  type: i === 6 ? "payable" : "receivable",
  amount_cents: 10000 + i,
  due_date: `2026-03-${String(10 + i).padStart(2, "0")}`,
  status: i % 2 ? "paid" : "open",
  paid_at: i % 2 ? `2026-03-${String(10 + i).padStart(2, "0")}T12:00:00Z` : null,
  description: `Mensalidade ${i + 1}`,
  counterparty: { name: `Aluno ${i + 1}` },
  store_id: i < 4 ? "loja-centro" : "loja-norte",
}));
let chamadas: Record<string, unknown>[] = [];

function criarServidorFalso() {
  const servidor = new McpServer({ name: "octagym-falso", version: "1.0.0" });
  servidor.registerTool("list_stores", { description: "Unidades (filiais) da empresa.", inputSchema: {} }, async () => ({
    content: [{ type: "text", text: JSON.stringify({ stores: [{ id: "loja-centro", name: "Olimpo Centro" }, { id: "loja-norte", name: "Olimpo Norte" }] }) }],
  }));
  servidor.registerTool(
    "list_financial_titles",
    {
      description: "Contas a pagar e a receber.",
      inputSchema: { type: z.enum(["payable", "receivable"]).optional(), due_date_from: z.string().optional(), due_date_to: z.string().optional(), page: z.number().optional(), page_size: z.number().max(3).optional() },
    },
    async (args) => {
      chamadas.push(args);
      const filtrados = TITULOS.filter((t) => (!args.type || t.type === args.type) && (!args.due_date_from || t.due_date >= args.due_date_from) && (!args.due_date_to || t.due_date <= args.due_date_to));
      const tam = args.page_size ?? 20;
      const pagina = args.page ?? 1;
      return { content: [{ type: "text", text: JSON.stringify({ data: filtrados.slice((pagina - 1) * tam, pagina * tam), pagination: { page: pagina, total: filtrados.length } }) }] };
    },
  );
  servidor.registerTool("get_dre", { description: "DRE", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "{}" }] }));
  return servidor;
}

let httpServer: http.Server;
let url = "";

beforeAll(async () => {
  httpServer = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${CHAVE}`) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid api key" }));
      return;
    }
    const corpo = await new Promise<string>((ok) => {
      let s = "";
      req.on("data", (d) => (s += d));
      req.on("end", () => ok(s));
    });
    // modo sem sessão: um servidor/transporte por requisição
    const servidor = criarServidorFalso();
    const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transporte.close();
      servidor.close();
    });
    await servidor.connect(transporte);
    await transporte.handleRequest(req, res, corpo ? JSON.parse(corpo) : undefined);
  });
  await new Promise<void>((ok) => httpServer.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/api/mcp/v1`;
});

afterAll(() => new Promise<void>((ok) => httpServer.close(() => ok())));

describe("conexão e sincronização com o conector MCP", () => {
  it("recusa chave errada com mensagem clara", async () => {
    await expect(conectar("og_live_errada", url)).rejects.toThrow(/Chave recusada/);
    await expect(conectar("", url)).rejects.toThrow(/não configurada/);
  });

  it("testa, liga as filiais e sincroniza só as contas a receber, com paginação", async () => {
    const db = abrirBanco(":memory:");
    salvarConfig(db, { ...lerConfig(db), diasPassados: 30, diasFuturos: 30 });
    const con = await conectar(CHAVE, url);
    try {
      // teste: só lê a 1ª página, registra filiais e não grava lançamentos
      chamadas = [];
      const teste = await executar(db, con, { apenasTestar: true, hoje: "2026-03-15" });
      expect(teste.ok).toBe(true);
      expect(teste.ferramentasFinanceiras).toEqual(expect.arrayContaining(["list_financial_titles", "list_stores"]));
      expect(teste.argumentosUsados).toEqual(expect.arrayContaining(["type=receivable", "due_date_from=2026-02-13", "due_date_to=2026-04-14"]));
      expect(teste.exemploBruto).toMatchObject({ counterparty: { name: "•••" } });
      expect(listarLancamentos(db, { unidades: [1, 2] })).toHaveLength(0);
      expect(listarLojas(db).map((l) => l.nome)).toEqual(["Olimpo Centro", "Olimpo Norte"]);
      expect(chamadas).toHaveLength(1);

      ligarLoja(db, "loja-centro", 1);
      ligarLoja(db, "loja-norte", 2);
      chamadas = [];
      const d = await executar(db, con, { hoje: "2026-03-15" });
      expect(d.contagem).toMatchObject({ lidos: 6, criados: 6, atualizados: 0, ignorados: 0 });
      expect(chamadas.map((c) => c.page)).toEqual([1, 2, 3]); // 6 títulos em páginas de 3 (máximo do schema); a 3ª vem vazia e encerra
      const l = listarLancamentos(db, { unidades: [1, 2] });
      expect(l.filter((x) => x.unidade_id === 1)).toHaveLength(4);
      expect(l.filter((x) => x.status === "pago")).toHaveLength(3);
      expect(l[1]).toMatchObject({ fornecedor: "Aluno 2", data_pagamento: "2026-03-11", valor_pago_centavos: 10001 });

      // segunda rodada: nada muda
      const d2 = await executar(db, con, { hoje: "2026-03-15" });
      expect(d2.contagem).toMatchObject({ criados: 0, atualizados: 0 });
    } finally {
      await con.fechar();
    }
  });
});
