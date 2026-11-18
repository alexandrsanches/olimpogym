import { acaoAlternarCategoria, acaoAlternarUnidade, acaoRenomearCategoria, acaoCriarCategoria, acaoSaldoInicial, acaoSalvarUnidade } from "../../acoes";
import { exigirContexto } from "@/lib/auth";
import { formatData } from "@/lib/datas";
import { getDb } from "@/lib/db";
import { listarSaldosIniciais } from "@/lib/fluxo";
import { listarCategorias, listarUnidades } from "@/lib/lancamentos";
import { centavosParaInput, formatBRL } from "@/lib/money";
import { Mensagens, type SP } from "../../ui";

export default async function Configuracoes({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await exigirContexto("admin");
  const db = getDb();
  const unidades = listarUnidades(db, true);
  const saldos = new Map(listarSaldosIniciais(db).map((s) => [s.unidade_id, s]));
  const categorias = listarCategorias(db, undefined, true);

  return (
    <>
      <Mensagens sp={sp} />
      <h1 style={{ marginBottom: 16 }}>Configurações</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Unidades e saldo inicial das contas</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          O saldo inicial é o valor na conta da unidade no fim do dia informado (ex.: saldo do extrato em 31/10). Pagamentos e recebimentos depois dessa data
          são somados a ele.
        </p>
        <div className="tabela-wrap">
          <table>
            <thead>
              <tr>
                <th>Unidade</th>
                <th>Saldo inicial</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {unidades.map((u) => {
                const s = saldos.get(u.id);
                return (
                  <tr key={u.id} style={u.ativo ? undefined : { opacity: 0.6 }}>
                    <td>
                      <form action={acaoSalvarUnidade} className="acoes">
                        <input type="hidden" name="id" value={u.id} />
                        <input name="nome" defaultValue={u.nome} required maxLength={60} aria-label="Nome da unidade" />
                        <button type="submit">Renomear</button>
                      </form>
                    </td>
                    <td>
                      <form action={acaoSaldoInicial} className="acoes">
                        <input type="hidden" name="unidade_id" value={u.id} />
                        <input name="valor" inputMode="decimal" required placeholder="0,00" defaultValue={centavosParaInput(s?.valor_centavos)} aria-label="Saldo" style={{ width: 130 }} />
                        <span className="muted small">em</span>
                        <input type="date" name="data" required defaultValue={s?.data} aria-label="Data do saldo" />
                        <button type="submit">Salvar</button>
                      </form>
                      <div className="muted small">{s ? `${formatBRL(s.valor_centavos)} em ${formatData(s.data)}` : "não definido (considera R$ 0,00)"}</div>
                    </td>
                    <td>
                      <form action={acaoAlternarUnidade}>
                        <input type="hidden" name="id" value={u.id} />
                        <button type="submit" className="link">
                          {u.ativo ? "desativar" : "reativar"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <form action={acaoSalvarUnidade} className="acoes" style={{ marginTop: 12 }}>
          <input name="nome" required maxLength={60} placeholder="Nome da nova unidade" aria-label="Nome da nova unidade" />
          <button type="submit">Adicionar unidade</button>
        </form>
      </div>

      <div className="card">
        <h2>Categorias</h2>
        <form action={acaoCriarCategoria} className="acoes" style={{ marginBottom: 12 }}>
          <input name="nome" required maxLength={60} placeholder="Nova categoria" aria-label="Nome da categoria" />
          <select name="tipo" defaultValue="despesa" aria-label="Tipo">
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
          </select>
          <button type="submit">Adicionar</button>
        </form>
        <div className="grade-2">
          {(["despesa", "receita"] as const).map((tipo) => (
            <div key={tipo}>
              <h3 className={`small ${tipo}`} style={{ textTransform: "uppercase" }}>
                {tipo === "despesa" ? "Despesas" : "Receitas"}
              </h3>
              <table>
                <tbody>
                  {categorias
                    .filter((c) => c.tipo === tipo)
                    .map((c) => (
                      <tr key={c.id} style={c.ativo ? undefined : { opacity: 0.5 }}>
                        <td>
                          <form action={acaoRenomearCategoria} className="acoes" style={{ flexWrap: "nowrap" }}>
                            <input type="hidden" name="id" value={c.id} />
                            <input name="nome" defaultValue={c.nome} required maxLength={60} aria-label={`Nome da categoria ${c.nome}`} style={{ minWidth: 0, flex: 1 }} />
                            <button type="submit">Renomear</button>
                          </form>
                        </td>
                        <td className="num">
                          <form action={acaoAlternarCategoria}>
                            <input type="hidden" name="id" value={c.id} />
                            <button type="submit" className="link">
                              {c.ativo ? "desativar" : "reativar"}
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
