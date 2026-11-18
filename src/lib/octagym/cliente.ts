import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { EsquemaFerramenta } from "./mapeamento";
import { lerResultado } from "./mapeamento";

export const URL_PADRAO = "https://app.octagym.ai/api/mcp/v1";

export interface FerramentaInfo {
  name: string;
  description?: string;
  inputSchema?: EsquemaFerramenta;
}

/** Conexão com o conector MCP do Octagym (somente as operações que o sistema usa). */
export interface ConexaoOctagym {
  ferramentas(): Promise<FerramentaInfo[]>;
  chamar(nome: string, args: Record<string, unknown>): Promise<unknown>;
  fechar(): Promise<void>;
}

export class ErroOctagym extends Error {}

/** Mensagem amigável para os erros mais comuns. */
function explicar(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/401|unauthori[sz]ed|invalid api key|expired/i.test(msg)) return `Chave recusada pelo Octagym (inválida ou vencida). Detalhe: ${msg}`;
  if (/403|forbidden|enterprise|plano|plan/i.test(msg)) return `Acesso negado pelo Octagym (escopo da chave ou plano sem o conector MCP). Detalhe: ${msg}`;
  if (/429|rate/i.test(msg)) return `Limite de requisições do Octagym atingido; tentará de novo na próxima rodada. Detalhe: ${msg}`;
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(msg)) return `Não foi possível falar com o Octagym (rede). Detalhe: ${msg}`;
  return msg;
}

export async function conectar(chave: string, url = URL_PADRAO): Promise<ConexaoOctagym> {
  if (!chave) throw new ErroOctagym("Chave da API do Octagym não configurada (OCTAGYM_API_KEY no .env do servidor).");
  const transporte = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${chave}` } },
  });
  const cliente = new Client({ name: "olimpo-gym-fluxo-de-caixa", version: "1.0.0" });
  try {
    await cliente.connect(transporte, { timeout: 30_000 });
  } catch (e) {
    await transporte.close().catch(() => {});
    throw new ErroOctagym(explicar(e));
  }
  return {
    async ferramentas() {
      const lista: FerramentaInfo[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const r = await cliente.listTools(cursor ? { cursor } : undefined, { timeout: 60_000 }).catch((e) => {
          throw new ErroOctagym(explicar(e));
        });
        lista.push(...(r.tools as FerramentaInfo[]));
        cursor = r.nextCursor;
        if (!cursor) break;
      }
      return lista;
    },
    async chamar(nome, args) {
      const r = await cliente.callTool({ name: nome, arguments: args }, undefined, { timeout: 120_000 }).catch((e) => {
        throw new ErroOctagym(explicar(e));
      });
      const dados = lerResultado(r as { content?: unknown; structuredContent?: unknown });
      if ((r as { isError?: boolean }).isError) {
        throw new ErroOctagym(explicar(`A ferramenta ${nome} respondeu com erro: ${typeof dados === "string" ? dados : JSON.stringify(dados).slice(0, 500)}`));
      }
      return dados;
    },
    async fechar() {
      await cliente.close().catch(() => {});
    },
  };
}
