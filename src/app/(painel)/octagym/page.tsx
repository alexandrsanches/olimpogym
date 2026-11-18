import {
  acaoRemoverChaveOctagym,
  acaoSalvarChaveOctagym,
  acaoSalvarOctagym,
  acaoSincronizarOctagym,
  acaoTestarOctagym,
} from "../../acoes";
import { exigirContexto } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listarCategorias } from "@/lib/lancamentos";
import { sincronizando } from "@/lib/octagym/servico";
import { lerConfig, lerDiagnosticos, listarChaves, listarExecucoes, type Diagnostico } from "@/lib/octagym/sincronizacao";
import { Mensagens, type SP } from "../../ui";

const GATILHO: Record<string, string> = { automatico: "Automática", manual: "Manual", teste: "Teste" };

function dataHora(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

const pre = { whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--bg)", padding: 10, borderRadius: 8, maxHeight: 360, overflow: "auto" } as const;

function PainelDiagnostico({ nome, d }: { nome: string; d: Diagnostico }) {
  return (
    <details className="card" style={{ marginBottom: 12 }} open={!d.ok}>
      <summary>
        Diagnóstico · {nome} ({dataHora(d.quando)}) {d.ok ? <span className="tag pago">OK</span> : <span className="tag vencido">Erro</span>}
      </summary>
      <div className="small" style={{ marginTop: 12, display: "grid", gap: 8 }}>
        <div>
          <strong>Resultado:</strong> {d.mensagem}
        </div>
        {d.empresa && (
          <div>
            <strong>Filial no Octagym:</strong> {d.empresa}
          </div>
        )}
        <div>
          <strong>Ferramentas financeiras liberadas pela chave:</strong> {d.ferramentasFinanceiras.join(", ") || "nenhuma"}
        </div>
        <div>
          <strong>Parâmetros de list_financial_titles:</strong> {d.parametrosTitulos.join(", ") || "—"}
        </div>
        <div>
          <strong>Argumentos usados:</strong> {d.argumentosUsados.join(" · ") || "—"}
        </div>
        {d.contagem && Object.keys(d.contagem.motivosIgnorados).length > 0 && (
          <div>
            <strong>Motivos dos ignorados:</strong>{" "}
            {Object.entries(d.contagem.motivosIgnorados)
              .map(([m, n]) => `${m} (${n})`)
              .join(" · ")}
          </div>
        )}
        {d.exemploBruto != null && (
          <div className="grade-2" style={{ marginBottom: 0 }}>
            <div>
              <strong>Exemplo recebido do Octagym (dados pessoais ocultos)</strong>
              <pre style={pre}>{JSON.stringify(d.exemploBruto, null, 2)}</pre>
            </div>
            <div>
              <strong>Como o sistema interpretou</strong>
              <pre style={pre}>{JSON.stringify(d.exemploInterpretado, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

export default async function Octagym({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await exigirContexto("admin");
  const db = getDb();
  const cfg = lerConfig(db);
  const chaves = listarChaves(db);
  const comChave = chaves.filter((c) => c.final);
  const categorias = listarCategorias(db, "receita");
  const execucoes = listarExecucoes(db);
  const diags = lerDiagnosticos(db);
  const ultimaOk = execucoes.find((e) => e.ok === 1 && e.gatilho !== "teste");

  return (
    <>
      <Mensagens sp={sp} />
      <div className="cabecalho">
        <div>
          <h1>Integração Octagym</h1>
          <div className="muted">Importa automaticamente as contas a receber do Octagym como receitas. Cada unidade usa a sua própria chave.</div>
        </div>
        <form action={acaoSincronizarOctagym}>
          <button type="submit" className="primario" disabled={!comChave.length}>
            Sincronizar agora
          </button>
        </form>
      </div>

      <div className="grade">
        <div className={`card kpi ${comChave.length ? "" : "alerta"}`}>
          <div className="rotulo">Chaves cadastradas</div>
          <div className="valor" style={{ fontSize: "1.1rem" }}>
            {comChave.length} de {chaves.length} unidades
          </div>
          <div className="det">{comChave.length ? "só as unidades com chave são sincronizadas" : "cadastre a chave de cada unidade abaixo"}</div>
        </div>
        <div className="card kpi">
          <div className="rotulo">Sincronização automática</div>
          <div className="valor" style={{ fontSize: "1.1rem" }}>{cfg.ativo ? `Ligada · a cada ${cfg.intervaloMin} min` : "Desligada"}</div>
          <div className="det">{sincronizando() ? "sincronizando agora…" : `última com sucesso: ${dataHora(ultimaOk?.fim)}`}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Chave de cada unidade</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          No Octagym de cada unidade: <strong>Configurações → Desenvolvedor → Nova Chave</strong>, marque só <strong>Financeiro → Leitura</strong> e cole a
          chave aqui (começa com <code>og_live_</code>). Por segurança, a chave salva não é exibida de novo, só os últimos caracteres.
        </p>
        <div className="tabela-wrap">
          <table>
            <thead>
              <tr>
                <th>Unidade</th>
                <th>Chave</th>
                <th>Cadastrar / trocar</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {chaves.map((c) => {
                const d = diags.get(c.unidade_id);
                return (
                  <tr key={c.unidade_id}>
                    <td>
                      <strong>{c.unidade_nome}</strong>
                      {c.empresa && <div className="muted small">Octagym: {c.empresa}</div>}
                    </td>
                    <td className="small">
                      {c.final ? (
                        <>
                          <code>og_…{c.final}</code>
                          <div>{d ? d.ok ? <span className="tag pago">funcionando</span> : <span className="tag vencido">com erro</span> : <span className="tag">não testada</span>}</div>
                        </>
                      ) : (
                        <span className="muted">não cadastrada</span>
                      )}
                    </td>
                    <td>
                      <form action={acaoSalvarChaveOctagym} className="acoes" style={{ flexWrap: "nowrap" }}>
                        <input type="hidden" name="unidade_id" value={c.unidade_id} />
                        <input
                          type="password"
                          name="chave"
                          required
                          placeholder="og_live_…"
                          autoComplete="off"
                          spellCheck={false}
                          aria-label={`Chave do Octagym para ${c.unidade_nome}`}
                          style={{ minWidth: 0, width: 200 }}
                        />
                        <button type="submit">Salvar</button>
                      </form>
                    </td>
                    <td>
                      {c.final && (
                        <div className="acoes" style={{ flexWrap: "nowrap" }}>
                          <form action={acaoTestarOctagym}>
                            <input type="hidden" name="unidade_id" value={c.unidade_id} />
                            <button type="submit">Testar</button>
                          </form>
                          <form action={acaoRemoverChaveOctagym}>
                            <input type="hidden" name="unidade_id" value={c.unidade_id} />
                            <button type="submit" className="link">
                              remover
                            </button>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Configuração</h2>
        <form action={acaoSalvarOctagym} className="grid">
          <label className="check inteiro">
            <input type="checkbox" name="ativo" value="1" defaultChecked={cfg.ativo} /> Sincronizar automaticamente
          </label>
          <label>
            Intervalo (minutos, mín. 5)
            <input type="number" name="intervalo" min={5} max={1440} defaultValue={cfg.intervaloMin} />
          </label>
          <label>
            Buscar vencimentos dos últimos (dias)
            <input type="number" name="dias_passados" min={1} max={365} defaultValue={cfg.diasPassados} />
          </label>
          <label>
            …e dos próximos (dias)
            <input type="number" name="dias_futuros" min={0} max={365} defaultValue={cfg.diasFuturos} />
          </label>
          <label>
            Categoria das receitas importadas
            <select name="categoria_id" defaultValue={cfg.categoriaPadraoId ?? ""}>
              <option value="">Sem categoria</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <div className="inteiro">
            <button className="primario" type="submit">
              Salvar configuração
            </button>
          </div>
        </form>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Os títulos importados ficam marcados como “Octagym”. Valor, datas, status e cliente seguem sempre o Octagym; categoria, observação e comprovante que
          você definir aqui são mantidos. Título cancelado no Octagym é removido daqui.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Últimas execuções</h2>
        {execucoes.length === 0 ? (
          <p className="muted">Nenhuma ainda.</p>
        ) : (
          <div className="tabela-wrap">
            <table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Tipo</th>
                  <th>Resultado</th>
                  <th className="num">Lidos</th>
                  <th className="num">Criados</th>
                  <th className="num">Atualizados</th>
                  <th className="num">Removidos</th>
                  <th className="num">Ignorados</th>
                </tr>
              </thead>
              <tbody>
                {execucoes.map((e) => (
                  <tr key={e.id}>
                    <td className="small">{dataHora(e.inicio)}</td>
                    <td className="small">{GATILHO[e.gatilho] ?? e.gatilho}</td>
                    <td className="small">
                      {e.ok == null ? <span className="tag">em andamento</span> : e.ok ? <span className="tag pago">OK</span> : <span className="tag vencido">Erro</span>}
                      {e.mensagem && (
                        <div className={e.ok ? "muted" : "perigo"}>
                          {e.mensagem.split(" | ").map((m, i) => (
                            <div key={i}>{m}</div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="num">{e.lidos}</td>
                    <td className="num">{e.criados}</td>
                    <td className="num">{e.atualizados}</td>
                    <td className="num">{e.removidos}</td>
                    <td className="num">{e.ignorados}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {chaves
        .filter((c) => diags.has(c.unidade_id))
        .map((c) => (
          <PainelDiagnostico key={c.unidade_id} nome={c.unidade_nome} d={diags.get(c.unidade_id)!} />
        ))}
    </>
  );
}
