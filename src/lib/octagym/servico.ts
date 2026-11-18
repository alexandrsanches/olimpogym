import { getDb } from "../db";
import { conectar, URL_PADRAO } from "./cliente";
import { concluirExecucao, executar, iniciarExecucao, lerConfig, salvarDiagnostico, ultimaExecucaoAutomatica, type Diagnostico } from "./sincronizacao";

// Estado compartilhado no processo (sobrevive a recarregamentos de módulo em desenvolvimento).
const g = globalThis as unknown as { __octagym?: { rodando: boolean; timer?: NodeJS.Timeout } };
const estado = (g.__octagym ??= { rodando: false });

export function chaveConfigurada(): boolean {
  return !!process.env.OCTAGYM_API_KEY?.trim();
}

export function sincronizando(): boolean {
  return estado.rodando;
}

/** Executa uma rodada (ou só o teste de conexão) e registra no histórico. Nunca roda duas ao mesmo tempo. */
export async function rodar(gatilho: "automatico" | "manual" | "teste"): Promise<{ ok: boolean; mensagem: string; diagnostico?: Diagnostico }> {
  if (estado.rodando) return { ok: false, mensagem: "Já existe uma sincronização em andamento." };
  estado.rodando = true;
  const db = getDb();
  const id = iniciarExecucao(db, gatilho);
  try {
    const con = await conectar(process.env.OCTAGYM_API_KEY?.trim() ?? "", process.env.OCTAGYM_MCP_URL || URL_PADRAO);
    try {
      const d = await executar(db, con, { apenasTestar: gatilho === "teste" });
      salvarDiagnostico(db, d);
      concluirExecucao(db, id, d.ok, d.mensagem, d.contagem);
      return { ok: d.ok, mensagem: d.mensagem, diagnostico: d };
    } finally {
      await con.fechar();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    concluirExecucao(db, id, false, msg);
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
      if (!cfg.ativo || !chaveConfigurada() || estado.rodando) return;
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
