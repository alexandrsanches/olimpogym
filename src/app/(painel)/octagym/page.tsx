import { acaoSalvarOctagym, acaoSincronizarOctagym, acaoTestarOctagym } from "../../acoes";
import { exigirContexto } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listarCategorias, listarUnidades } from "@/lib/lancamentos";
import { chaveConfigurada, sincronizando } from "@/lib/octagym/servico";
import { lerConfig, lerDiagnostico, listarExecucoes, listarLojas } from "@/lib/octagym/sincronizacao";
import { Mensagens, type SP } from "../../ui";

const GATILHO: Record<string, string> = { automatico: "Automática", manual: "Manual", teste: "Teste" };

function dataHora(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export default async function Octagym({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await exigirContexto("admin");
  const db = getDb();
  const cfg = lerConfig(db);
  const temChave = chaveConfigurada();
  const lojas = listarLojas(db);
  const unidades = listarUnidades(db);
  const categorias = listarCategorias(db, "receita");
  const execucoes = listarExecucoes(db);
  const diag = lerDiagnostico(db);
  const ultimaOk = execucoes.find((e) => e.ok === 1 && e.gatilho !== "teste");

  return (
    <>
      <Mensagens sp={sp} />
      <div className="cabecalho">
        <div>
          <h1>Integração Octagym</h1>
          <div className="muted">Importa automaticamente as contas a receber do Octagym como receitas, por unidade.</div>
        </div>
        <form className="acoes">
          <button formAction={acaoTestarOctagym} type="submit" disabled={!temChave}>
            Testar conexão
          </button>
          <button formAction={acaoSincronizarOctagym} type="submit" className="primario" disabled={!temChave}>
            Sincronizar agora
          </button>
        </form>
      </div>

      <div className="grade">
        <div className={`card kpi ${temChave ? "" : "alerta"}`}>
          <div className="rotulo">Chave da API</div>
          <div className="valor" style={{ fontSize: "1.1rem" }}>{temChave ? "Configurada" : "Não configurada"}</div>
          <div className="det">{temChave ? "lida de OCTAGYM_API_KEY no servidor" : "coloque OCTAGYM_API_KEY no .env do servidor (veja abaixo)"}</div>
        </div>
        <div className="card kpi">
          <div className="rotulo">Sincronização automática</div>
          <div className="valor" style={{ fontSize: "1.1rem" }}>{cfg.ativo ? `Ligada · a cada ${cfg.intervaloMin} min` : "Desligada"}</div>
          <div className="det">{sincronizando() ? "sincronizando agora…" : `última com sucesso: ${dataHora(ultimaOk?.fim)}`}</div>
        </div>
        <div className="card kpi">
          <div className="rotulo">Filiais do Octagym</div>
          <div className="valor" style={{ fontSize: "1.1rem" }}>{lojas.length ? `${lojas.filter((l) => l.unidade_id).length} de ${lojas.length} ligadas` : "—"}</div>
          <div className="det">{lojas.length ? "ligue cada filial a uma unidade abaixo" : "aparecem após o primeiro teste de conexão"}</div>
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
          <label>
            Unidade para títulos sem filial
            <select name="unidade_padrao" defaultValue={cfg.unidadePadraoId ?? ""}>
              <option value="">Ignorar esses títulos</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </label>

          {lojas.length > 0 && (
            <fieldset className="inteiro">
              <legend className="muted small">Filial do Octagym → unidade do sistema</legend>
              <div className="tabela-wrap">
                <table>
                  <tbody>
                    {lojas.map((l) => (
                      <tr key={l.store_id}>
                        <td>
                          {l.nome}
                          <div className="muted small">{l.store_id}</div>
                        </td>
                        <td>
                          <select name={`loja:${l.store_id}`} defaultValue={l.unidade_id ?? ""} aria-label={`Unidade para ${l.nome}`}>
                            <option value="">Não importar</option>
                            {unidades.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.nome}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </fieldset>
          )}
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
                      {e.mensagem && <div className={e.ok ? "muted" : "perigo"}>{e.mensagem}</div>}
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

      {diag && (
        <details className="card" style={{ marginBottom: 16 }} open={!diag.ok}>
          <summary>Diagnóstico do último teste / sincronização ({dataHora(diag.quando)})</summary>
          <div className="small" style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <div>
              <strong>Resultado:</strong> {diag.mensagem}
            </div>
            <div>
              <strong>Ferramentas financeiras liberadas pela chave:</strong> {diag.ferramentasFinanceiras.join(", ") || "nenhuma"}
            </div>
            <div>
              <strong>Parâmetros de list_financial_titles:</strong> {diag.parametrosTitulos.join(", ") || "—"}
            </div>
            <div>
              <strong>Argumentos usados:</strong> {diag.argumentosUsados.join(" · ") || "—"}
            </div>
            {diag.contagem && Object.keys(diag.contagem.motivosIgnorados).length > 0 && (
              <div>
                <strong>Motivos dos ignorados:</strong>{" "}
                {Object.entries(diag.contagem.motivosIgnorados)
                  .map(([m, n]) => `${m} (${n})`)
                  .join(" · ")}
              </div>
            )}
            {diag.exemploBruto != null && (
              <div className="grade-2" style={{ marginBottom: 0 }}>
                <div>
                  <strong>Exemplo recebido do Octagym (dados pessoais ocultos)</strong>
                  <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--bg)", padding: 10, borderRadius: 8, maxHeight: 360, overflow: "auto" }}>
                    {JSON.stringify(diag.exemploBruto, null, 2)}
                  </pre>
                </div>
                <div>
                  <strong>Como o sistema interpretou</strong>
                  <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--bg)", padding: 10, borderRadius: 8, maxHeight: 360, overflow: "auto" }}>
                    {JSON.stringify(diag.exemploInterpretado, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </details>
      )}

      {!temChave && (
        <div className="card small">
          <h2>Como ligar a integração</h2>
          <ol style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 6 }}>
            <li>
              No Octagym: <strong>Configurações → Desenvolvedor → Nova Chave</strong>, marque só <strong>Financeiro → Leitura</strong> e copie a chave
              (começa com <code>og_live_</code>).
            </li>
            <li>
              No servidor, edite <code>/opt/olimpogym/.env</code> e acrescente a linha <code>OCTAGYM_API_KEY=og_live_…</code>
            </li>
            <li>
              Reinicie: <code>cd /opt/olimpogym &amp;&amp; docker compose up -d --force-recreate</code>
            </li>
            <li>
              Volte aqui, clique em <strong>Testar conexão</strong>, ligue as filiais às unidades, marque “Sincronizar automaticamente” e salve.
            </li>
          </ol>
        </div>
      )}
    </>
  );
}
