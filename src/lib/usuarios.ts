import type Database from "better-sqlite3";
import type { Papel } from "./db";
import { conferirSenha, hashSenha, validarSenhaNova } from "./senhas";

export const PAPEIS: Papel[] = ["admin", "editor", "leitura"];

export interface UsuarioLista {
  id: number;
  nome: string;
  email: string;
  usuario: string | null;
  papel: Papel;
  ativo: number;
  criado_em: string;
  /** ids das unidades liberadas (só vale para quem não é administrador) */
  unidades: number[];
}

export function listarUsuarios(db: Database.Database): UsuarioLista[] {
  const linhas = db
    .prepare(`SELECT u.id, u.nome, u.email, u.usuario, u.papel, u.ativo, u.criado_em, GROUP_CONCAT(uu.unidade_id) AS uns
      FROM usuarios u LEFT JOIN usuario_unidades uu ON uu.usuario_id = u.id
      GROUP BY u.id ORDER BY u.ativo DESC, u.nome`)
    .all() as (Omit<UsuarioLista, "unidades"> & { uns: string | null })[];
  return linhas.map(({ uns, ...u }) => ({ ...u, unidades: uns ? uns.split(",").map(Number) : [] }));
}

/** Unidades que o usuário pode ver e editar. Administrador: todas as ativas. */
export function unidadesDoUsuario(db: Database.Database, usuario: { id: number; papel: Papel }): { id: number; nome: string }[] {
  if (usuario.papel === "admin") return db.prepare("SELECT id, nome FROM unidades WHERE ativo = 1 ORDER BY nome").all() as { id: number; nome: string }[];
  return db
    .prepare(`SELECT un.id, un.nome FROM usuario_unidades uu JOIN unidades un ON un.id = uu.unidade_id
      WHERE uu.usuario_id = ? AND un.ativo = 1 ORDER BY un.nome`)
    .all(usuario.id) as { id: number; nome: string }[];
}

function definirUnidades(db: Database.Database, usuarioId: number, unidades: number[]) {
  db.prepare("DELETE FROM usuario_unidades WHERE usuario_id = ?").run(usuarioId);
  const ins = db.prepare("INSERT OR IGNORE INTO usuario_unidades (usuario_id, unidade_id) SELECT ?, id FROM unidades WHERE id = ?");
  for (const u of unidades) ins.run(usuarioId, u);
}

function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Nome de usuário: 3 a 30 caracteres, letras minúsculas, números, ponto, hífen ou sublinhado. */
export function normalizarUsuario(usuario: string | null | undefined): { valor: string | null; erro?: string } {
  const v = (usuario ?? "").trim().toLowerCase();
  if (!v) return { valor: null };
  if (!/^[a-z0-9._-]{3,30}$/.test(v)) return { valor: null, erro: "Usuário deve ter de 3 a 30 caracteres: letras sem acento, números, ponto, hífen ou sublinhado." };
  return { valor: v };
}

function usuarioEmUso(db: Database.Database, usuario: string, exceto: number | null): boolean {
  // um nome de usuário não pode coincidir com o usuário nem com o e-mail de outra pessoa
  return !!db.prepare("SELECT 1 FROM usuarios WHERE (usuario = @u OR email = @u) AND id IS NOT @exceto").get({ u: usuario, exceto });
}

/** Encontra a conta ativa pelo e-mail ou pelo nome de usuário (sem diferenciar maiúsculas). */
export function buscarParaLogin(db: Database.Database, identificador: string): { id: number; senha_hash: string } | undefined {
  const v = identificador.trim();
  if (!v) return undefined;
  return db.prepare("SELECT id, senha_hash FROM usuarios WHERE ativo = 1 AND (email = @v OR usuario = @v)").get({ v }) as
    | { id: number; senha_hash: string }
    | undefined;
}

export function criarUsuario(
  db: Database.Database,
  d: { nome: string; email: string; usuario?: string | null; senha: string; papel: Papel; unidades: number[] },
): string | null {
  if (!d.nome.trim()) return "Informe o nome.";
  if (!emailValido(d.email.trim())) return "E-mail inválido.";
  if (!PAPEIS.includes(d.papel)) return "Permissão inválida.";
  const erroSenha = validarSenhaNova(d.senha);
  if (erroSenha) return erroSenha;
  const existe = db.prepare("SELECT 1 FROM usuarios WHERE email = ?").get(d.email.trim());
  if (existe) return "Já existe um usuário com esse e-mail.";
  const usuario = normalizarUsuario(d.usuario);
  if (usuario.erro) return usuario.erro;
  if (usuario.valor && usuarioEmUso(db, usuario.valor, null)) return "Esse nome de usuário já está em uso.";
  if (d.papel !== "admin" && d.unidades.length === 0) return "Escolha pelo menos uma unidade.";
  db.transaction(() => {
    const r = db
      .prepare("INSERT INTO usuarios (nome, email, usuario, senha_hash, papel) VALUES (?, ?, ?, ?, ?)")
      .run(d.nome.trim(), d.email.trim(), usuario.valor, hashSenha(d.senha), d.papel);
    definirUnidades(db, Number(r.lastInsertRowid), d.unidades);
  })();
  return null;
}

function adminsAtivos(db: Database.Database, excetoId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE papel='admin' AND ativo=1 AND id <> ?").get(excetoId) as { n: number }).n;
}

/** Altera permissão e/ou status. Impede que o sistema fique sem nenhum administrador ativo. */
export function atualizarUsuario(
  db: Database.Database,
  id: number,
  d: { papel: Papel; ativo: boolean; unidades: number[]; usuario?: string | null },
): string | null {
  if (!PAPEIS.includes(d.papel)) return "Permissão inválida.";
  const atual = db.prepare("SELECT papel, ativo FROM usuarios WHERE id = ?").get(id) as { papel: Papel; ativo: number } | undefined;
  if (!atual) return "Usuário não encontrado.";
  const deixaDeSerAdmin = atual.papel === "admin" && atual.ativo === 1 && (d.papel !== "admin" || !d.ativo);
  if (deixaDeSerAdmin && adminsAtivos(db, id) === 0) return "É preciso manter pelo menos um administrador ativo.";
  if (d.papel !== "admin" && d.unidades.length === 0) return "Escolha pelo menos uma unidade.";
  const usuario = d.usuario === undefined ? undefined : normalizarUsuario(d.usuario);
  if (usuario?.erro) return usuario.erro;
  if (usuario?.valor && usuarioEmUso(db, usuario.valor, id)) return "Esse nome de usuário já está em uso.";
  db.transaction(() => {
    db.prepare("UPDATE usuarios SET papel = ?, ativo = ? WHERE id = ?").run(d.papel, d.ativo ? 1 : 0, id);
    if (usuario) db.prepare("UPDATE usuarios SET usuario = ? WHERE id = ?").run(usuario.valor, id);
    definirUnidades(db, id, d.unidades);
    if (!d.ativo) db.prepare("DELETE FROM sessoes WHERE usuario_id = ?").run(id);
  })();
  return null;
}

/** Senha definida pelo administrador (ex.: usuário esqueceu). Encerra as sessões abertas do usuário. */
export function redefinirSenha(db: Database.Database, id: number, novaSenha: string): string | null {
  const erro = validarSenhaNova(novaSenha);
  if (erro) return erro;
  db.transaction(() => {
    db.prepare("UPDATE usuarios SET senha_hash = ? WHERE id = ?").run(hashSenha(novaSenha), id);
    db.prepare("DELETE FROM sessoes WHERE usuario_id = ?").run(id);
  })();
  return null;
}

/** Troca da própria senha: exige a senha atual. Mantém só a sessão atual. */
export function trocarPropriaSenha(db: Database.Database, id: number, atual: string, nova: string, tokenHashAtual: string | null): string | null {
  const u = db.prepare("SELECT senha_hash FROM usuarios WHERE id = ?").get(id) as { senha_hash: string } | undefined;
  if (!u || !conferirSenha(atual, u.senha_hash)) return "Senha atual incorreta.";
  const erro = validarSenhaNova(nova);
  if (erro) return erro;
  db.transaction(() => {
    db.prepare("UPDATE usuarios SET senha_hash = ? WHERE id = ?").run(hashSenha(nova), id);
    db.prepare("DELETE FROM sessoes WHERE usuario_id = ? AND token_hash IS NOT ?").run(id, tokenHashAtual);
  })();
  return null;
}
