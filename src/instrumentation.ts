// Executado uma vez quando o servidor Next.js sobe.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { iniciarAgendador } = await import("./lib/octagym/servico");
    iniciarAgendador();
  }
}
