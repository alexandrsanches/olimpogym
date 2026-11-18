import { formatData } from "./datas";
import type { Lancamento } from "./lancamentos";
import { centavosParaInput } from "./money";

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
