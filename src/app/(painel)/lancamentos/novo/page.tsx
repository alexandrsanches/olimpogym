import Link from "next/link";
import { acaoCriarLancamento } from "../../../acoes";
import { exigirContexto } from "@/lib/auth";
import { hoje } from "@/lib/datas";
import { getDb, type Tipo } from "@/lib/db";
import { listarCategorias } from "@/lib/lancamentos";
import { Mensagens, param, type SP } from "../../../ui";
import { CamposLancamento } from "../campos";

export default async function Novo({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ctx = await exigirContexto("editor");
  const tipo: Tipo = param(sp, "tipo") === "receita" ? "receita" : "despesa";
  const unidade = Number(param(sp, "unidade")) || undefined;
  const categorias = listarCategorias(getDb(), tipo);
  const despesa = tipo === "despesa";
  const q = (t: Tipo) => `/lancamentos/novo?tipo=${t}${unidade ? `&unidade=${unidade}` : ""}`;

  return (
    <>
      <Mensagens sp={sp} />
      <div className="cabecalho">
        <h1>Novo lançamento</h1>
        <nav className="abas">
          <Link href={q("despesa")} className={despesa ? "ativa" : ""}>
            Despesa (conta a pagar)
          </Link>
          <Link href={q("receita")} className={!despesa ? "ativa" : ""}>
            Receita (entrada)
          </Link>
        </nav>
      </div>
      <div className="card">
        <form action={acaoCriarLancamento} className="grid">
          <input type="hidden" name="voltar" value={q(tipo)} />
          <CamposLancamento ctx={ctx} categorias={categorias} tipo={tipo} unidade={unidade} />

          <fieldset className="inteiro card" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <legend className="muted small">Recorrência</legend>
            <label className="check">
              <input type="checkbox" name="recorrente" value="1" /> Repete todo mês (ex.: aluguel, salários, sistemas)
            </label>
            <label>
              Quantos meses gerar
              <input type="number" name="meses" min={2} max={60} defaultValue={12} />
            </label>
          </fieldset>

          <fieldset className="inteiro card" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <legend className="muted small">{despesa ? "Já foi paga?" : "Já foi recebida?"}</legend>
            <label className="check">
              <input type="checkbox" name="ja_pago" value="1" /> {despesa ? "Sim, já paguei" : "Sim, já recebi"} (na recorrência, só a 1ª parcela)
            </label>
            <label>
              Data do pagamento
              <input type="date" name="data_pagamento" defaultValue={hoje()} />
            </label>
            <label>
              Valor pago, se diferente (juros, desconto)
              <input name="valor_pago" inputMode="decimal" placeholder="igual ao valor" />
            </label>
            <label>
              Comprovante (PDF ou foto, até 10 MB)
              <input type="file" name="comprovante" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*" />
            </label>
          </fieldset>

          <div className="acoes inteiro">
            <button className="primario" type="submit">
              Salvar
            </button>
            <button type="submit" name="continuar" value="1">
              Salvar e lançar outro
            </button>
            <Link href={`/lancamentos?tipo=${tipo}`}>Cancelar</Link>
          </div>
        </form>
      </div>
    </>
  );
}
