import { describe, expect, it } from "vitest";
import { abrirBanco } from "@/lib/db";
import { parseDataFlexivel, somarMeses } from "@/lib/datas";
import { parseValor } from "@/lib/money";
import {
  atualizarLancamento,
  criarLancamento,
  darBaixa,
  desfazerLote,
  excluirLancamento,
  importarReceitas,
  listarCategorias,
  listarLancamentos,
  reabrir,
  renomearCategoria,
} from "@/lib/lancamentos";
import { definirSaldoInicial, fluxoDiario, pendencias, porCategoria, projecoes, resumoPeriodo, saldoRealizadoAte } from "@/lib/fluxo";
import { gerarCSV, interpretarRelatorio, lerCSV } from "@/lib/planilha";
import { atualizarUsuario, buscarParaLogin, criarUsuario, redefinirSenha, trocarPropriaSenha, unidadesDoUsuario } from "@/lib/usuarios";
import { conferirSenha } from "@/lib/senhas";

const novoBanco = () => abrirBanco(":memory:");
const U = [1, 2];

describe("valores e datas", () => {
  it("entende valores no formato brasileiro e americano", () => {
    expect(parseValor("1.250,00")).toBe(125000);
    expect(parseValor("R$ 99,9")).toBe(9990);
    expect(parseValor("1250.5")).toBe(125050);
    expect(parseValor("1.250")).toBe(125000);
    expect(parseValor("1,250.75")).toBe(125075);
    expect(parseValor("-30,00")).toBe(-3000);
    expect(parseValor("abc")).toBeNull();
    expect(parseValor("")).toBeNull();
  });

  it("soma meses respeitando o último dia do mês", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2026-01-31", 2, 31)).toBe("2026-03-31");
    expect(somarMeses("2026-11-15", 2)).toBe("2027-01-15");
  });

  it("aceita datas em vários formatos", () => {
    expect(parseDataFlexivel("05/03/2026")).toBe("2026-03-05");
    expect(parseDataFlexivel("5/3/26")).toBe("2026-03-05");
    expect(parseDataFlexivel("2026-03-05T10:00:00")).toBe("2026-03-05");
    expect(parseDataFlexivel("31/02/2026")).toBeNull();
  });
});

describe("lançamentos", () => {
  it("cria série recorrente e edita as parcelas futuras", () => {
    const db = novoBanco();
    const ids = criarLancamento(db, { unidade_id: 1, tipo: "despesa", descricao: "Aluguel", valor_centavos: 500000, vencimento: "2026-01-31" }, { meses: 3 });
    expect(ids).toHaveLength(3);
    const venc = listarLancamentos(db, { unidades: [1, 2] }).map((l) => l.vencimento);
    expect(venc).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);

    darBaixa(db, ids[1], { data_pagamento: "2026-02-27" });
    atualizarLancamento(db, ids[0], { unidade_id: 1, tipo: "despesa", descricao: "Aluguel sala", valor_centavos: 550000, vencimento: "2026-01-31" }, "futuros");
    const l = listarLancamentos(db, { unidades: [1, 2] });
    expect(l.map((x) => x.valor_centavos)).toEqual([550000, 500000, 550000]); // a parcela já paga não muda
    expect(l[2].descricao).toBe("Aluguel sala");

    expect(excluirLancamento(db, ids[0], "futuros")).toEqual([]);
    expect(listarLancamentos(db, { unidades: [1, 2] }).map((x) => x.id)).toEqual([ids[1]]); // a paga fica
  });

  it("renomeia categoria sem duplicar nome do mesmo tipo", () => {
    const db = novoBanco();
    const cats = listarCategorias(db, "despesa");
    const luz = cats.find((c) => c.nome === "Energia / Água")!.id;
    const [id] = criarLancamento(db, { unidade_id: 1, tipo: "despesa", descricao: "Luz", categoria_id: luz, valor_centavos: 100, vencimento: "2026-03-01" });
    expect(renomearCategoria(db, luz, "Aluguel")).toMatch(/Já existe/);
    expect(renomearCategoria(db, luz, "  ")).toMatch(/Informe/);
    expect(renomearCategoria(db, luz, "Contas de consumo")).toBeNull();
    expect(listarLancamentos(db, { unidades: U }).find((l) => l.id === id)!.categoria_nome).toBe("Contas de consumo");
    // mesmo nome em tipo diferente é permitido
    expect(renomearCategoria(db, luz, "Mensalidades")).toBeNull();
  });

  it("dar baixa e reabrir", () => {
    const db = novoBanco();
    const [id] = criarLancamento(db, { unidade_id: 1, tipo: "despesa", descricao: "Luz", valor_centavos: 30000, vencimento: "2026-03-10" });
    darBaixa(db, id, { data_pagamento: "2026-03-12", valor_pago_centavos: 31050, forma_pagamento: "Pix" });
    let [l] = listarLancamentos(db, { unidades: [1, 2] });
    expect(l.status).toBe("pago");
    expect(l.valor_pago_centavos).toBe(31050);
    reabrir(db, id);
    [l] = listarLancamentos(db, { unidades: [1, 2] });
    expect(l.status).toBe("aberto");
    expect(l.data_pagamento).toBeNull();
  });
});

describe("previsto x realizado", () => {
  function cenario() {
    const db = novoBanco();
    definirSaldoInicial(db, { unidade_id: 1, valor_centavos: 100000, data: "2026-02-28" });
    const cat = listarCategorias(db, "despesa").find((c) => c.nome === "Aluguel")!.id;
    const [aluguel] = criarLancamento(db, { unidade_id: 1, tipo: "despesa", descricao: "Aluguel", categoria_id: cat, valor_centavos: 50000, vencimento: "2026-03-05" });
    criarLancamento(db, { unidade_id: 1, tipo: "despesa", descricao: "Luz", valor_centavos: 10000, vencimento: "2026-03-20" });
    const [mens] = criarLancamento(db, { unidade_id: 1, tipo: "receita", descricao: "Mensalidades", valor_centavos: 200000, vencimento: "2026-03-10" });
    criarLancamento(db, { unidade_id: 1, tipo: "receita", descricao: "Plano anual", valor_centavos: 80000, vencimento: "2026-04-02" });
    // aluguel de março pago em atraso, em abril; mensalidades recebidas em março
    darBaixa(db, aluguel, { data_pagamento: "2026-04-01" });
    darBaixa(db, mens, { data_pagamento: "2026-03-11", valor_pago_centavos: 195000 });
    return db;
  }

  it("resume o mês", () => {
    const db = cenario();
    const r = resumoPeriodo(db, U, "2026-03-01", "2026-03-31");
    expect(r.previsto).toEqual({ receitas: 200000, despesas: 60000, saldo: 140000 });
    expect(r.realizado).toEqual({ receitas: 195000, despesas: 0, saldo: 195000 });
    expect(r.emAberto.despesas).toBe(10000);
    const abr = resumoPeriodo(db, U, "2026-04-01", "2026-04-30");
    expect(abr.realizado.despesas).toBe(50000);
    expect(porCategoria(db, U, "despesa", "2026-03-01", "2026-03-31")[0]).toEqual({ categoria: "Aluguel", previsto: 50000, realizado: 0 });
  });

  it("separa as unidades e consolida", () => {
    const db = cenario();
    definirSaldoInicial(db, { unidade_id: 2, valor_centavos: 50000, data: "2026-02-28" });
    const [x] = criarLancamento(db, { unidade_id: 2, tipo: "despesa", descricao: "Aluguel U2", valor_centavos: 30000, vencimento: "2026-03-05" });
    darBaixa(db, x, { data_pagamento: "2026-03-05" });
    expect(resumoPeriodo(db, [2], "2026-03-01", "2026-03-31").previsto.despesas).toBe(30000);
    expect(resumoPeriodo(db, [1], "2026-03-01", "2026-03-31").previsto.despesas).toBe(60000);
    expect(resumoPeriodo(db, U, "2026-03-01", "2026-03-31").previsto.despesas).toBe(90000);
    expect(saldoRealizadoAte(db, [2], "2026-03-31")).toBe(20000);
    expect(saldoRealizadoAte(db, U, "2026-03-31")).toBe(295000 + 20000);
    expect(listarLancamentos(db, { unidades: [2] })).toHaveLength(1);
  });

  it("saldo, pendências, projeção e fluxo diário", () => {
    const db = cenario();
    expect(saldoRealizadoAte(db, U, "2026-03-31")).toBe(100000 + 195000);
    expect(saldoRealizadoAte(db, U, "2026-04-01")).toBe(100000 + 195000 - 50000);

    const p = pendencias(db, U, "2026-03-25");
    expect(p.despesasVencidas).toEqual({ qtd: 1, total: 10000 });

    const pr = projecoes(db, U, "2026-03-25", [30]);
    expect(pr.saldoAtual).toBe(295000);
    expect(pr.itens[0].saldoFinal).toBe(295000 - 10000 + 80000); // luz vencida + plano anual

    const dias = fluxoDiario(db, U, "2026-03-01", "2026-04-05", "2026-03-25");
    const d = (x: string) => dias.find((l) => l.data === x)!;
    expect(d("2026-03-10").previstoReceitas).toBe(200000);
    expect(d("2026-03-11").realizadoReceitas).toBe(195000);
    expect(d("2026-03-25").saldo).toBe(295000);
    expect(d("2026-03-26").saldo).toBe(285000); // luz vencida entra no dia seguinte
    expect(d("2026-04-02").saldo).toBe(365000);
    expect(d("2026-04-02").projetado).toBe(true);
  });
});

describe("importação de relatório (Octagym) e exportação", () => {
  const csv = [
    "Aluno;Plano;Vencimento;Data de pagamento;Valor;Situação;Forma de pagamento",
    'Maria Silva;Mensal;05/03/2026;05/03/2026;"129,90";Pago;Pix',
    "João;Trimestral;10/03/2026;;349,00;Pendente;Boleto",
    "Ana;Mensal;xx;;129,90;Pago;Pix",
    "Ana;Mensal;12/03/2026;12/03/2026;0,00;Cortesia;",
  ].join("\n");

  it("detecta colunas, status e erros", () => {
    const r = interpretarRelatorio(csv);
    expect(r.linhas).toHaveLength(2);
    expect(r.erros).toEqual([{ linha: 4, motivo: "Data inválida ou vazia." }]);
    expect(r.linhas[0]).toMatchObject({ fornecedor: "Maria Silva", descricao: "Mensal", valor_centavos: 12990, pago: true, data_pagamento: "2026-03-05", forma_pagamento: "Pix" });
    expect(r.linhas[1]).toMatchObject({ pago: false, data_pagamento: null, vencimento: "2026-03-10" });
  });

  it("não importa a mesma linha duas vezes e permite desfazer o lote", () => {
    const db = novoBanco();
    const { linhas } = interpretarRelatorio(csv);
    expect(importarReceitas(db, linhas, { unidadeId: 1, lote: "a", categoriaPadraoId: null })).toEqual({ inseridos: 2, duplicados: 0 });
    expect(importarReceitas(db, linhas, { unidadeId: 1, lote: "b", categoriaPadraoId: null })).toEqual({ inseridos: 0, duplicados: 2 });
    // a mesma planilha importada na outra unidade não é duplicata
    expect(importarReceitas(db, linhas, { unidadeId: 2, lote: "c", categoriaPadraoId: null }).inseridos).toBe(2);
    expect(desfazerLote(db, "importacao:a", [2])).toBe(0); // sem acesso à unidade 1
    expect(desfazerLote(db, "importacao:a", [1])).toBe(2);
  });

  it("gera CSV que volta a ser lido", () => {
    const db = novoBanco();
    criarLancamento(db, { unidade_id: 1, tipo: "despesa", descricao: 'Conserto "esteira"; urgente', valor_centavos: 123456, vencimento: "2026-03-05" });
    const linhas = lerCSV(gerarCSV(listarLancamentos(db, { unidades: [1, 2] })));
    expect(linhas[1][2]).toBe('Conserto "esteira"; urgente');
    expect(linhas[1][5]).toBe("1234,56");
  });
});

describe("usuários e permissões", () => {
  it("entra pelo e-mail ou pelo nome de usuário", () => {
    const db = novoBanco();
    expect(criarUsuario(db, { nome: "Rec", email: "rec@x.com", usuario: "Recepcao", senha: "senha-forte-9", papel: "leitura", unidades: [1] })).toBeNull();
    expect(buscarParaLogin(db, "recepcao")?.id).toBe(1); // guardado em minúsculas
    expect(buscarParaLogin(db, "RECEPCAO")?.id).toBe(1);
    expect(buscarParaLogin(db, " REC@X.COM ")?.id).toBe(1);
    expect(buscarParaLogin(db, "outra")).toBeUndefined();
    expect(criarUsuario(db, { nome: "B", email: "b@x.com", usuario: "recepcao", senha: "senha-forte-9", papel: "leitura", unidades: [1] })).toMatch(/em uso/);
    expect(criarUsuario(db, { nome: "B", email: "b@x.com", usuario: "a b", senha: "senha-forte-9", papel: "leitura", unidades: [1] })).toMatch(/3 a 30/);
    expect(atualizarUsuario(db, 1, { papel: "leitura", ativo: true, unidades: [1], usuario: "" })).toBeNull();
    expect(buscarParaLogin(db, "recepcao")).toBeUndefined(); // usuário removido: só o e-mail funciona
    atualizarUsuario(db, 1, { papel: "leitura", ativo: false, unidades: [1] });
    expect(buscarParaLogin(db, "rec@x.com")).toBeUndefined(); // inativo não entra
  });

  it("valida, mantém um admin e encerra sessões", () => {
    const db = novoBanco();
    expect(criarUsuario(db, { nome: "Dono", email: "dono@x.com", senha: "curta", papel: "admin", unidades: [] })).toMatch(/10 caracteres/);
    expect(criarUsuario(db, { nome: "Dono", email: "dono@x.com", senha: "senha-forte-1", papel: "admin", unidades: [] })).toBeNull();
    expect(criarUsuario(db, { nome: "Outro", email: "DONO@x.com", senha: "senha-forte-1", papel: "leitura", unidades: [1] })).toMatch(/Já existe/);
    expect(criarUsuario(db, { nome: "Recepção", email: "rec@x.com", senha: "senha-forte-2", papel: "editor", unidades: [] })).toMatch(/unidade/);
    expect(criarUsuario(db, { nome: "Recepção", email: "rec@x.com", senha: "senha-forte-2", papel: "editor", unidades: [2] })).toBeNull();
    expect(unidadesDoUsuario(db, { id: 2, papel: "editor" }).map((u) => u.nome)).toEqual(["Unidade 2"]);
    expect(unidadesDoUsuario(db, { id: 1, papel: "admin" })).toHaveLength(2);

    expect(atualizarUsuario(db, 1, { papel: "editor", ativo: true, unidades: [1] })).toMatch(/administrador/);
    expect(atualizarUsuario(db, 1, { papel: "admin", ativo: false, unidades: [] })).toMatch(/administrador/);

    db.prepare("INSERT INTO sessoes VALUES ('t1', 2, '2999-01-01'), ('t2', 2, '2999-01-01')").run();
    expect(atualizarUsuario(db, 2, { papel: "leitura", ativo: false, unidades: [2] })).toBeNull();
    expect((db.prepare("SELECT COUNT(*) n FROM sessoes").get() as { n: number }).n).toBe(0);

    db.prepare("INSERT INTO sessoes VALUES ('a', 1, '2999-01-01'), ('b', 1, '2999-01-01')").run();
    expect(trocarPropriaSenha(db, 1, "errada", "nova-senha-123", "a")).toMatch(/incorreta/);
    expect(trocarPropriaSenha(db, 1, "senha-forte-1", "nova-senha-123", "a")).toBeNull();
    expect((db.prepare("SELECT token_hash FROM sessoes").all() as { token_hash: string }[]).map((s) => s.token_hash)).toEqual(["a"]);
    expect(redefinirSenha(db, 1, "outra-senha-456")).toBeNull();
    const { senha_hash } = db.prepare("SELECT senha_hash FROM usuarios WHERE id=1").get() as { senha_hash: string };
    expect(conferirSenha("outra-senha-456", senha_hash)).toBe(true);
  });
});
