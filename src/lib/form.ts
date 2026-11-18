import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { isDataISO } from "./datas";
import { UPLOADS_DIR, type Tipo } from "./db";
import type { DadosLancamento, DadosPagamento } from "./lancamentos";
import { parseValor } from "./money";

export function txt(fd: FormData, nome: string): string {
  const v = fd.get(nome);
  return typeof v === "string" ? v.trim() : "";
}

export function num(fd: FormData, nome: string): number | null {
  const v = Number(txt(fd, nome));
  return txt(fd, nome) && Number.isInteger(v) ? v : null;
}

/** Volta para `destino` com uma mensagem (?erro= ou ?ok=). */
export function voltar(destino: string, tipo: "erro" | "ok", msg: string): never {
  const sep = destino.includes("?") ? "&" : "?";
  redirect(`${destino}${sep}${tipo}=${encodeURIComponent(msg)}`);
}

/** Aceita só caminhos internos, para não redirecionar para outro site. */
export function destinoSeguro(v: string, padrao: string): string {
  return v.startsWith("/") && !v.startsWith("//") ? v : padrao;
}

export function lerLancamento(fd: FormData): { dados?: DadosLancamento; erro?: string } {
  const tipo = txt(fd, "tipo") as Tipo;
  if (tipo !== "despesa" && tipo !== "receita") return { erro: "Tipo inválido." };
  const descricao = txt(fd, "descricao");
  if (!descricao) return { erro: "Informe a descrição." };
  const valor = parseValor(txt(fd, "valor"));
  if (valor == null || valor <= 0) return { erro: "Informe um valor maior que zero." };
  const vencimento = txt(fd, "vencimento");
  if (!isDataISO(vencimento)) return { erro: "Informe uma data de vencimento válida." };
  const unidade = num(fd, "unidade_id");
  if (!unidade) return { erro: "Escolha a unidade." };
  return {
    dados: {
      unidade_id: unidade,
      tipo,
      descricao: descricao.slice(0, 200),
      fornecedor: txt(fd, "fornecedor").slice(0, 200) || null,
      categoria_id: num(fd, "categoria_id"),
      valor_centavos: valor,
      vencimento,
      forma_pagamento: txt(fd, "forma_pagamento").slice(0, 50) || null,
      observacao: txt(fd, "observacao").slice(0, 2000) || null,
    },
  };
}

const TIPOS_COMPROVANTE: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};
export const TAMANHO_MAX_COMPROVANTE = 10 * 1024 * 1024;

export function tipoDoComprovante(arquivo: string): string {
  return TIPOS_COMPROVANTE[path.extname(arquivo).toLowerCase()] ?? "application/octet-stream";
}

/** Salva o comprovante enviado (se houver) e devolve o nome do arquivo no servidor. */
export async function salvarComprovante(fd: FormData): Promise<{ arquivo?: string; nome?: string; erro?: string }> {
  const f = fd.get("comprovante");
  if (!(f instanceof File) || f.size === 0) return {};
  const ext = path.extname(f.name).toLowerCase();
  if (!TIPOS_COMPROVANTE[ext]) return { erro: "Comprovante deve ser PDF, JPG, PNG, WEBP ou HEIC." };
  if (f.size > TAMANHO_MAX_COMPROVANTE) return { erro: "Comprovante maior que 10 MB." };
  const arquivo = `${randomUUID()}${ext}`;
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOADS_DIR, arquivo), Buffer.from(await f.arrayBuffer()));
  return { arquivo, nome: f.name.slice(0, 200) };
}

export async function apagarComprovantes(arquivos: (string | null | undefined)[]): Promise<void> {
  for (const a of arquivos) {
    if (!a || a.includes("/") || a.includes("\\")) continue;
    await fs.rm(path.join(UPLOADS_DIR, a), { force: true });
  }
}

export function lerPagamento(fd: FormData, comprovante: { arquivo?: string; nome?: string }): { dados?: DadosPagamento; erro?: string } {
  const data = txt(fd, "data_pagamento");
  if (!isDataISO(data)) return { erro: "Informe a data do pagamento." };
  const valorTxt = txt(fd, "valor_pago");
  const valor = valorTxt ? parseValor(valorTxt) : null;
  if (valorTxt && (valor == null || valor < 0)) return { erro: "Valor pago inválido." };
  return {
    dados: {
      data_pagamento: data,
      valor_pago_centavos: valor,
      forma_pagamento: txt(fd, "forma_pagamento") || null,
      comprovante_arquivo: comprovante.arquivo ?? null,
      comprovante_nome: comprovante.nome ?? null,
    },
  };
}

export function nums(fd: FormData, nome: string): number[] {
  return fd
    .getAll(nome)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
}
