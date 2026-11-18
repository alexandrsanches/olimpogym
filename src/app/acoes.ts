"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { entrar, exigirAdmin, exigirContexto, exigirUsuario, loginBloqueado, sair, tokenHashAtual, type Contexto } from "@/lib/auth";
import { isDataISO } from "@/lib/datas";
import { getDb, type Papel, type Tipo } from "@/lib/db";
import { definirSaldoInicial } from "@/lib/fluxo";
import {
  alternarCategoria,
  alternarUnidade,
  anexarComprovante,
  atualizarLancamento,
  criarCategoria,
  criarLancamento,
  darBaixa,
  desfazerLote,
  excluirLancamento,
  importarReceitas,
  obterLancamento,
  reabrir,
  renomearCategoria,
  salvarUnidade,
  type Lancamento,
} from "@/lib/lancamentos";
import { apagarComprovantes, destinoSeguro, lerLancamento, lerPagamento, num, nums, salvarComprovante, txt, voltar } from "@/lib/form";
import { parseValor } from "@/lib/money";
import { interpretarRelatorio } from "@/lib/planilha";
import { atualizarUsuario, criarUsuario, redefinirSenha, trocarPropriaSenha } from "@/lib/usuarios";

// ---------- sessão ----------

export async function acaoEntrar(fd: FormData) {
  const login = txt(fd, "login");
  const senha = typeof fd.get("senha") === "string" ? (fd.get("senha") as string) : "";
  if (!login || !senha) voltar("/login", "erro", "Informe usuário ou e-mail e a senha.");
  if (loginBloqueado(login)) voltar("/login", "erro", "Muitas tentativas. Aguarde 15 minutos.");
  if (!(await entrar(login, senha, txt(fd, "lembrar") === "1"))) voltar("/login", "erro", "Usuário/e-mail ou senha incorretos.");
  redirect("/");
}

export async function acaoSair() {
  await sair();
  redirect("/login");
}

// ---------- lançamentos ----------

/** Carrega o lançamento do formulário e confere se o usuário tem acesso à unidade dele. */
function lancamentoPermitido(ctx: Contexto, fd: FormData): Lancamento {
  const id = num(fd, "id");
  const l = id ? obterLancamento(getDb(), id) : undefined;
  if (!l || !ctx.ids.includes(l.unidade_id)) voltar("/lancamentos", "erro", "Lançamento não encontrado.");
  return l;
}

export async function acaoCriarLancamento(fd: FormData) {
  const ctx = await exigirContexto("editor");
  const volta = destinoSeguro(txt(fd, "voltar"), "/lancamentos/novo");
  const { dados, erro } = lerLancamento(fd);
  if (!dados) voltar(volta, "erro", erro!);
  if (!ctx.ids.includes(dados.unidade_id)) voltar(volta, "erro", "Você não tem acesso a essa unidade.");

  const recorrente = txt(fd, "recorrente") === "1";
  const meses = recorrente ? Math.max(2, Math.min(num(fd, "meses") ?? 12, 60)) : 1;
  const jaPago = txt(fd, "ja_pago") === "1";

  const comp = await salvarComprovante(fd);
  if (comp.erro) voltar(volta, "erro", comp.erro);
  let pagamento = null;
  if (jaPago) {
    const pg = lerPagamento(fd, comp);
    if (!pg.dados) {
      await apagarComprovantes([comp.arquivo]);
      voltar(volta, "erro", pg.erro!);
    }
    pagamento = pg.dados;
  }
  const ids = criarLancamento(getDb(), dados, { meses, usuarioId: ctx.usuario.id, pagamento });
  if (!jaPago && comp.arquivo) anexarComprovante(getDb(), ids[0], comp.arquivo, comp.nome!);
  revalidatePath("/", "layout");
  const msg = ids.length > 1 ? `${ids.length} lançamentos mensais criados.` : "Lançamento criado.";
  if (txt(fd, "continuar") === "1") voltar(`/lancamentos/novo?tipo=${dados.tipo}&unidade=${dados.unidade_id}`, "ok", msg);
  voltar(`/lancamentos?mes=${dados.vencimento.slice(0, 7)}&tipo=${dados.tipo}&unidade=${dados.unidade_id}`, "ok", msg);
}

export async function acaoAtualizarLancamento(fd: FormData) {
  const ctx = await exigirContexto("editor");
  const { id } = lancamentoPermitido(ctx, fd);
  const { dados, erro } = lerLancamento(fd);
  if (!dados) voltar(`/lancamentos/${id}`, "erro", erro!);
  if (!ctx.ids.includes(dados.unidade_id)) voltar(`/lancamentos/${id}`, "erro", "Você não tem acesso a essa unidade.");
  const escopo = txt(fd, "escopo") === "futuros" ? "futuros" : "este";
  atualizarLancamento(getDb(), id, dados, escopo);
  revalidatePath("/", "layout");
  voltar(`/lancamentos/${id}`, "ok", escopo === "futuros" ? "Salvo neste e nos próximos em aberto." : "Alterações salvas.");
}

export async function acaoDarBaixa(fd: FormData) {
  const ctx = await exigirContexto("editor");
  const { id, comprovante_arquivo: anterior } = lancamentoPermitido(ctx, fd);
  const volta = destinoSeguro(txt(fd, "voltar"), `/lancamentos/${id}`);
  const comp = await salvarComprovante(fd);
  if (comp.erro) voltar(volta, "erro", comp.erro);
  const { dados, erro } = lerPagamento(fd, comp);
  if (!dados) {
    await apagarComprovantes([comp.arquivo]);
    voltar(volta, "erro", erro!);
  }
  darBaixa(getDb(), id, dados);
  if (comp.arquivo && anterior) await apagarComprovantes([anterior]);
  revalidatePath("/", "layout");
  voltar(volta, "ok", "Baixa registrada.");
}

export async function acaoReabrir(fd: FormData) {
  const ctx = await exigirContexto("editor");
  const { id } = lancamentoPermitido(ctx, fd);
  reabrir(getDb(), id);
  revalidatePath("/", "layout");
  voltar(`/lancamentos/${id}`, "ok", "Lançamento reaberto.");
}

export async function acaoAnexarComprovante(fd: FormData) {
  const ctx = await exigirContexto("editor");
  const { id } = lancamentoPermitido(ctx, fd);
  const comp = await salvarComprovante(fd);
  if (comp.erro) voltar(`/lancamentos/${id}`, "erro", comp.erro);
  if (!comp.arquivo) voltar(`/lancamentos/${id}`, "erro", "Escolha um arquivo.");
  const anterior = anexarComprovante(getDb(), id, comp.arquivo, comp.nome!);
  await apagarComprovantes([anterior]);
  revalidatePath("/", "layout");
  voltar(`/lancamentos/${id}`, "ok", "Comprovante anexado.");
}

export async function acaoExcluirLancamento(fd: FormData) {
  const ctx = await exigirContexto("editor");
  const l = lancamentoPermitido(ctx, fd);
  const id = l.id;
  const escopo = txt(fd, "escopo") === "futuros" ? "futuros" : "este";
  const arquivos = excluirLancamento(getDb(), id, escopo);
  await apagarComprovantes(arquivos);
  revalidatePath("/", "layout");
  voltar(`/lancamentos?mes=${l.vencimento.slice(0, 7)}&tipo=${l.tipo}&unidade=${l.unidade_id}`, "ok", "Lançamento excluído.");
}

// ---------- importação ----------

export async function acaoImportar(fd: FormData) {
  const ctx = await exigirContexto("editor");
  const unidadeId = num(fd, "unidade_id");
  if (!unidadeId || !ctx.ids.includes(unidadeId)) voltar("/importar", "erro", "Escolha a unidade.");
  const f = fd.get("arquivo");
  if (!(f instanceof File) || f.size === 0) voltar("/importar", "erro", "Escolha um arquivo CSV.");
  if (f.size > 5 * 1024 * 1024) voltar("/importar", "erro", "Arquivo maior que 5 MB.");
  const buf = Buffer.from(await f.arrayBuffer());
  // relatórios do Excel brasileiro às vezes vêm em Latin-1
  let texto = buf.toString("utf8");
  if (texto.includes("�")) texto = buf.toString("latin1");
  const r = interpretarRelatorio(texto);
  if (!r.linhas.length) voltar("/importar", "erro", r.erros.map((e) => `Linha ${e.linha}: ${e.motivo}`).slice(0, 5).join(" | ") || "Nenhuma linha válida.");
  const lote = `${new Date().toISOString().slice(0, 16).replace("T", " ")} ${f.name.slice(0, 60)} ${randomUUID().slice(0, 6)}`;
  const res = importarReceitas(getDb(), r.linhas, { unidadeId, lote, categoriaPadraoId: num(fd, "categoria_id"), usuarioId: ctx.usuario.id });
  revalidatePath("/", "layout");
  const partes = [`${res.inseridos} receitas importadas`];
  if (res.duplicados) partes.push(`${res.duplicados} já existiam`);
  if (r.erros.length) partes.push(`${r.erros.length} linhas com erro (${r.erros.slice(0, 3).map((e) => e.linha).join(", ")}${r.erros.length > 3 ? "…" : ""})`);
  voltar("/importar", "ok", partes.join(", ") + ".");
}

export async function acaoDesfazerLote(fd: FormData) {
  const ctx = await exigirContexto("editor");
  const n = desfazerLote(getDb(), txt(fd, "origem"), ctx.ids);
  revalidatePath("/", "layout");
  voltar("/importar", "ok", `${n} lançamentos removidos.`);
}

// ---------- configurações (admin) ----------

export async function acaoCriarCategoria(fd: FormData) {
  await exigirAdmin();
  const nome = txt(fd, "nome").slice(0, 60);
  const tipo = txt(fd, "tipo") as Tipo;
  if (!nome || (tipo !== "despesa" && tipo !== "receita")) voltar("/configuracoes", "erro", "Informe nome e tipo.");
  criarCategoria(getDb(), nome, tipo);
  revalidatePath("/", "layout");
  voltar("/configuracoes", "ok", "Categoria salva.");
}

export async function acaoRenomearCategoria(fd: FormData) {
  await exigirAdmin();
  const id = num(fd, "id");
  if (!id) voltar("/configuracoes", "erro", "Categoria inválida.");
  const erro = renomearCategoria(getDb(), id, txt(fd, "nome"));
  if (erro) voltar("/configuracoes", "erro", erro);
  revalidatePath("/", "layout");
  voltar("/configuracoes", "ok", "Categoria renomeada.");
}

export async function acaoAlternarCategoria(fd: FormData) {
  await exigirAdmin();
  const id = num(fd, "id");
  if (id) alternarCategoria(getDb(), id);
  revalidatePath("/", "layout");
  voltar("/configuracoes", "ok", "Categoria atualizada.");
}

export async function acaoSaldoInicial(fd: FormData) {
  await exigirAdmin();
  const valor = parseValor(txt(fd, "valor"));
  const data = txt(fd, "data");
  const unidade = num(fd, "unidade_id");
  if (valor == null || !isDataISO(data) || !unidade) voltar("/configuracoes", "erro", "Informe unidade, valor e data.");
  definirSaldoInicial(getDb(), { unidade_id: unidade, valor_centavos: valor, data });
  revalidatePath("/", "layout");
  voltar("/configuracoes", "ok", "Saldo inicial salvo.");
}

export async function acaoSalvarUnidade(fd: FormData) {
  await exigirAdmin();
  const erro = salvarUnidade(getDb(), txt(fd, "nome"), num(fd, "id"));
  if (erro) voltar("/configuracoes", "erro", erro);
  revalidatePath("/", "layout");
  voltar("/configuracoes", "ok", "Unidade salva.");
}

export async function acaoAlternarUnidade(fd: FormData) {
  await exigirAdmin();
  const id = num(fd, "id");
  if (id) alternarUnidade(getDb(), id);
  revalidatePath("/", "layout");
  voltar("/configuracoes", "ok", "Unidade atualizada.");
}

// ---------- usuários ----------

export async function acaoCriarUsuario(fd: FormData) {
  await exigirAdmin();
  const erro = criarUsuario(getDb(), {
    nome: txt(fd, "nome"),
    email: txt(fd, "email"),
    usuario: txt(fd, "usuario"),
    senha: (fd.get("senha") as string) ?? "",
    papel: txt(fd, "papel") as Papel,
    unidades: nums(fd, "unidades"),
  });
  if (erro) voltar("/usuarios", "erro", erro);
  voltar("/usuarios", "ok", "Usuário criado.");
}

export async function acaoAtualizarUsuario(fd: FormData) {
  await exigirAdmin();
  const id = num(fd, "id");
  if (!id) voltar("/usuarios", "erro", "Usuário inválido.");
  const erro = atualizarUsuario(getDb(), id, { papel: txt(fd, "papel") as Papel, ativo: txt(fd, "ativo") === "1", unidades: nums(fd, "unidades"), usuario: txt(fd, "usuario") });
  if (erro) voltar("/usuarios", "erro", erro);
  voltar("/usuarios", "ok", "Usuário atualizado.");
}

export async function acaoRedefinirSenha(fd: FormData) {
  await exigirAdmin();
  const id = num(fd, "id");
  if (!id) voltar("/usuarios", "erro", "Usuário inválido.");
  const erro = redefinirSenha(getDb(), id, (fd.get("senha") as string) ?? "");
  if (erro) voltar("/usuarios", "erro", erro);
  voltar("/usuarios", "ok", "Senha redefinida. O usuário precisará entrar de novo.");
}

export async function acaoTrocarSenha(fd: FormData) {
  const u = await exigirUsuario();
  const nova = (fd.get("nova") as string) ?? "";
  if (nova !== fd.get("confirmacao")) voltar("/conta", "erro", "A confirmação não confere.");
  const erro = trocarPropriaSenha(getDb(), u.id, (fd.get("atual") as string) ?? "", nova, await tokenHashAtual());
  if (erro) voltar("/conta", "erro", erro);
  voltar("/conta", "ok", "Senha alterada. Outras sessões foram encerradas.");
}
