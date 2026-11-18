import { acaoTrocarSenha } from "../../acoes";
import { exigirContexto, NOMES_PAPEL } from "@/lib/auth";
import { Mensagens, type SP } from "../../ui";

export default async function Conta({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await exigirContexto();
  return (
    <>
      <Mensagens sp={sp} />
      <h1>Minha conta</h1>
      <p className="muted">
        {ctx.usuario.nome} · {ctx.usuario.email} · {NOMES_PAPEL[ctx.usuario.papel]} · unidades: {ctx.unidades.map((u) => u.nome).join(", ") || "nenhuma"}
      </p>
      <div className="card" style={{ maxWidth: 420 }}>
        <h2>Trocar senha</h2>
        <form action={acaoTrocarSenha} style={{ display: "grid", gap: 12 }}>
          <label>
            Senha atual
            <input type="password" name="atual" required autoComplete="current-password" />
          </label>
          <label>
            Nova senha (mín. 10 caracteres)
            <input type="password" name="nova" required minLength={10} autoComplete="new-password" />
          </label>
          <label>
            Confirme a nova senha
            <input type="password" name="confirmacao" required minLength={10} autoComplete="new-password" />
          </label>
          <button className="primario" type="submit">
            Trocar senha
          </button>
        </form>
      </div>
    </>
  );
}
