# OlimpoGym · Fluxo de caixa

Sistema web para controlar contas a pagar, recebimentos e o fluxo de caixa das unidades da OlimpoGym.
Roda no próprio servidor (VPS da Hostinger), em `dashboard.olimpogym.com.br`.

## O que ele faz

- **Lançamentos** de despesas (contas a pagar) e receitas, cada um com: unidade, descrição, fornecedor/cliente,
  categoria, valor, vencimento, status (em aberto / pago), data do pagamento, valor pago, forma de pagamento,
  comprovante (PDF ou foto), recorrência mensal e observação.
- **Previsto x realizado**:
  - *previsto* = o que vence (ou vai entrar) no período, pela data de vencimento;
  - *realizado* = o que foi de fato pago ou recebido, pela data do pagamento.
- **Painel** do mês: saldo em caixa hoje, entradas e saídas (previsto e realizado), contas vencidas, a pagar nos
  próximos 7 dias, recebimentos atrasados, projeção de 30/60/90 dias, gastos por categoria e comparativo entre unidades.
- **Fluxo diário**: dia a dia, com saldo realizado até hoje e projetado depois de hoje.
- **Unidades**: cada unidade tem sua própria conta (saldo inicial) e seus lançamentos; o painel mostra uma unidade
  ou o consolidado.
- **Importação do Octagym**: envie o relatório financeiro exportado em CSV; cada linha vira uma receita.
  Linhas repetidas são ignoradas e cada importação pode ser desfeita.
- **Exportar planilha** (CSV para Excel / Nextcloud) de qualquer lista filtrada.
- **Login com permissões**:

  | Permissão | Pode |
  |---|---|
  | Administrador | tudo, inclusive usuários, unidades, categorias e saldo inicial; vê todas as unidades |
  | Editor | lançar, editar, dar baixa, excluir, anexar comprovante, importar e exportar, nas unidades liberadas |
  | Somente leitura | consultar painel, listas e exportar, nas unidades liberadas |

Os dados ficam em um único arquivo SQLite (`data/fluxo.db`) e os comprovantes em `data/comprovantes/`.
Não há servidor de banco de dados para manter.

## Instalação no servidor (VPS)

Pré-requisitos: Docker com o plugin `docker compose`, e o servidor web que já atende o Nextcloud (nginx ou Apache).

### 1. DNS na Hostinger

No painel da Hostinger → **Domínios → olimpogym.com.br → DNS**, crie um registro:

| Tipo | Nome | Aponta para | TTL |
|---|---|---|---|
| A | `dashboard` | o mesmo IP do `cloud.olimpogym.com.br` | 3600 |

### 2. Baixar o código e configurar

```bash
cd /opt
git clone https://github.com/alexandrsanches/olimpogym.git
cd olimpogym
cp .env.example .env
nano .env   # defina ADMIN_EMAIL e ADMIN_PASSWORD
```

### 3. Subir o sistema

```bash
docker compose up -d --build
docker compose ps        # deve aparecer "healthy" após alguns segundos
curl http://127.0.0.1:3000/saude
```

O sistema escuta só em `127.0.0.1:3000`. Ele não fica exposto direto na internet.

### 4. Publicar em dashboard.olimpogym.com.br com HTTPS

**nginx:**

```bash
cp deploy/nginx-dashboard.conf /etc/nginx/sites-available/dashboard.olimpogym.com.br
ln -s /etc/nginx/sites-available/dashboard.olimpogym.com.br /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d dashboard.olimpogym.com.br
```

**Apache:**

```bash
a2enmod proxy proxy_http headers
cp deploy/apache-dashboard.conf /etc/apache2/sites-available/dashboard.olimpogym.com.br.conf
a2ensite dashboard.olimpogym.com.br && systemctl reload apache2
certbot --apache -d dashboard.olimpogym.com.br
```

Se o Nextcloud roda via Nextcloud AIO ou outro proxy (Caddy, Traefik), aponte `dashboard.olimpogym.com.br`
para `http://127.0.0.1:3000` nesse proxy.

### 5. Primeiro acesso

1. Entre em `https://contas.olimpogym.com.br` com o usuário `admin` (ou o e-mail do `.env`) e a senha do `.env`.
2. **Minha conta** → troque a senha.
3. **Configurações** → renomeie as unidades e informe o **saldo inicial** de cada conta (saldo do extrato numa data).
4. **Usuários** → crie os acessos (editor / somente leitura) e marque as unidades de cada um.
5. Cadastre as despesas fixas como **recorrentes** (aluguel, salários, sistemas…).

## Atualizar para uma versão nova

```bash
cd /opt/olimpogym
git pull
docker compose up -d --build
```

O banco é atualizado automaticamente (migrações) e os dados em `data/` são mantidos.

## Backup

Cópia diária do banco, mantendo os últimos 30 dias em `backups/`:

```bash
crontab -e
```

Adicione a linha:

```
30 3 * * * cd /opt/olimpogym && docker compose exec -T fluxo node scripts/backup.mjs /app/backups 30 >> backups/backup.log 2>&1
```

Os comprovantes ficam em `data/comprovantes/`. Inclua as pastas `data/` e `backups/` na rotina de backup do servidor,
ou copie-as para o Nextcloud.

Para restaurar: pare o sistema (`docker compose stop`), copie o backup escolhido para `data/fluxo.db` e suba de novo.

## Importar do Octagym

O Octagym não tem API pública. Por isso, a importação usa o relatório exportado:

1. No Octagym, abra o relatório financeiro / de recebimentos do período e exporte em CSV (ou salve a planilha como CSV).
2. No sistema, **Importar Octagym** → escolha a unidade e a categoria padrão → envie o arquivo.

As colunas são reconhecidas pelo nome do cabeçalho: valor, vencimento/data, data de pagamento, aluno/cliente,
plano/descrição, status/situação e forma de pagamento. Se o seu relatório usar nomes diferentes e a importação
reclamar, ajuste `SINONIMOS` em `src/lib/planilha.ts`.

## Desenvolvimento

```bash
npm ci
cp .env.example .env    # use COOKIE_SECURE=false localmente
npm run dev             # http://localhost:3000
npm test                # testes da lógica (valores, recorrência, previsto x realizado, importação, permissões)
npm run lint            # checagem de tipos
```

Estrutura principal:

- `src/lib/` — regras de negócio: banco e migrações (`db.ts`), lançamentos, cálculos do fluxo (`fluxo.ts`),
  importação/exportação (`planilha.ts`), usuários e login.
- `src/app/` — telas (Next.js) e ações dos formulários (`acoes.ts`).
- `tests/` — testes automatizados.
