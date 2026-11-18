import { redirect } from "next/navigation";
import { acaoEntrar } from "../acoes";
import { garantirAdmin, usuarioAtual } from "@/lib/auth";
import { Mensagens, type SP } from "../ui";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: SP }) {
  garantirAdmin();
  if (await usuarioAtual()) redirect("/");
  const sp = await searchParams;
  return (
    <div className="login">
      <div className="card">
        <h1 style={{ color: "var(--brand)" }}>OlimpoGym</h1>
        <p className="muted" style={{ marginTop: 0 }}>Fluxo de caixa</p>
        <Mensagens sp={sp} />
        <form action={acaoEntrar}>
          <label>
            E-mail
            <input name="email" type="email" autoComplete="username" required autoFocus />
          </label>
          <label>
            Senha
            <input name="senha" type="password" autoComplete="current-password" required />
          </label>
          <button className="primario" type="submit">
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
