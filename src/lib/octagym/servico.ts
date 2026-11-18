import { getDb } from "../db";
import { conectar, URL_PADRAO } from "./cliente";
import {
  chavesParaSincronizar,
  concluirExecucao,
  executar,
  iniciarExecucao,
  lerConfig,
  novaContagem,
  salvarDiagnostico,
  ultimaExecucaoAutomatica,
  type Contagem,
  type Diagnostico,
} from "./sincronizacao";

// Estado compartilhado no processo (sobrevive a recarregamentos de módulo em desenvolvimento).
const g = globalThis as unknown as { __octagym?: { rodando: boolean; timer?: NodeJS.Timeout } };
const estado = (g.__octagym ??= { rodando: false });

export function algumaChave(): boolean {
  return chavesParaSincronizar(getDb()).length > 0;
}

export function sincronizando(): boolean {
  return estado.rodando;
}

/**
 * Executa uma rodada (ou só o teste de conexão) para cada unidade com chave — ou só para `unidadeId`.
 * Uma unidade com erro não impede as outras. Nunca roda duas rodadas ao mesmo tempo.
 */
export async function rodar(gatilho: "automatico" | "manual" | "teste", unidadeId?: number): Promise<{ ok: boolean; mensagem: string }> {
  if (estado.rodando) return { ok: false, mensagem: "Já existe uma sincronização em andamento." };
  const db = getDb();
  const chaves = chavesParaSincronizar(db).filter((k) => unidadeId == null || k.unidade_id === unidadeId);
  if (!chaves.length) return { ok: false, mensagem: "Nenhuma unidade com chave do Octagym cadastrada." };
  estado.rodando = true;
  const id = iniciarExecucao(db, gatilho);
  const total: Contagem = novaContagem();
  const partes: string[] = [];
  let tudoOk = true;
  try {
    for (const k of chaves) {
      const diag: Diagnostico | null = await (async () => {
        const con = await conectar(k.chave, process.env.OCTAGYM_MCP_URL || URL_PADRAO);
        try {
          return await executar(db, con, k.unidade_id, { apenasTestar: gatilho === "teste" });
        } finally {
          await con.fechar();
        }
      })().catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        salvarDiagnostico(db, {
          quando: new Date().toISOString(),
          unidade_id: k.unidade_id,
          ok: false,
          mensagem: msg,
          empresa: null,
          ferramentasFinanceiras: [],
          temTitulos: false,
          parametrosTitulos: [],
          argumentosUsados: [],
          exemploBruto: null,
          exemploInterpretado: null,
        });
        partes.push(`${k.unidade_nome}: ${msg}`);
        tudoOk = false;
        return null;
      });
      if (!diag) continue;
      salvarDiagnostico(db, diag);
      partes.push(`${k.unidade_nome}: ${diag.mensagem}`);
      if (!diag.ok) tudoOk = false;
      if (diag.contagem) {
        for (const campo of ["lidos", "criados", "atualizados", "removidos", "ignorados"] as const) total[campo] += diag.contagem[campo];
      }
    }
    const mensagem = partes.join(" | ");
    concluirExecucao(db, id, tudoOk, mensagem, total);
    return { ok: tudoOk, mensagem };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    concluirExecucao(db, id, false, msg, total);
    return { ok: false, mensagem: msg };
  } finally {
    estado.rodando = false;
  }
}

/** Verifica a cada minuto se está na hora de sincronizar. Chamado uma vez quando o servidor sobe. */
export function iniciarAgendador(): void {
  if (estado.timer) return;
  const verificar = async () => {
    try {
      const db = getDb();
      const cfg = lerConfig(db);
      if (!cfg.ativo || estado.rodando || !chavesParaSincronizar(db).length) return;
      const ultima = ultimaExecucaoAutomatica(db);
      const ultimaMs = ultima ? Date.parse(ultima.inicio.replace(" ", "T") + "Z") : 0;
      if (Date.now() - ultimaMs < cfg.intervaloMin * 60_000) return;
      const r = await rodar("automatico");
      if (!r.ok) console.error(`[octagym] ${r.mensagem}`);
    } catch (e) {
      console.error("[octagym] falha no agendador:", e);
    }
  };
  estado.timer = setInterval(verificar, 60_000);
  estado.timer.unref?.();
  setTimeout(verificar, 20_000).unref?.();
}
