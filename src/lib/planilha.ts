import { createHash } from "node:crypto";
import { formatData, parseDataFlexivel } from "./datas";
import type { Lancamento } from "./lancamentos";
import { centavosParaInput, parseValor } from "./money";

/** Lê CSV com separador ";" ou "," (detectado), aspas e quebras de linha dentro de aspas. */
export function lerCSV(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const primeira = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ";" : primeira.includes("\t") ? "\t" : ",";
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo);
      if (linha.some((x) => x.trim() !== "")) linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== "")) linhas.push(linha);
  return linhas;
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Nomes de coluna aceitos (comparação sem acento/maiúscula; basta conter o termo).
const SINONIMOS = {
  vencimento: ["vencimento", "data prevista", "data de vencimento", "previsao", "data"],
  pagamento: ["data pagamento", "data de pagamento", "pago em", "recebido em", "data do pagamento", "data recebimento", "data de recebimento", "liquidacao"],
  descricao: ["descricao", "historico", "plano", "produto", "servico", "referente"],
  fornecedor: ["aluno", "cliente", "nome", "pagador", "fornecedor", "membro"],
  valor: ["valor pago", "valor recebido", "valor liquido", "valor", "total", "montante"],
  status: ["status", "situacao", "estado"],
  forma: ["forma de pagamento", "forma pagamento", "meio de pagamento", "metodo", "forma"],
  categoria: ["categoria", "tipo de receita", "tipo"],
} as const;

export type Coluna = keyof typeof SINONIMOS;
export type Mapeamento = Partial<Record<Coluna, number>>;

export function detectarColunas(cabecalho: string[]): Mapeamento {
  const h = cabecalho.map(normalizar);
  const usado = new Set<number>();
  const map: Mapeamento = {};
  // ordem importa: colunas mais específicas primeiro
  const ordem: Coluna[] = ["pagamento", "vencimento", "valor", "status", "forma", "categoria", "fornecedor", "descricao"];
  for (const col of ordem) {
    for (const termo of SINONIMOS[col]) {
      const idx = h.findIndex((x, i) => !usado.has(i) && (x === termo || x.includes(termo)));
      if (idx > -1) {
        map[col] = idx;
        usado.add(idx);
        break;
      }
    }
  }
  return map;
}

const STATUS_PAGO = ["pago", "paga", "recebido", "recebida", "confirmado", "confirmada", "liquidado", "liquidada", "aprovado", "aprovada", "quitado", "quitada", "baixado", "baixada", "compensado"];

export interface LinhaImportada {
  linha: number;
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

export interface ResultadoLeitura {
  mapeamento: Mapeamento;
  cabecalho: string[];
  linhas: LinhaImportada[];
  erros: { linha: number; motivo: string }[];
}

/**
 * Interpreta um relatório exportado (ex.: recebimentos do Octagym) como receitas.
 * Cada linha recebe uma chave estável para não importar a mesma linha duas vezes.
 */
export function interpretarRelatorio(texto: string): ResultadoLeitura {
  const tabela = lerCSV(texto);
  if (tabela.length < 2) return { mapeamento: {}, cabecalho: tabela[0] ?? [], linhas: [], erros: [{ linha: 1, motivo: "Arquivo vazio ou sem linhas de dados." }] };
  const [cabecalho, ...dados] = tabela;
  const map = detectarColunas(cabecalho);
  const erros: ResultadoLeitura["erros"] = [];
  if (map.valor == null) erros.push({ linha: 1, motivo: "Não encontrei a coluna de valor." });
  if (map.vencimento == null && map.pagamento == null) erros.push({ linha: 1, motivo: "Não encontrei nenhuma coluna de data." });
  if (erros.length) return { mapeamento: map, cabecalho, linhas: [], erros };

  const get = (row: string[], c: Coluna) => (map[c] != null ? (row[map[c]!] ?? "").trim() : "");
  const linhas: LinhaImportada[] = [];
  const vistas = new Map<string, number>();
  dados.forEach((row, i) => {
    const n = i + 2;
    const valor = parseValor(get(row, "valor"));
    if (valor == null) return erros.push({ linha: n, motivo: `Valor inválido: "${get(row, "valor")}"` });
    if (valor === 0) return; // linhas zeradas (cortesias, totais vazios) são ignoradas
    const dataPag = parseDataFlexivel(get(row, "pagamento"));
    const venc = parseDataFlexivel(get(row, "vencimento")) ?? dataPag;
    if (!venc) return erros.push({ linha: n, motivo: "Data inválida ou vazia." });
    const statusTxt = normalizar(get(row, "status"));
    const pago = map.status != null ? STATUS_PAGO.some((s) => statusTxt.includes(s)) : !!dataPag || map.vencimento == null;
    const fornecedor = get(row, "fornecedor") || null;
    const descricao = get(row, "descricao") || (fornecedor ? `Recebimento - ${fornecedor}` : "Recebimento importado");
    // a chave usa o conteúdo da linha; linhas idênticas no mesmo arquivo recebem um sufixo
    const base = createHash("sha256").update(row.map((x) => x.trim()).join("\u0001")).digest("hex").slice(0, 32);
    const rep = vistas.get(base) ?? 0;
    vistas.set(base, rep + 1);
    linhas.push({
      linha: n,
      vencimento: venc,
      descricao,
      fornecedor,
      valor_centavos: Math.abs(valor),
      pago,
      data_pagamento: pago ? (dataPag ?? venc) : null,
      forma_pagamento: get(row, "forma") || null,
      categoria: get(row, "categoria") || null,
      chave: rep ? `${base}-${rep}` : base,
    });
  });
  return { mapeamento: map, cabecalho, linhas, erros };
}

function campoCSV(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Gera CSV no padrão do Excel brasileiro (";" e vírgula decimal, com BOM UTF-8). */
export function gerarCSV(lancamentos: Lancamento[]): string {
  const cab = ["ID", "Tipo", "Descrição", "Fornecedor/Cliente", "Categoria", "Valor", "Vencimento", "Status", "Data pagamento", "Valor pago", "Forma de pagamento", "Recorrente", "Parcela", "Comprovante", "Observação", "Origem"];
  const linhas = lancamentos.map((l) =>
    [
      l.id,
      l.tipo === "receita" ? "Receita" : "Despesa",
      l.descricao,
      l.fornecedor,
      l.categoria_nome,
      centavosParaInput(l.valor_centavos),
      formatData(l.vencimento),
      l.status === "pago" ? (l.tipo === "receita" ? "Recebido" : "Pago") : "Em aberto",
      l.data_pagamento ? formatData(l.data_pagamento) : "",
      l.status === "pago" ? centavosParaInput(l.valor_pago_centavos ?? l.valor_centavos) : "",
      l.forma_pagamento,
      l.recorrencia_id ? "Sim" : "Não",
      l.parcela,
      l.comprovante_nome,
      l.observacao,
      l.origem,
    ]
      .map(campoCSV)
      .join(";"),
  );
  return "﻿" + [cab.join(";"), ...linhas].join("\r\n") + "\r\n";
}
