import type { Contexto } from "@/lib/auth";
import type { Tipo } from "@/lib/db";
import { FORMAS_PAGAMENTO, type Categoria, type Lancamento } from "@/lib/lancamentos";
import { centavosParaInput } from "@/lib/money";

/** Campos comuns de um lançamento (novo e edição). */
export function CamposLancamento({ ctx, categorias, tipo, unidade, l }: { ctx: Contexto; categorias: Categoria[]; tipo: Tipo; unidade?: number; l?: Lancamento }) {
  const despesa = tipo === "despesa";
  return (
    <>
      <input type="hidden" name="tipo" value={tipo} />
      <label>
        Unidade
        <select name="unidade_id" required defaultValue={l?.unidade_id ?? unidade ?? (ctx.unidades.length === 1 ? ctx.unidades[0].id : "")}>
          {ctx.unidades.length > 1 && <option value="">Escolha…</option>}
          {ctx.unidades.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </select>
      </label>
      <label>
        Descrição
        <input name="descricao" required maxLength={200} defaultValue={l?.descricao} placeholder={despesa ? "Ex.: Conta de luz" : "Ex.: Mensalidades"} />
      </label>
      <label>
        {despesa ? "Fornecedor" : "Cliente / aluno"}
        <input name="fornecedor" maxLength={200} defaultValue={l?.fornecedor ?? ""} placeholder={despesa ? "Ex.: Enel" : ""} />
      </label>
      <label>
        Categoria
        <select name="categoria_id" defaultValue={l?.categoria_id ?? ""}>
          <option value="">Sem categoria</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
          {l?.categoria_id && !categorias.some((c) => c.id === l.categoria_id) && <option value={l.categoria_id}>{l.categoria_nome} (inativa)</option>}
        </select>
      </label>
      <label>
        Valor (R$)
        <input name="valor" required inputMode="decimal" placeholder="0,00" defaultValue={centavosParaInput(l?.valor_centavos)} pattern="[0-9.,\s]+" />
      </label>
      <label>
        Vencimento {despesa ? "" : "/ data prevista"}
        <input name="vencimento" type="date" required defaultValue={l?.vencimento} />
      </label>
      <label>
        Forma de pagamento
        <select name="forma_pagamento" defaultValue={l?.forma_pagamento ?? ""}>
          <option value="">—</option>
          {FORMAS_PAGAMENTO.map((f) => (
            <option key={f}>{f}</option>
          ))}
          {l?.forma_pagamento && !(FORMAS_PAGAMENTO as readonly string[]).includes(l.forma_pagamento) && <option>{l.forma_pagamento}</option>}
        </select>
      </label>
      <label className="inteiro">
        Observação
        <textarea name="observacao" maxLength={2000} defaultValue={l?.observacao ?? ""} />
      </label>
    </>
  );
}
