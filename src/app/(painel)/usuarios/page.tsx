import { acaoAtualizarUsuario, acaoCriarUsuario, acaoRedefinirSenha } from "../../acoes";
import { DESCRICAO_PAPEL, exigirContexto, NOMES_PAPEL } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listarUnidades } from "@/lib/lancamentos";
import { listarUsuarios, PAPEIS } from "@/lib/usuarios";
import { Mensagens, type SP } from "../../ui";

export default async function Usuarios({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await exigirContexto("admin");
  const db = getDb();
  const usuarios = listarUsuarios(db);
  const unidades = listarUnidades(db);

  return (
    <>
      <Mensagens sp={sp} />
      <div className="cabecalho">
        <div>
          <h1>Usuários e permissões</h1>
          <div className="muted small">
            {PAPEIS.map((p) => (
              <div key={p}>
                <strong>{NOMES_PAPEL[p]}:</strong> {DESCRICAO_PAPEL[p]}
              </div>
            ))}
            <div>Administradores veem todas as unidades. Os demais só as unidades marcadas.</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Novo usuário</h2>
        <form action={acaoCriarUsuario} className="grid">
          <label>
            Nome
            <input name="nome" required maxLength={100} />
          </label>
          <label>
            E-mail (login)
            <input name="email" type="email" required autoComplete="off" />
          </label>
          <label>
            Senha inicial (mín. 10 caracteres)
            <input name="senha" type="password" required minLength={10} autoComplete="new-password" />
          </label>
          <label>
            Permissão
            <select name="papel" defaultValue="editor">
              {PAPEIS.map((p) => (
                <option key={p} value={p}>
                  {NOMES_PAPEL[p]}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="inteiro acoes">
            <legend className="muted small">Unidades</legend>
            {unidades.map((u) => (
              <label key={u.id} className="check">
                <input type="checkbox" name="unidades" value={u.id} defaultChecked /> {u.nome}
              </label>
            ))}
          </fieldset>
          <div className="inteiro">
            <button className="primario" type="submit">
              Criar usuário
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Usuários cadastrados</h2>
        <div className="tabela-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Permissão, unidades e status</th>
                <th>Redefinir senha</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} style={u.ativo ? undefined : { opacity: 0.6 }}>
                  <td>
                    <strong>{u.nome}</strong>
                    {u.id === ctx.usuario.id && <span className="muted"> (você)</span>}
                    <div className="muted small">{u.email}</div>
                  </td>
                  <td>
                    <form action={acaoAtualizarUsuario} className="acoes">
                      <input type="hidden" name="id" value={u.id} />
                      <select name="papel" defaultValue={u.papel} aria-label="Permissão">
                        {PAPEIS.map((p) => (
                          <option key={p} value={p}>
                            {NOMES_PAPEL[p]}
                          </option>
                        ))}
                      </select>
                      {unidades.map((un) => (
                        <label key={un.id} className="check small">
                          <input type="checkbox" name="unidades" value={un.id} defaultChecked={u.papel === "admin" || u.unidades.includes(un.id)} /> {un.nome}
                        </label>
                      ))}
                      <label className="check small">
                        <input type="checkbox" name="ativo" value="1" defaultChecked={!!u.ativo} /> Ativo
                      </label>
                      <button type="submit">Salvar</button>
                    </form>
                  </td>
                  <td>
                    <form action={acaoRedefinirSenha} className="acoes">
                      <input type="hidden" name="id" value={u.id} />
                      <input type="password" name="senha" minLength={10} required placeholder="nova senha" autoComplete="new-password" aria-label="Nova senha" style={{ width: 150 }} />
                      <button type="submit">Redefinir</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
