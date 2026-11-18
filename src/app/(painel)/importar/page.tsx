import { acaoDesfazerLote, acaoImportar } from "../../acoes";
import { exigirContexto } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listarCategorias, listarLotes } from "@/lib/lancamentos";
import { formatBRL } from "@/lib/money";
import { Mensagens, param, type SP } from "../../ui";

export default async function Importar({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await exigirContexto("editor");
  const db = getDb();
  const categorias = listarCategorias(db, "receita");
  const lotes = listarLotes(db, ctx.ids);
  const unidade = Number(param(sp, "unidade")) || undefined;

  return (
    <>
      <Mensagens sp={sp} />
      <div className="cabecalho">
        <div>
          <h1>Importar recebimentos do Octagym</h1>
          <div className="muted">Exporte o relatório financeiro no Octagym (CSV) e envie aqui. Cada linha vira uma receita da unidade escolhida.</div>
        </div>
      </div>

      <div className="grade-2">
        <div className="card">
          <form action={acaoImportar} className="grid">
            <label>
              Unidade
              <select name="unidade_id" required defaultValue={unidade ?? (ctx.unidades.length === 1 ? ctx.unidades[0].id : "")}>
                {ctx.unidades.length > 1 && <option value="">Escolha…</option>}
                {ctx.unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Categoria padrão
              <select name="categoria_id" defaultValue={categorias.find((c) => c.nome === "Mensalidades")?.id ?? ""}>
                <option value="">Sem categoria</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="inteiro">
              Arquivo CSV
              <input type="file" name="arquivo" required accept=".csv,text/csv,text/plain" />
            </label>
            <div className="inteiro">
              <button className="primario" type="submit">
                Importar
              </button>
            </div>
          </form>
        </div>
        <div className="card small">
          <h2>Como funciona</h2>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li>
              Colunas reconhecidas pelo nome do cabeçalho: <strong>valor</strong>, <strong>vencimento</strong> ou <strong>data</strong>, <strong>data de pagamento</strong>,{" "}
              <strong>aluno/cliente</strong>, <strong>plano/descrição</strong>, <strong>status/situação</strong>, <strong>forma de pagamento</strong>.
            </li>
            <li>Status “pago”, “recebido”, “confirmado”, “liquidado”… viram <em>recebido</em>; os demais ficam <em>a receber</em>.</li>
            <li>Pode enviar o mesmo relatório de novo: linhas já importadas são ignoradas.</li>
            <li>Separador “;” ou “,”, valores como 1.234,56 e datas como 31/12/2026.</li>
            <li>Errou? Desfaça a importação inteira na lista ao lado.</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <h2>Últimas importações</h2>
        {lotes.length === 0 ? (
          <p className="muted">Nenhuma importação ainda.</p>
        ) : (
          <div className="tabela-wrap">
            <table>
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Unidade</th>
                  <th className="num">Lançamentos</th>
                  <th className="num">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lotes.map((l) => (
                  <tr key={l.origem}>
                    <td className="small">{l.origem.replace("importacao:", "")}</td>
                    <td>{l.unidade_nome}</td>
                    <td className="num">{l.quantidade}</td>
                    <td className="num">{formatBRL(l.total)}</td>
                    <td>
                      <form action={acaoDesfazerLote}>
                        <input type="hidden" name="origem" value={l.origem} />
                        <button className="perigo" type="submit">
                          Desfazer
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
