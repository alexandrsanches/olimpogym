import Link from "next/link";
import { acaoSair } from "../acoes";
import { exigirContexto, NOMES_PAPEL } from "@/lib/auth";
import { MenuAdmin } from "./menu-admin";

export const dynamic = "force-dynamic";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await exigirContexto();
  const { usuario } = ctx;
  return (
    <>
      <header className="topo">
        <div className="topo-in">
          <Link href="/" className="marca">
            <img src="/logo.png" alt="" width={39} height={30} />
            Olimpo Gym
          </Link>
          <nav className="nav">
            <Link href="/">Painel</Link>
            <Link href="/fluxo">Fluxo diário</Link>
            <Link href="/lancamentos?tipo=despesa">Contas a pagar</Link>
            <Link href="/lancamentos?tipo=receita">Recebimentos</Link>
            {ctx.podeEditar && <Link href="/lancamentos/novo">+ Lançar</Link>}
            {ctx.podeEditar && <Link href="/importar">Importar Octagym</Link>}
            {usuario.papel === "admin" && <MenuAdmin />}
          </nav>
          <div className="usuario">
            <Link href="/conta" title="Minha conta">
              {usuario.nome} · {NOMES_PAPEL[usuario.papel]}
            </Link>
            <form action={acaoSair}>
              <button className="link" type="submit">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main>
        {ctx.unidades.length === 0 ? (
          <div className="msg erro">Seu usuário não tem acesso a nenhuma unidade. Peça ao administrador para liberar.</div>
        ) : (
          children
        )}
      </main>
    </>
  );
}
