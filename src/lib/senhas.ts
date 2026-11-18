import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384;

export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  const h = scryptSync(senha, sal, 64, { N });
  return `scrypt$${N}$${sal.toString("base64")}$${h.toString("base64")}`;
}

export function conferirSenha(senha: string, armazenado: string): boolean {
  const [alg, n, sal, h] = armazenado.split("$");
  if (alg !== "scrypt" || !sal || !h) return false;
  const esperado = Buffer.from(h, "base64");
  const calculado = scryptSync(senha, Buffer.from(sal, "base64"), esperado.length, { N: Number(n) });
  return timingSafeEqual(esperado, calculado);
}

export function novoToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function validarSenhaNova(senha: string): string | null {
  if (senha.length < 10) return "A senha precisa ter pelo menos 10 caracteres.";
  return null;
}
