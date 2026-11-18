// Valores são guardados em centavos (inteiros) para evitar erro de arredondamento.

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(centavos: number): string {
  return brl.format(centavos / 100);
}

/**
 * Converte texto digitado ("1.250,00", "1250,5", "R$ 99", "1250.00", "-30,00")
 * em centavos. Retorna null se não for um número válido.
 */
export function parseValor(texto: string | null | undefined): number | null {
  if (texto == null) return null;
  let s = String(texto).trim().replace(/R\$\s?/i, "").replace(/\s/g, "");
  if (!s) return null;
  let negativo = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negativo = true;
    s = s.slice(1);
  }
  const ultimaVirgula = s.lastIndexOf(",");
  const ultimoPonto = s.lastIndexOf(".");
  if (ultimaVirgula > -1 && ultimoPonto > -1) {
    // o separador que aparece por último é o decimal
    if (ultimaVirgula > ultimoPonto) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (ultimaVirgula > -1) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (ultimoPonto > -1) {
    // "1.250" (milhar) vs "1250.5" (decimal): 3 dígitos após o ponto e só um ponto = milhar
    const partes = s.split(".");
    if (partes.length > 2 || (partes.length === 2 && partes[1].length === 3)) s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const centavos = Math.round(parseFloat(s) * 100);
  return negativo ? -centavos : centavos;
}

/** Centavos -> texto para campo de formulário ("1250,00"). */
export function centavosParaInput(centavos: number | null | undefined): string {
  if (centavos == null) return "";
  return (centavos / 100).toFixed(2).replace(".", ",");
}
