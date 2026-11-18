// Cópia consistente do banco (pode rodar com o sistema no ar).
// Uso: node scripts/backup.mjs [pasta-destino] [dias-para-manter]
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.DATA_DIR || "./data";
const destino = process.argv[2] || process.env.BACKUP_DIR || "./backups";
const manter = Number(process.argv[3] || 30);
fs.mkdirSync(destino, { recursive: true });
const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const arquivo = path.join(destino, `fluxo-${carimbo}.db`);
const db = new Database(path.join(dataDir, "fluxo.db"), { readonly: true });
await db.backup(arquivo);
db.close();
console.log(`backup: ${arquivo}`);
const limite = Date.now() - manter * 86_400_000;
for (const f of fs.readdirSync(destino)) {
  const p = path.join(destino, f);
  if (/^fluxo-.*\.db$/.test(f) && fs.statSync(p).mtimeMs < limite) fs.rmSync(p);
}
