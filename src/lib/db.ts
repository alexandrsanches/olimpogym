import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "./data");
export const UPLOADS_DIR = path.join(DATA_DIR, "comprovantes");

export type Tipo = "despesa" | "receita";
export type Status = "aberto" | "pago";
export type Papel = "admin" | "editor" | "leitura";

// Cada item é aplicado uma vez, em ordem. Nunca altere um item já publicado: acrescente outro.
const MIGRACOES: string[] = [
  `
  CREATE TABLE usuarios (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    senha_hash TEXT NOT NULL,
    papel TEXT NOT NULL DEFAULT 'leitura' CHECK (papel IN ('admin','editor','leitura')),
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessoes (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_em TEXT NOT NULL
  );

  CREATE TABLE unidades (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL UNIQUE,
    ativo INTEGER NOT NULL DEFAULT 1
  );

  -- Unidades que cada usuário (não administrador) pode ver e editar.
  CREATE TABLE usuario_unidades (
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    unidade_id INTEGER NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, unidade_id)
  );

  -- Saldo da conta de cada unidade numa data de referência.
  CREATE TABLE saldos_iniciais (
    unidade_id INTEGER PRIMARY KEY REFERENCES unidades(id) ON DELETE CASCADE,
    valor_centavos INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE categorias (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('despesa','receita')),
    ativo INTEGER NOT NULL DEFAULT 1,
    UNIQUE (nome, tipo)
  );

  CREATE TABLE lancamentos (
    id INTEGER PRIMARY KEY,
    unidade_id INTEGER NOT NULL REFERENCES unidades(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('despesa','receita')),
    descricao TEXT NOT NULL,
    fornecedor TEXT,
    categoria_id INTEGER REFERENCES categorias(id),
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 0),
    vencimento TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','pago')),
    data_pagamento TEXT,
    valor_pago_centavos INTEGER,
    forma_pagamento TEXT,
    comprovante_arquivo TEXT,
    comprovante_nome TEXT,
    recorrencia_id TEXT,
    parcela INTEGER,
    observacao TEXT,
    origem TEXT NOT NULL DEFAULT 'manual',
    import_chave TEXT UNIQUE,
    criado_por INTEGER REFERENCES usuarios(id),
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (status = 'aberto' OR data_pagamento IS NOT NULL)
  );
  CREATE INDEX idx_lanc_vencimento ON lancamentos(vencimento);
  CREATE INDEX idx_lanc_pagamento ON lancamentos(data_pagamento);
  CREATE INDEX idx_lanc_recorrencia ON lancamentos(recorrencia_id);
  CREATE INDEX idx_lanc_unidade ON lancamentos(unidade_id);

  CREATE TABLE configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  );

  INSERT INTO unidades (nome) VALUES ('Unidade 1'), ('Unidade 2');

  INSERT INTO categorias (nome, tipo) VALUES
    ('Aluguel','despesa'), ('Energia / Água','despesa'), ('Folha / Pró-labore','despesa'),
    ('Impostos','despesa'), ('Manutenção / Equipamentos','despesa'), ('Marketing','despesa'),
    ('Limpeza','despesa'), ('Sistemas','despesa'), ('Taxas de cartão','despesa'), ('Outros','despesa'),
    ('Mensalidades','receita'), ('Planos','receita'), ('Avulsos / Diárias','receita'),
    ('Produtos','receita'), ('Outras receitas','receita');
  `,
  // 2: login também pelo nome de usuário
  `
  ALTER TABLE usuarios ADD COLUMN usuario TEXT COLLATE NOCASE;
  CREATE UNIQUE INDEX idx_usuarios_usuario ON usuarios(usuario);
  -- o primeiro administrador já existente passa a entrar também como "admin"
  UPDATE usuarios SET usuario = 'admin' WHERE id = (SELECT MIN(id) FROM usuarios WHERE papel = 'admin');
  `,
  // 3: sincronização das contas a receber do Octagym
  `
  -- unidades (filiais) do Octagym e a unidade do sistema ligada a cada uma
  CREATE TABLE octagym_lojas (
    store_id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    unidade_id INTEGER REFERENCES unidades(id) ON DELETE SET NULL,
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE octagym_execucoes (
    id INTEGER PRIMARY KEY,
    gatilho TEXT NOT NULL,
    inicio TEXT NOT NULL DEFAULT (datetime('now')),
    fim TEXT,
    ok INTEGER,
    mensagem TEXT,
    lidos INTEGER NOT NULL DEFAULT 0,
    criados INTEGER NOT NULL DEFAULT 0,
    atualizados INTEGER NOT NULL DEFAULT 0,
    removidos INTEGER NOT NULL DEFAULT 0,
    ignorados INTEGER NOT NULL DEFAULT 0
  );
  `,
  // 4: no Octagym cada unidade é uma empresa com a sua própria chave de API
  `
  DROP TABLE octagym_lojas;
  CREATE TABLE octagym_chaves (
    unidade_id INTEGER PRIMARY KEY REFERENCES unidades(id) ON DELETE CASCADE,
    chave TEXT NOT NULL,
    empresa TEXT,
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  DELETE FROM configuracoes WHERE chave IN ('octagym_unidade_padrao', 'octagym_diagnostico');
  `,
];

export function migrar(db: Database.Database): void {
  const versao = db.pragma("user_version", { simple: true }) as number;
  for (let i = versao; i < MIGRACOES.length; i++) {
    db.transaction(() => {
      db.exec(MIGRACOES[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

export function abrirBanco(arquivo: string): Database.Database {
  const db = new Database(arquivo);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrar(db);
  return db;
}

const globalComBanco = globalThis as unknown as { __olimpoDb?: Database.Database };

export function getDb(): Database.Database {
  if (!globalComBanco.__olimpoDb) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    globalComBanco.__olimpoDb = abrirBanco(path.join(DATA_DIR, "fluxo.db"));
  }
  return globalComBanco.__olimpoDb;
}

/** Fragmento SQL "col IN (1,2)" para filtrar por unidades. Lista vazia não casa com nada. */
export function emUnidades(coluna: string, ids: number[]): string {
  const validos = ids.filter((i) => Number.isInteger(i));
  return validos.length ? `${coluna} IN (${validos.join(",")})` : "0";
}
