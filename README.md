# greencode AV3: camada analítica, API pública e processamento assíncrono

Terceira etapa do greencode, plataforma de logística reversa de resíduos eletrônicos. Parte do servidor
monolítico da AV2 (Node.js + TypeScript + Fastify + Prisma + PostgreSQL, na pasta [`AVII/`](AVII), também disponível na
branch `AVII`) e acrescenta:

- **Camada analítica**: eficiência operacional, rentabilidade por tipo de equipamento e previsão de vida útil
  remanescente (regressão por mínimos quadrados com `simple-statistics`), calculadas sob demanda ou por
  agendamento e **gravadas para consulta histórica**, com medição da aderência das previsões.
- **API pública** `/api/v1/public` para parceiros: chaves de API com escopos e planos, limite de requisições
  (`@fastify/rate-limit`) e documentação OpenAPI própria.
- **Processamento assíncrono** de relatórios pesados com **BullMQ + Redis**: resposta 202 imediata, consulta da
  situação e download (CSV ou JSON), com política de retry.

Todo o código da AV3 fica na pasta [`AVIII/`](AVIII). Os comandos e caminhos citados neste README (`src/`, `tests/`,
`prisma/`…) são relativos a essa pasta.

Documentos:
- **Relatório técnico da AV3** (decisões, tabelas analíticas, política de retry, escalabilidade): [docs/RELATORIO_TECNICO.md](AVIII/docs/RELATORIO_TECNICO.md)
- Arquitetura de base (AV2): [docs/ARQUITETURA.md](AVIII/docs/ARQUITETURA.md)
- Diagrama de classes (PlantUML): [docs/uml/greencode-av3.puml](AVIII/docs/uml/greencode-av3.puml) · diagrama de referência: [diagrama.png](AVIII/diagrama.png)
- Documentação interativa: `http://localhost:3000/docs` (interna) e `http://localhost:3000/api/v1/public/docs` (parceiros)

## Requisitos

| | Versão |
|---|---|
| Sistema | Windows 10 ou superior, Ubuntu 24.04.3 ou superior, ou derivados do Ubuntu |
| Node.js | **20.19 ou superior** (testado com o 20.20) |
| PostgreSQL | 14 ou superior (testado com o 16) |
| Redis | 6.2 ou superior (testado com o 7). **Opcional** em desenvolvimento: sem ele a fila roda em memória |

Nada precisa ser compilado (a única peça nativa, um acelerador opcional do BullMQ, vem pré-compilada e tem alternativa em JavaScript). O `docker-compose.yml` sobe o PostgreSQL e o Redis.

## Instalação (Windows ou Linux)

```bash
git clone -b AVIII https://github.com/JoaoBarreto3/programacaoorientada.git
cd programacaoorientada/AVIII
docker compose up -d      # PostgreSQL + Redis (ou instale os dois e ajuste o .env)
npm install
npm run configurar        # cria o .env, os bancos e aplica as migrações
npm run db:seed           # opcional: dados de exemplo com 12 meses de histórico
npm run dev               # http://localhost:3000
```

Se o `docker compose up -d` reclamar de porta em uso (já existe um PostgreSQL ou Redis instalado na máquina), defina
`POSTGRES_PORTA=55432` e `REDIS_PORTA=56379` no `.env`, troque as portas em `DATABASE_URL`, `DATABASE_URL_TESTE`,
`REDIS_URL` e `REDIS_URL_TESTE` para os mesmos valores e rode `docker compose up -d` de novo.

Sem Docker no Windows: instale o PostgreSQL (`winget install PostgreSQL.PostgreSQL.16`) e deixe `REDIS_URL` vazio
no `.env`. O sistema funciona com a fila em memória, adequada para uso local com uma única instância.

Com o seed, entre com `admin`, `operador`, `gestor`, `auditor`, `ana.souza` ou `bruno.lima` (senha `Greencode2026`).
O seed também cria uma **chave de API de demonstração** para a organização BR001 e mostra o segredo no
terminal (ele não é exibido de novo).

### Produção e escala

| Cenário | Como rodar |
|---|---|
| Uma instância | `npm run build` e `npm start` (com `WORKER_EMBUTIDO=true`, o servidor também processa a fila) |
| Várias instâncias | API com `WORKER_EMBUTIDO=false` atrás de um balanceador, mais `npm run worker` em uma ou mais réplicas; todos com o mesmo `REDIS_URL` |

### Variáveis de ambiente novas (veja todas em `.env.example`)

| Variável | Padrão | Descrição |
|---|---|---|
| `REDIS_URL` | vazio | Redis da fila e do limite de requisições compartilhado; vazio = fila em memória |
| `WORKER_EMBUTIDO` | `true` | o servidor também processa a fila e os agendamentos |
| `ANALISES_CRON` / `FUSO_AGENDAMENTOS` | `0 2 * * *` / `America/Sao_Paulo` | análises recorrentes (vazio desativa) |
| `FILA_TENTATIVAS` / `FILA_ATRASO_MS` | `3` / `5000` | retry dos relatórios: tentativas e espera inicial (dobra a cada falha) |
| `FILA_CONCORRENCIA` | `2` | relatórios processados ao mesmo tempo por worker |
| `RELATORIO_RETENCAO_HORAS` | `72` | por quanto tempo o arquivo fica disponível |
| `RELATORIOS_SIMULTANEOS_POR_USUARIO` | `5` | relatórios em processamento por usuário interno |
| `LIMITE_LOGIN_POR_MINUTO` / `LIMITE_PUBLICO_POR_IP_POR_MINUTO` | `20` / `600` | proteção por IP |
| `TRUST_PROXY` | `false` | atrás de proxy reverso, usa o IP real do `X-Forwarded-For` |

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` / `npm start` | servidor (compila antes / versão já compilada) |
| `npm run worker` / `npm run dev:worker` | worker separado da fila e dos agendamentos (exige Redis) |
| `npm run configurar` | `.env`, bancos e migrações (pode repetir) |
| `npm run db:migrar` / `db:seed` / `db:resetar` | migrações / dados de exemplo / **apaga tudo** e recria |
| `npm test` | todos os testes (235) |
| `npm run test:requisitos` | os 20 testes que comprovam os requisitos do enunciado da AV3, um a um (~5 s) |

## Organização das APIs

| Prefixo | Para quem | Autenticação | Documentação |
|---|---|---|---|
| `/api/v1/internal` | front-end e equipe de gestão | `Authorization: Bearer <JWT>` | `/docs` |
| `/api/v1/public` | parceiros externos | `X-API-Key: gc_<prefixo>_<segredo>` | `/api/v1/public/docs` |
| `/api/saude` | monitoramento | nenhuma | — |

Os caminhos da AV2 (`/api/lotes`, `/api/auth/login`…) respondem **308** para `/api/v1/internal/...`, com os
cabeçalhos `Deprecation` e `Link`: clientes antigos continuam funcionando enquanto migram.

### Novidades da API interna

| Recurso | Rotas (sob `/api/v1/internal`) | Quem |
|---|---|---|
| Análises | `GET /analises/eficiencia` · `/analises/rentabilidade` · `/analises/rentabilidade/estimativa` · `/analises/vida-util` · `/analises/vida-util/aderencia` | admin, auditor, gestor |
| Histórico | `POST /analises/execucoes` (admin, auditor) · `GET /analises/execucoes` · `GET /analises/execucoes/:id` · `GET /analises/execucoes/:id/previsoes` | admin, auditor, gestor |
| Relatórios assíncronos | `POST /relatorios/tarefas` (202) · `GET /relatorios/tarefas` · `GET /relatorios/tarefas/:id` · `GET /relatorios/tarefas/:id/arquivo` · `DELETE /relatorios/tarefas/:id` (cancelar/excluir) | admin, auditor, gestor |
| Chaves de API | `GET /chaves-api/catalogo` · `GET/POST /chaves-api` · `GET/PATCH/DELETE /chaves-api/:id` · `POST /chaves-api/:id/rotacao` | admin |

As análises aceitam `organizacaoId`, `inicio` e `fim` (período de entrada dos lotes).

### CRUD das entidades da AV3

| Entidade | Cadastrar | Consultar / listar | Alterar | Excluir |
|---|---|---|---|---|
| Chave de API | `POST /chaves-api` (segredo mostrado uma vez) | por id ou prefixo; lista por organização e situação | nome, escopos, plano, validade, ativa/inativa; novo segredo (`/rotacao`) | `DELETE` = revogação definitiva (o registro fica para a auditoria) |
| Execução de análise | `POST /analises/execucoes` ou pelo agendador | por id (com o resultado); lista por tipo e organização; previsões por equipamento | — | — |
| Tarefa de relatório | `POST /relatorios/tarefas` (ou `/api/v1/public/relatorios`) | situação, lista das próprias, download do arquivo | — (o worker muda a situação) | cancelar enquanto na fila, excluir quando finalizada; 409 enquanto está sendo gerada |

Os "—" são intencionais: uma execução de análise é um registro histórico, que serve justamente para comparar
previsões com o que aconteceu depois (como a auditoria, não se altera nem se apaga); a situação de uma tarefa é
decidida pelo processamento, não pelo cliente.

### API pública v1

| Escopo da chave | Rotas (sob `/api/v1/public`) |
|---|---|
| qualquer | `GET /eu` (parceiro, escopos, plano e limites) |
| `RASTREABILIDADE_LER` | `GET /equipamentos/:codigo/rastreamento` |
| `LOTES_LER` | `GET /lotes` · `GET /lotes/:id` |
| `LOTES_ESCREVER` | `POST /lotes` (lote com equipamentos, em nome da organização da chave) |
| `RELATORIOS_GERAR` | `GET /analises/{eficiencia,rentabilidade,vida-util}` · `POST /relatorios` (202) · `GET /relatorios` · `GET /relatorios/:id` · `GET /relatorios/:id/arquivo` · `DELETE /relatorios/:id` |

| Plano | Requisições/min | Relatórios simultâneos |
|---|---|---|
| BASICO | 60 | 2 |
| PROFISSIONAL | 300 | 5 |
| CORPORATIVO | 1200 | 20 |

Exemplo de integração (Linux ou Git Bash), com a chave impressa pelo seed:

```bash
CHAVE='gc_xxxxxxxxxxxx_...'
curl -s localhost:3000/api/v1/public/eu -H "x-api-key: $CHAVE"

# relatório completo de vida útil em CSV: 202 com o id da tarefa
ID=$(curl -s -X POST localhost:3000/api/v1/public/relatorios -H "x-api-key: $CHAVE" \
  -H 'content-type: application/json' -d '{"tipo":"VIDA_UTIL","formato":"CSV"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')

curl -s localhost:3000/api/v1/public/relatorios/$ID -H "x-api-key: $CHAVE"            # PENDENTE → CONCLUIDA
curl -s localhost:3000/api/v1/public/relatorios/$ID/arquivo -H "x-api-key: $CHAVE" -o vida-util.csv
```

Erros seguem sempre o formato `{ "statusCode", "erro": { "codigo", "mensagem", "severidade" } }`. Os códigos
estão listados na documentação pública: VALIDACAO (400), CHAVE_API (401), PERMISSAO (403), NAO_ENCONTRADO (404),
CONFLITO/DUPLICIDADE (409), EXPIRADO (410, arquivo de relatório vencido), REGRA_NEGOCIO (422), LIMITE_REQUISICOES (429) e INTERNO (500).

## Front-end

Três telas novas, mostradas conforme o papel:

- **Análises**: abas de eficiência (gargalo, operadores, meses, atípicos, pendências), rentabilidade (prioridade,
  marcas, modelos, estimador), vida útil (modelos, previsões e aderência) e histórico de execuções.
- **Relatórios em segundo plano**: solicitação, acompanhamento automático e download.
- **Chaves de API** (administrador): criação com o segredo exibido uma vez, desativação, novo segredo e revogação.

## Testes

`npm test` roda **235 testes** em 46 suítes: os 129 da AV2 (adaptados aos novos caminhos) mais os da AV3.
`npm run test:requisitos` roda só a rastreabilidade dos requisitos do PDF (cada teste cita o trecho do enunciado que comprova).

| Arquivo | O que cobre |
|---|---|
| `tests/requisitos/av3-requisitos.test.ts` | **um teste por requisito do enunciado da AV3** (R01–R20), com o trecho do enunciado no nome: tecnologias, endpoints e agendamento, as três análises, tabelas históricas, aderência, chaves e escopos, limite por cliente, documentação (exemplos, erros, parâmetros), prefixos, versão, fila (202, status, download), retry, relatório técnico e compatibilidade |
| `tests/unidade/analises.test.ts` | estatística (resumo, MQO, R², Tukey) e as três análises com valores exatos, inclusive R² mínimo, taxa de armazenagem e censura na aderência |
| `tests/unidade/api-fila.test.ts` | formato e hash das chaves, regras da `ChaveApi`, escopos → permissões, CSV (RFC 4180 e CSV injection), retry e deduplicação da fila em memória |
| `tests/integracao/analises.test.ts` | eficiência com relógio controlado (dois operadores, tempos exatos), rentabilidade, vida útil, histórico, aderência, agendador e permissões |
| `tests/integracao/api-publica.test.ts` | ciclo de vida das chaves, escopos, isolamento entre organizações, auditoria `api:<prefixo>`, limite por plano (429), limite de login por IP, documentação pública |
| `tests/integracao/relatorios-assincronos.test.ts` | 202 → polling → download, isolamento, retry após falha transitória, falha definitiva, tentativas esgotadas, limite do plano, recuperação de pendentes, expurgo |
| `tests/integracao/fila-bullmq.test.ts` | o mesmo fluxo com **BullMQ + Redis reais**, `UnrecoverableError`, agendadores no Redis, limite compartilhado entre duas instâncias, Redis fora do ar (pulado sem `REDIS_URL_TESTE`) |
| `tests/integracao/robustez.test.ts` | varredura de **todas** as rotas documentadas (internas e públicas) com entradas ausentes, inválidas e maliciosas: nenhum erro 500, erro sempre no formato padrão, toda rota protegida exige autenticação |
| `tests/integracao/seguranca.test.ts` | SQL injection, templates, XSS, travessia de caminho, Unicode e NoSQL em **todos** os campos de texto e filtros: gravados e devolvidos literalmente, sem atraso nem efeito no banco; caractere nulo, `__proto__`, JWT `alg: none`, corpo gigante; cabeçalhos e CSP |
| `tests/interface/xss.test.ts` | cargas de script em todos os campos exibidos, **todas as telas** abertas no Chrome: nada executa, texto literal, nenhuma violação de CSP; a CSP bloqueia script injetado |
| `tests/processos.test.ts` | API (`WORKER_EMBUTIDO=false`) e `npm run worker` em processos separados com Redis: o worker processa a fila e encerra com SIGTERM; sem Redis, recusa subir |
| `tests/interface/av3-interface.test.ts` | as telas novas no Chrome headless, sobre os dados do seed: análises, relatórios (baixar e excluir), chaves (criar, desativar, reativar, novo segredo, revogar) e menus por papel |

## Estrutura (o que é novo)

```
prisma/migrations/…_analitica_api_publica/   tabelas da AV3 + CHECKs + preenchimento da triagem dos lotes antigos
prisma/seed-historico.ts                     12 meses de operação simulada (relógio controlado, semente fixa)
src/analises/                                funções puras: estatistica, AnaliseEficiencia, AnaliseRentabilidade, AnaliseVidaUtil
src/servicos/ServicoAnalise.ts               escopo, autorização, cálculo e gravação das análises
src/servicos/ServicoChaveApi.ts              chaves de API (criar, alterar, rotacionar, revogar, autenticar)
src/servicos/ServicoRelatorioAssincrono.ts   tarefas de relatório: solicitar, processar (retry), baixar, expurgar
src/servicos/processamento.ts                agendamentos e partida do worker
src/infra/fila/                              FilaTarefas (porta), FilaBullMQ, FilaMemoria
src/http/controllers/ControllerPublico.ts    API pública v1
src/http/plugins/                            autenticacaoParceiro (X-API-Key), limites (rate limit)
src/worker.ts                                processo worker separado
```

## Requisitos da AV3 → implementação

| Requisito | Onde |
|---|---|
| Módulo de análises com Node, TypeScript e Prisma; biblioteca estatística | `src/analises` (simple-statistics), `ServicoAnalise`, `RepositorioAnalises` |
| Análises por endpoints e por tarefas agendadas | `/api/v1/internal/analises/*`, agendamento `analises-recorrentes` (BullMQ job scheduler / node-cron) |
| Eficiência: tempo médio, gargalos, variação por operador e período | `AnaliseEficiencia` |
| Rentabilidade por tipo, com estado físico, marca e modelo | `AnaliseRentabilidade` |
| Vida útil por mínimos quadrados, resultados em tabelas, comparação com o realizado | `AnaliseVidaUtil`, tabelas `execucoes_analise` e `previsoes_vida_util`, `/vida-util/aderencia` |
| API pública com chaves, permissões e limite de requisições | `ControllerPublico`, `ServicoChaveApi`, `@fastify/rate-limit` |
| Documentação interativa com exemplos e códigos de erro | `/api/v1/public/docs` (`@fastify/swagger`) |
| Prefixos `/api/v1/public` × `/api/v1/internal`, versão na URL | `src/app.ts` |
| Fila BullMQ + Redis, id da tarefa, status e download | `src/infra/fila`, `ServicoRelatorioAssincrono`, `src/worker.ts` |
| Relatório técnico (biblioteca, tabelas, retry, escala) | `docs/RELATORIO_TECNICO.md` |
| Windows 10+ / Ubuntu 24.04.3+ | sem dependências nativas, Redis opcional, SIGBREAK no worker, CSV com BOM e CRLF |
