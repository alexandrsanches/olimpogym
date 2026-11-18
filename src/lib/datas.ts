// Datas são strings ISO "AAAA-MM-DD", sempre no fuso de São Paulo.

export const FUSO = "America/Sao_Paulo";

export function hoje(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export function isDataISO(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

/** Soma meses mantendo o dia; se o mês não tiver o dia (ex.: 31), usa o último dia. */
export function somarMeses(data: string, meses: number, diaDesejado?: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const dia = diaDesejado ?? d;
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ultimoDia));
  return alvo.toISOString().slice(0, 10);
}

/** "2026-11" -> { inicio: "2026-11-01", fim: "2026-11-30" } */
export function intervaloDoMes(mes: string): { inicio: string; fim: string } {
  const [a, m] = mes.split("-").map(Number);
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return { inicio: `${mes}-01`, fim };
}

export function isMes(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function mesAnterior(mes: string): string {
  return somarMeses(`${mes}-01`, -1).slice(0, 7);
}

export function mesSeguinte(mes: string): string {
  return somarMeses(`${mes}-01`, 1).slice(0, 7);
}

const nomesMes = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function nomeDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${nomesMes[m - 1]} de ${a}`;
}

export function formatData(data: string | null | undefined): string {
  if (!data) return "—";
  const [a, m, d] = data.split("-");
  return `${d}/${m}/${a}`;
}

/** Aceita "31/12/2026", "31/12/26", "2026-12-31" e "2026-12-31T10:00". */
export function parseDataFlexivel(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const s = texto.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return isDataISO(iso) ? iso : null;
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/);
  if (m) {
    const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
    const iso = `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return isDataISO(iso) ? iso : null;
  }
  return null;
}
