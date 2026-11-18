"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Menu suspenso "Administração": fecha ao escolher um item, ao clicar fora ou com Esc. */
export function MenuAdmin() {
  const ref = useRef<HTMLDetailsElement>(null);
  const caminho = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [caminho]);

  useEffect(() => {
    const fechar = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("click", fechar);
    document.addEventListener("keydown", fechar);
    return () => {
      document.removeEventListener("click", fechar);
      document.removeEventListener("keydown", fechar);
    };
  }, []);

  return (
    <details className="menu" ref={ref}>
      <summary>Administração</summary>
      <div className="menu-itens">
        <Link href="/configuracoes">Configurações</Link>
        <Link href="/usuarios">Usuários</Link>
      </div>
    </details>
  );
}
