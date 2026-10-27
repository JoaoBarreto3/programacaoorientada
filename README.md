# greencode: API REST (AV2)

Servidor HTTP monolítico do greencode, plataforma de logística reversa de resíduos eletrônicos.
Evolução da CLI da AV1 (pasta `AVI` na branch `master`): **Node.js + TypeScript + Fastify + Prisma ORM + PostgreSQL**, autenticação
**JWT**, arquitetura em camadas **Controller → Service → Repository**, CRUD completo e front-end SPA.

Todo o código fica na pasta [`AVII/`](AVII). Os comandos e caminhos citados neste README (`src/`, `tests/`, `prisma/`…)
são relativos a essa pasta.

- Decisões de arquitetura, trade-offs, segurança, cenários de falha e revisão da AV1: [docs/ARQUITETURA.md](AVII/docs/ARQUITETURA.md)
- Diagrama de classes (PlantUML): [docs/uml/greencode-av2.puml](AVII/docs/uml/greencode-av2.puml)
- Documentação interativa da API (OpenAPI/Swagger): `http://localhost:3000/docs` com o servidor no ar

## Requisitos

| | Versão |
|---|---|
| Sistema | Windows 10 ou superior, Ubuntu 24.04.3 ou superior, ou derivados do Ubuntu (Mint, Pop!\_OS, Zorin…) |
| Node.js | **20.19 ou superior** (exigência do Prisma 7 e do Fastify 5). Testado com o 20.20 e o 24.18 |
| PostgreSQL | 14 ou superior (testado com o 16), local ou via Docker |

Não há dependências nativas (nada para compilar): o driver do PostgreSQL e o Prisma 7 são JavaScript/WebAssembly.

## Instalação (Windows ou Linux)

### 1. Instalar o Node.js e o PostgreSQL

| Sistema | Node.js | PostgreSQL (escolha uma opção) |
|---|---|---|
| Windows 10/11 | `winget install OpenJS.NodeJS.LTS` | **A)** Docker Desktop · **B)** `winget install PostgreSQL.PostgreSQL.16` |
| Ubuntu 24.04+ / derivados | `nvm install 22` ([nvm](https://github.com/nvm-sh/nvm)) ou [NodeSource](https://github.com/nodesource/distributions). O pacote `nodejs` do apt é a versão 18, antiga demais | **A)** Docker (`sudo apt install docker.io docker-compose-v2`) · **B)** `sudo apt install postgresql` |

**Opção A (Docker, mais simples):** depois de clonar (passo 2), dentro da pasta `AVII`, `docker compose up -d` sobe o PostgreSQL 16 na porta 5432
com o usuário `greencode` (senha `greencode`), que é o que o `.env` padrão usa.

**Opção B (PostgreSQL instalado):** crie uma vez o usuário que o `.env` padrão usa (os bancos são criados pelo
`npm run configurar`). Abra o `psql` (Windows: `psql -U postgres` · Ubuntu: `sudo -u postgres psql`) e execute:

```sql
CREATE USER greencode WITH PASSWORD 'greencode' CREATEDB;
```

Ou, se preferir usar outro usuário, ajuste `DATABASE_URL` e `DATABASE_URL_TESTE` no `.env` depois do passo 2.

### 2. Clonar, configurar e executar

Os comandos são os mesmos no Windows (PowerShell ou Prompt de Comando) e no Linux:

```bash
git clone -b AVII https://github.com/JoaoBarreto3/programacaoorientada.git
cd programacaoorientada/AVII
docker compose up -d
npm install
npm run configurar
npm run db:seed
npm run dev
```

O que cada comando faz:
- `docker compose up -d`: sobe o PostgreSQL. **Só na opção A (Docker)**; na opção B, pule esta linha.
- `npm install`: instala as dependências e gera o Prisma Client.
- `npm run configurar`: cria o `.env` (com segredo JWT aleatório), os bancos e aplica as migrações.
- `npm run db:seed`: **opcional**, carrega os dados de exemplo. Rode **antes** de abrir o site (veja abaixo).
- `npm run dev`: compila e inicia o servidor.

Abra `http://localhost:3000`:
- **Com o seed:** entre com `admin`, `operador`, `gestor` ou `auditor`, todos com a senha `Greencode2026`.
- **Sem o seed:** a primeira tela é o **provisionamento inicial** (cria o primeiro administrador), como na AV1.

#### Como rodar com o seed (a ordem importa)

O seed só funciona com o banco **vazio**: se já existir qualquer usuário, ele é ignorado e mostra
`O banco já possui usuários: seed ignorado`. Por isso, siga esta ordem:

1. `npm install`
2. `npm run configurar`
3. `npm run db:seed`, **antes** de abrir o site e antes de criar o administrador pela tela de provisionamento
4. `npm run dev`
5. Abra `http://localhost:3000` e entre com `admin` / `Greencode2026`

Se você já abriu o site e criou um administrador pela tela, o seed não roda mais. Nesse caso, use
`npm run db:resetar`: ele **apaga todos os dados**, recria o banco e já roda o seed.

Rode os comandos sempre dentro da pasta `AVII` que você vai usar: o seed grava no banco indicado pelo
`DATABASE_URL` do `.env` dessa pasta.

O `npm run configurar` pode ser repetido sem problema: ele mantém o que já existe. Se algo der errado (PostgreSQL
parado, senha errada), ele diz o que fazer. Para produção: `npm run build` e depois `npm start`. O servidor
encerra de forma graciosa com Ctrl+C (ou SIGTERM no Linux).

### Variáveis de ambiente (`.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `DATABASE_URL` | obrigatória | conexão com o PostgreSQL |
| `DATABASE_URL_TESTE` | (só testes) | banco **exclusivo** dos testes; tem as tabelas esvaziadas a cada execução |
| `JWT_SEGREDO` | obrigatória | segredo de assinatura dos tokens (mínimo de 32 caracteres) |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | porta e interface do servidor |
| `SESSAO_MINUTOS` | `30` | minutos de inatividade até a sessão expirar |
| `LOG_NIVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` ou `silent` |
| `SENHA_ITERACOES` | `600000` | iterações do PBKDF2 (os testes usam menos, para rodar rápido) |
| `TEMPO_DESLIGAMENTO_MS` | `10000` | prazo máximo do graceful shutdown |

### Scripts

| Comando | O que faz |
|---|---|
| `npm run configurar` | cria o `.env`, os bancos e aplica as migrações (pode repetir) |
| `npm run dev` | compila e inicia o servidor |
| `npm run build` / `npm start` | gera o cliente e compila / inicia a versão compilada |
| `npm run db:migrar` | aplica as migrações pendentes (não apaga dados) |
| `npm run db:seed` | popula um banco vazio com dados de exemplo |
| `npm run db:resetar` | **apaga tudo**, recria o banco e roda o seed (só em desenvolvimento) |
| `npm test` | todos os testes (unidade + integração com o PostgreSQL + jornada com o servidor real) |
| `npm run test:unidade` | só os testes de unidade (não precisam de banco) |

## API

Todas as rotas ficam sob `/api` e respondem JSON. Fora o login e o provisionamento, todas exigem
`Authorization: Bearer <token>`. Erros têm sempre o mesmo formato:

```json
{ "statusCode": 409, "erro": { "codigo": "CONFLITO", "mensagem": "…", "severidade": "AVISO" } }
```

| Status | Quando |
|---|---|
| 400 | dados inválidos (JSON Schema ou validação de domínio: CNPJ, datas, senha…) |
| 401 | sem token, token inválido/expirado ou sessão encerrada |
| 403 | o papel do usuário não permite a operação |
| 404 | registro inexistente |
| 409 | **versão desatualizada** (outra pessoa alterou antes) ou duplicidade detectada pelo banco |
| 422 | regra de negócio (ex.: desmonte antes da triagem, lote fora do status permitido) |

**Versionamento otimista:** cada recurso traz `versao`. Para alterar, envie a versão que você leu (`versao` no
corpo do PUT/PATCH ou `?versao=` no DELETE); se alguém tiver alterado antes, a resposta é 409.

### Rotas principais

| Recurso | Rotas |
|---|---|
| Sessão | `GET/POST /provisionamento` · `POST /auth/login` · `POST /auth/renovar` · `POST /auth/logout` · `GET /auth/eu` · `PUT /auth/senha` |
| Usuários | `GET/POST /usuarios` · `GET/PATCH/DELETE /usuarios/:login` · `PUT /usuarios/:login/senha` |
| Organizações | `GET/POST /organizacoes` · `GET/PUT/DELETE /organizacoes/:id` · `PATCH /organizacoes/:id/situacao` |
| Contratos | `GET/PUT/DELETE /organizacoes/:id/contrato` · `POST /organizacoes/:id/contrato/renovacao` |
| Lotes | `GET/POST /lotes` · `GET/PUT/DELETE /lotes/:id` · `POST /lotes/:id/triagem` · `GET /lotes/:id/relatorio-triagem` · `POST /lotes/:id/equipamentos` |
| Equipamentos | `GET/POST /equipamentos` · `GET/PUT/DELETE /equipamentos/:id` · `PATCH /equipamentos/:id/estado` · `PATCH /equipamentos/:id/status` · `GET/POST /equipamentos/:id/movimentacoes` · `GET /equipamentos/:id/rastreamento` |
| Parâmetros | `GET /parametros` · `PUT /parametros/:grupo/:chave` · `DELETE /parametros/aliquota/:chave` |
| Relatórios | `GET /relatorios/painel` · `/relatorios/financeiro` · `/relatorios/status/:status` · `/relatorios/organizacoes/:id` |
| Auditoria | `GET /auditoria` · `POST /auditoria/expurgo` |
| Sistema | `GET /saude` |

### Matriz do CRUD

| Entidade | Cadastrar | Consultar / listar | Alterar | Excluir |
|---|---|---|---|---|
| Usuário | `POST /usuarios` | por login; lista com filtro de papel e situação | papel, ativo/inativo, redefinir senha | sim (exceto a própria conta e o último administrador) |
| Organização | `POST /organizacoes` (com ou sem contrato) | por código; lista com busca, situação e paginação | dados cadastrais; CNPJ só enquanto não houver lotes; desativar/reativar | só sem lotes (com lotes: desativar) |
| Contrato | `PUT /organizacoes/:id/contrato` | sim | substituir os termos; renovar o vencimento | sim |
| Lote | `POST /lotes` (com ou sem equipamentos) | por código; lista por organização, situação e período | NF, transportadora, data e observações enquanto RECEBIDO; triagem | enquanto RECEBIDO (leva os equipamentos junto) |
| Equipamento | `POST /equipamentos` ou `POST /lotes/:id/equipamentos` | por código ou código de barras; lista por lote, organização, status, tipo e estado | marca, modelo, ano e peso antes da triagem; estado físico; status; local | enquanto o lote estiver RECEBIDO (renumera as posições) |
| Movimentação | `POST /equipamentos/:id/movimentacoes` (e automática nas mudanças de status/estado) | histórico do equipamento | — | — |
| Parâmetros | alíquota nova via `PUT` | sim | alíquotas, depreciação, valores de referência, retenção | alíquotas |
| Auditoria | automática em toda escrita | com filtros e paginação | — | só o expurgo do que passou do prazo de retenção |

Os "—" são intencionais: o histórico de movimentações e a auditoria são **imutáveis** (inclusive no banco,
por trigger), porque garantem a rastreabilidade exigida desde a AV1. Correções viram novos registros. O tipo de
um equipamento também não muda depois de cadastrado, porque o código de barras já impresso depende dele: para
corrigir, exclua o equipamento enquanto o lote está RECEBIDO e cadastre de novo.

Listagens aceitam `pagina` e `tamanhoPagina` (máximo de 100) e devolvem `{ itens, total, pagina, tamanhoPagina }`.

### Exemplo (curl, no Linux ou Git Bash)

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"login":"gestor","senha":"Greencode2026"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# lote + equipamentos em uma única transação
curl -s -X POST localhost:3000/api/lotes -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "organizacaoId": "BR001", "notaFiscal": "123456", "transportadora": "TransRapida",
  "equipamentos": [{ "tipo": "NOTEBOOK", "marca": "Dell", "modelo": "Latitude 5490",
                     "anoFabricacao": 2019, "estadoFisico": "BOM_ESTADO", "pesoQuilogramas": 1.9 }] }'
```

### Ciclo de vida do equipamento

```
AGUARDANDO_TRIAGEM → EM_TRIAGEM ─(triagem do lote concluída)─┬→ AGUARDANDO_DESMONTE → EM_DESMONTE ─┬→ PECAS_REAPROVEITADAS ─┐
                                                              ├→ PECAS_REAPROVEITADAS                 ├→ MATERIAL_RECICLAVEL  ─┼→ BAIXA_DEFINITIVA
                                                              └→ DESCARTE_SEGURO                      └→ DESCARTE_SEGURO      ─┘
```

A triagem tem duas etapas (`POST /lotes/:id/triagem` duas vezes): a primeira coloca os equipamentos em
EM_TRIAGEM e a segunda conclui a triagem do lote, liberando o desmonte. O banco também impõe essas transições (trigger).

## Testes

| Comando | O que roda |
|---|---|
| `npm test` | tudo (unidade + integração + jornada + interface) |
| `npm run test:unidade` | só os testes que não precisam de banco |
| `npm run test:interface` | só os testes da interface no navegador |

São **129 testes** em 25 suítes:

| Grupo | Arquivos | O que cobre |
|---|---|---|
| Unidade | `tests/unidade/` | regras do domínio (transições, justificativa, triagem, depreciação, contrato, bloqueio de login), validadores (CNPJ, 90 dias, senha…), configuração, tradução de erros |
| CRUD | `tests/integracao/crud-completo.test.ts` | cadastrar → consultar → listar → alterar → excluir de **todas** as entidades, com a auditoria de cada operação |
| Regras e fluxos | `organizacoes`, `lotes`, `equipamentos`, `relatorios-auditoria` | regras de negócio da AV1 pela API, triagem, ciclo de vida, rastreabilidade, relatórios, retenção |
| Segurança | `autenticacao`, `usuarios-permissoes` | JWT, expiração por inatividade, logout, bloqueio, matriz de permissões dos 4 papéis |
| Validação | `validacao-entrada` | 29 entradas malformadas recusadas com 400, campos controlados pelo servidor, JSON malformado, limite de tamanho |
| Concorrência e banco | `concorrencia-integridade` | versionamento otimista, requisições simultâneas, triggers e CHECK com SQL direto |
| Casos-limite | `casos-limite` | corridas entre requisições no mesmo lote (triagem × inclusão, baixas simultâneas), paginação extrema, tokens forjados, valores fora do limite |
| Seed | `seed` | o script de seed roda de verdade, cobre os cenários de validação e não duplica dados |
| Documentação | `documentacao` | toda rota documentada no OpenAPI, protegida por token e com o CRUD de cada entidade |
| Jornada | `tests/jornada.test.ts` | servidor real em outro processo: do provisionamento à rastreabilidade, com reinício e graceful shutdown |
| Interface | `tests/interface/` | **o CRUD feito clicando no front-end**, no Google Chrome (headless); verifica o menu por papel e a ausência de erros de JavaScript |

Os testes de integração usam o banco de `DATABASE_URL_TESTE`, que precisa ser diferente de `DATABASE_URL`: as
tabelas dele são esvaziadas a cada execução. Os testes de interface usam o Google Chrome instalado; se ele não
existir na máquina, são **pulados** (aparecem como *skipped*), sem falhar a suíte.

## Estrutura

```
prisma/
  schema.prisma          modelos, relacionamentos, índices únicos
  migrations/            migração inicial (gerada) + regras_integridade (CHECK, triggers, sequências)
  seed.ts                massa de dados de exemplo
src/
  server.ts              ponto de entrada: porta configurável, graceful shutdown
  app.ts                 monta o Fastify (plugins, Swagger, JWT, rotas, front-end)
  config/                leitura e validação das variáveis de ambiente
  http/                  controllers, JSON Schemas, autenticação JWT, tratamento de erros
  servicos/              casos de uso, autorização por papel, transações, auditoria
  repositorios/          Prisma Client, unidade de trabalho, versionamento otimista
  dominio/               entidades (Organizacao, Contrato, Lote, Equipamento, Movimentacao, Usuario…) e enums
  validacao/             Validador (abstrata) e validadores concretos (reaproveitados da AV1)
  fabricas/              criação de objetos compostos com códigos sequenciais
  comum/                 erros, datas civis, relógio, paginação
public/                  front-end SPA (HTML + CSS + JavaScript, sem build)
tests/                   unidade/, integracao/, interface/ (navegador), jornada.test.ts
docs/                    ARQUITETURA.md, uml/
```

## Requisitos da AV2 → implementação

| Requisito | Onde |
|---|---|
| Arquitetura Controller → Service → Repository | `src/http/controllers`, `src/servicos`, `src/repositorios` |
| Fastify com JSON Schema, hooks e plugins | `src/app.ts`, `src/http/schemas.ts`, `src/http/plugins/` |
| Porta por variável de ambiente e graceful shutdown | `src/config/configuracao.ts`, `src/server.ts` |
| `schema.prisma` com Organizacao, Contrato (0..1), Lote, Equipamento e Movimentacao | `prisma/schema.prisma` |
| Migrações versionadas, PostgreSQL | `prisma/migrations/` |
| JWT com `@fastify/jwt`, hash de senha, papel no token, hook que injeta o usuário | `src/http/plugins/autenticacao.ts`, `ServicoAutenticacao` |
| Autorização pelos serviços a partir do papel | `src/servicos/autorizacao.ts` |
| `$transaction` em operações compostas | `UnidadeDeTrabalho`, `ServicoLote`, `ServicoEquipamento` |
| Versionamento otimista (campo `versao`) | `EntidadeVersionada`, `repositorios/versionamento.ts` |
| Seed com dados representativos | `prisma/seed.ts` |
| Unicidade de CNPJ e código de barras; triggers e constraints | `schema.prisma` (`@unique`), migração `regras_integridade` |
| API documentada | `/docs` (OpenAPI gerado dos schemas) |
| Front-end SPA consumindo a API | `public/` |
| Justificativa de decisões, trade-offs e alternativas | `docs/ARQUITETURA.md` |
| Windows 10+ / Ubuntu 24.04.3+ | sem dependências nativas, scripts npm em Node puro, `path` para caminhos, SIGBREAK no Windows |
