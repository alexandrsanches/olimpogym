import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, type Papel } from "./db";
import { conferirSenha, hashSenha, hashToken, novoToken } from "./senhas";
import { unidadesDoUsuario } from "./usuarios";

const COOKIE = "olimpo_sessao";
const DURACAO_DIAS = 30;

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  papel: Papel;
}

/** Na primeira execução, cria o administrador a partir de ADMIN_EMAIL / ADMIN_PASSWORD. */
export function garantirAdmin(): void {
  const db = getDb();
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM usuarios").get() as { n: number };
  if (n > 0) return;
  const email = process.env.ADMIN_EMAIL;
  const senha = process.env.ADMIN_PASSWORD;
  if (!email || !senha) return;
  db.prepare("INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, 'admin')").run(
    process.env.ADMIN_NOME || "Administrador",
    email,
    hashSenha(senha),
  );
}

// Limite simples de tentativas de login por e-mail (em memória).
const tentativas = new Map<string, { n: number; ate: number }>();

export function loginBloqueado(email: string): boolean {
  const t = tentativas.get(email.toLowerCase());
  return !!t && t.n >= 5 && t.ate > Date.now();
}

function registrarFalha(email: string) {
  const k = email.toLowerCase();
  const t = tentativas.get(k);
  const agora = Date.now();
  if (!t || t.ate < agora) tentativas.set(k, { n: 1, ate: agora + 15 * 60_000 });
  else t.n++;
}

export async function entrar(email: string, senha: string): Promise<boolean> {
  garantirAdmin();
  const db = getDb();
  const u = db.prepare("SELECT id, senha_hash FROM usuarios WHERE email = ? AND ativo = 1").get(email.trim()) as
    | { id: number; senha_hash: string }
    | undefined;
  if (!u || !conferirSenha(senha, u.senha_hash)) {
    registrarFalha(email);
    return false;
  }
  tentativas.delete(email.toLowerCase());
  const token = novoToken();
  const expira = new Date(Date.now() + DURACAO_DIAS * 86_400_000);
  db.prepare("DELETE FROM sessoes WHERE expira_em < datetime('now')").run();
  db.prepare("INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)").run(
    hashToken(token),
    u.id,
    expira.toISOString().replace("T", " ").slice(0, 19),
  );
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production",
    path: "/",
    expires: expira,
  });
  return true;
}

export async function sair(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) getDb().prepare("DELETE FROM sessoes WHERE token_hash = ?").run(hashToken(token));
  jar.delete(COOKIE);
}

export async function usuarioAtual(): Promise<Usuario | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return (
    (getDb()
      .prepare(`SELECT u.id, u.nome, u.email, u.papel FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token_hash = ? AND s.expira_em > datetime('now') AND u.ativo = 1`)
      .get(hashToken(token)) as Usuario | undefined) ?? null
  );
}

/** Use no topo de páginas e ações protegidas. */
export async function exigirUsuario(): Promise<Usuario> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  return u;
}

export const NOMES_PAPEL: Record<Papel, string> = {
  admin: "Administrador",
  editor: "Editor",
  leitura: "Somente leitura",
};

export const DESCRICAO_PAPEL: Record<Papel, string> = {
  admin: "Tudo, inclusive usuários, categorias e saldo inicial.",
  editor: "Lança, edita, dá baixa, exclui e importa.",
  leitura: "Só consulta o painel e exporta planilhas.",
};

export function podeEditar(u: Pick<Usuario, "papel"> | null): boolean {
  return u?.papel === "admin" || u?.papel === "editor";
}

/** Para ações que alteram lançamentos (editor ou administrador). */
export async function exigirEditor(): Promise<Usuario> {
  const u = await exigirUsuario();
  if (!podeEditar(u)) redirect("/?erro=sem-permissao");
  return u;
}

export async function exigirAdmin(): Promise<Usuario> {
  const u = await exigirUsuario();
  if (u.papel !== "admin") redirect("/?erro=sem-permissao");
  return u;
}

export async function tokenHashAtual(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? hashToken(token) : null;
}

export interface Contexto {
  usuario: Usuario;
  /** Unidades que o usuário pode acessar. */
  unidades: { id: number; nome: string }[];
  ids: number[];
  podeEditar: boolean;
}

export async function exigirContexto(nivel: "leitura" | "editor" | "admin" = "leitura"): Promise<Contexto> {
  const usuario = nivel === "admin" ? await exigirAdmin() : nivel === "editor" ? await exigirEditor() : await exigirUsuario();
  const unidades = unidadesDoUsuario(getDb(), usuario);
  return { usuario, unidades, ids: unidades.map((u) => u.id), podeEditar: podeEditar(usuario) };
}

/** Converte o parâmetro ?unidade= (id ou "todas") na lista de unidades a mostrar. */
export function unidadesSelecionadas(ctx: Contexto, param: string | undefined): { ids: number[]; atual: number | "todas" } {
  const id = Number(param);
  if (param && param !== "todas" && ctx.ids.includes(id)) return { ids: [id], atual: id };
  if (ctx.ids.length === 1) return { ids: ctx.ids, atual: ctx.ids[0] };
  return { ids: ctx.ids, atual: "todas" };
}
