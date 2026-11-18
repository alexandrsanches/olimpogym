import Link from "next/link";
import type { Contexto } from "@/lib/auth";
import type { Lancamento } from "@/lib/lancamentos";

export type SP = Promise<Record<string, string | string[] | undefined>>;

export function param(sp: Record<string, string | string[] | undefined>, nome: string): string | undefined {
  const v = sp[nome];
  return Array.isArray(v) ? v[0] : v;
}

export function Mensagens({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = param(sp, "ok");
  let erro = param(sp, "erro");
  if (erro === "sem-permissao") erro = "Você não tem permissão para essa ação.";
  return (
    <>
      {ok && <div className="msg ok" role="status">{ok}</div>}
      {erro && <div className="msg erro" role="alert">{erro}</div>}
    </>
  );
}

/** Abas de unidade (só aparecem se o usuário tem mais de uma). */
export function SeletorUnidade({ ctx, atual, base, extra = {} }: { ctx: Contexto; atual: number | "todas"; base: string; extra?: Record<string, string | undefined> }) {
  if (ctx.unidades.length < 2) return null;
  const href = (u: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    q.set("unidade", u);
    return `${base}?${q}`;
  };
  return (
    <nav className="abas" aria-label="Unidade">
      <Link href={href("todas")} className={atual === "todas" ? "ativa" : ""}>
        Todas (consolidado)
      </Link>
      {ctx.unidades.map((u) => (
        <Link key={u.id} href={href(String(u.id))} className={atual === u.id ? "ativa" : ""}>
          {u.nome}
        </Link>
      ))}
    </nav>
  );
}

export function StatusTag({ l, hoje }: { l: Lancamento; hoje: string }) {
  if (l.status === "pago") return <span className="tag pago">{l.tipo === "receita" ? "Recebido" : "Pago"}</span>;
  if (l.vencimento < hoje) return <span className="tag vencido">{l.tipo === "receita" ? "Atrasado" : "Vencido"}</span>;
  return <span className="tag">{l.tipo === "receita" ? "A receber" : "A pagar"}</span>;
}
