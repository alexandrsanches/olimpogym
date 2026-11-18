import { redirect } from "next/navigation";
import { acaoEntrar } from "../acoes";
import { garantirAdmin, usuarioAtual } from "@/lib/auth";
import { param, type SP } from "../ui";
import { CampoSenha } from "./campo-senha";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: SP }) {
  garantirAdmin();
  if (await usuarioAtual()) redirect("/");
  const sp = await searchParams;
  const erro = param(sp, "erro");

  return (
    <div className="tela-login">
      <main className="login-centro">
        <img src="/logo.png" alt="Olimpo Gym" className="login-logo" width={120} height={92} />
        <div className="login-cartao">
          <h1>Sistema gerenciador de caixa - Olimpo Gym</h1>
          {erro && (
            <div className="login-erro" role="alert">
              {erro}
            </div>
          )}
          <form action={acaoEntrar}>
            <input name="login" placeholder="Usuário ou e-mail" aria-label="Usuário ou e-mail" autoComplete="username" autoCapitalize="none" required autoFocus />
            <CampoSenha />
            <label className="login-lembrar">
              <input type="checkbox" name="lembrar" value="1" defaultChecked /> Lembre-se de mim
            </label>
            <button type="submit" className="login-entrar">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="currentColor" d="M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4z" />
              </svg>
              Entrar
            </button>
          </form>
          <details className="login-esqueci">
            <summary>Esqueceu a senha?</summary>
            <p>Peça a um administrador do sistema para redefinir a sua senha em Administração → Usuários.</p>
          </details>
        </div>
      </main>
      <footer className="login-rodape">
        <strong>Olimpo Gym</strong> – Controle de fluxo de caixa da Olimpo Gym.
      </footer>
    </div>
  );
}
