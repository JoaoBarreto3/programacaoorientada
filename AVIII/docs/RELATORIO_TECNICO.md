# greencode AV3: relatório técnico

Camada analítica, API pública para parceiros e processamento assíncrono com fila.

Este relatório justifica as decisões da terceira etapa do greencode. A base continua a mesma da AV2
(monólito modular em Node.js + TypeScript + Fastify + Prisma + PostgreSQL, documentado em
[ARQUITETURA.md](ARQUITETURA.md)); aqui ficam só o que mudou e o porquê. O diagrama de classes
atualizado está em [uml/greencode-av3.puml](uml/greencode-av3.puml) (classes novas em verde).

## 1. Visão geral

```
                       ┌──────────── /api/v1/internal  (JWT, front-end e gestão) ──────────────┐
Navegador (SPA) ──────►│ controllers ─► serviços ─► repositórios ─► PostgreSQL                  │
                       │                   │  ▲                                                 │
Parceiro (ERP, BI) ───►│ /api/v1/public    │  │  mesmas regras, mesma auditoria                 │
   X-API-Key           │ (chave + plano)   ▼  │                                                 │
                       │   ServicoAnalise (src/analises: funções puras + simple-statistics)     │
                       │   ServicoRelatorioAssincrono ──► fila (BullMQ/Redis) ──► worker        │
                       └────────────────────────────────────────────────────────────────────────┘
                                      agendador (BullMQ job schedulers / node-cron)
```

| Pilar da AV3 | Onde está | Resumo |
|---|---|---|
| Camada analítica | `src/analises`, `src/servicos/ServicoAnalise.ts` | três análises (eficiência, rentabilidade, vida útil), resultados gravados em tabelas próprias, execução sob demanda e agendada |
| API pública | `src/http/controllers/ControllerPublico.ts`, `src/servicos/ServicoChaveApi.ts` | `/api/v1/public`, chaves de API com escopos e planos, limite de requisições, documentação OpenAPI separada |
| Processamento assíncrono | `src/infra/fila`, `src/servicos/ServicoRelatorioAssincrono.ts`, `src/worker.ts` | BullMQ + Redis, 202 + polling + download, retry com backoff exponencial |

## 2. Camada analítica

### 2.1 Biblioteca de estatística: simple-statistics

O enunciado sugere `simple-statistics` ou `mathjs`. A escolha foi a **simple-statistics**:

- **Cobre exatamente o que as análises usam**: média, mediana, desvio padrão amostral, quantis,
  regressão linear por mínimos quadrados e R². A `mathjs` traria álgebra linear, números complexos,
  unidades e um parser de expressões que não usamos: o pacote tem 9,4 MB e 9 dependências, contra
  1,4 MB e nenhuma dependência da simple-statistics.
- **JavaScript puro, sem dependências nativas**: instala igual no Windows e no Ubuntu.
- **Funções puras e determinísticas**: fáceis de testar (os testes conferem os resultados contra
  valores calculados à mão).

Implementar à mão também era possível (MQO simples são poucas linhas), mas os detalhes que mais
geram erros (quantis interpolados, desvio padrão amostral × populacional, R² com variância nula) já
estão resolvidos e testados na biblioteca. Para não acoplar o projeto a ela, todas as chamadas passam
por uma fachada (`src/analises/estatistica.ts`): trocar de biblioteca afetaria um único arquivo.

### 2.2 Organização: funções puras + serviço

Cada análise é uma **função pura** em `src/analises` (recebe dados, devolve o resultado, sem banco nem
relógio global). O `ServicoAnalise` cuida do resto: autorização, escopo (organização e período),
leitura enxuta dos dados (`RepositorioAnalises` seleciona só as colunas necessárias) e gravação. O
mesmo serviço atende quatro consumidores sem duplicar lógica: API interna, API pública, worker da fila
e agendador. As funções puras têm testes de unidade com valores exatos.

### 2.3 Análise de eficiência operacional

Para medir "o tempo médio de processamento desde a entrada até a conclusão da triagem", o lote passou a
registrar **quando e por quem** a triagem foi iniciada e concluída (`triagem_iniciada_em/por`,
`triagem_concluida_em/por`). Na AV2 esse dado só existia na auditoria; a migração da AV3 preenche as
colunas dos lotes antigos a partir dela. O tempo é dividido em duas etapas, porque um único número não
diz onde agir:

| Etapa | De → até | O que revela |
|---|---|---|
| Espera | entrada → início da triagem | fila do almoxarifado |
| Triagem | início → conclusão | capacidade dos operadores |
| Total | entrada → conclusão | experiência do cliente |

Resultados: estatística descritiva das três etapas (média, mediana, desvio padrão, p25, p75 e p90);
comparação **por operador** (mediana da triagem e horas por equipamento); variação **por mês**
(sazonalidade); o **gargalo** (etapa com maior participação no tempo total); **lotes atípicos** pelo
critério de Tukey (acima de Q3 + 1,5 × IQR, robusto a outliers, ao contrário de "média + 2 desvios"); e
as **pendências** (lotes aguardando ou em triagem, com o mais antigo).

Com os dados do seed (12 meses), a análise mostra o que foi simulado: a espera responde por 86% do
tempo, o mês de novembro concentra os lotes atípicos e os três operadores têm ritmos distintos
(medianas de 0,6, 1,07 e 1,56 dia).

### 2.4 Análise de rentabilidade por tipo de equipamento

O valor de recuperação de cada equipamento é o **valor residual** já calculado pelo domínio desde a
AV1 (valor de referência do tipo × (1 − depreciação por idade e estado físico)). A análise agrega por
tipo (média, mediana, dispersão, R$/kg, retorno sobre o valor de um novo e participação no total) e
detalha por estado físico, marca e modelo. O resultado principal é a **ordem de prioridade**: quais
tipos dão maior retorno médio.

Há também um **estimador** para equipamentos ainda não recebidos: usa o grupo mais específico com
amostra suficiente (modelo e estado → modelo → marca e estado → estado → só o tipo) e devolve a
mediana e a faixa provável (p25 a p75). Quanto mais parecido o grupo, melhor a estimativa, desde que
haja dados para sustentá-la; se não houver, ele recua um nível e informa a base usada.

### 2.5 Análise preditiva de vida útil remanescente

**Modelo por idade (perfil do tipo).** O estado físico é uma escala ordinal de 0 (NOVO) a 6
(INSERVÍVEL). Para cada tipo, ajusta-se por **mínimos quadrados ordinários** a reta
`nível = a + b · idade`, usando como observações cada inspeção registrada: o estado na chegada e cada
reclassificação, com a idade naquele momento. A inclinação `b` é quantos níveis o tipo perde por ano;
a idade prevista para ficar inservível é `(6 − a) / b`. A regressão só é aceita com pelo menos 5
observações, tendência de piora e **R² ≥ 0,2**; abaixo disso, a idade explica pouco o estado e o
sistema usa o coeficiente de depreciação do tipo (parâmetro global: `c` ao ano equivale a `6c`
níveis por ano). O motivo da alternativa sempre aparece no resultado.

O critério de R² mínimo surgiu dos dados: sem ele, as fontes de alimentação recebiam uma reta com
R² = 0,008 e "viviam" 61 anos.

**Refinamento pela aderência: taxa de armazenagem.** As previsões de cada execução são gravadas
(tabela `previsoes_vida_util`), e o endpoint de aderência as compara com a data real em que cada
equipamento ficou inservível. A primeira versão do modelo, só por idade, errava por **cerca de 3 anos**:
a regressão descreve o desgaste **durante o uso** (o estado com que o equipamento chega), mas os
equipamentos previstos estão parados no **pátio do almoxarifado**, onde o desgaste segue outro ritmo.

A correção foi estimar, por tipo, a **taxa de desgaste no pátio**: níveis perdidos depois da triagem ÷
anos-equipamento de permanência (um estimador de taxa de eventos por tempo de exposição; a exposição
termina na baixa, ao ficar inservível ou agora). Reclassificações feitas na própria triagem não contam,
porque corrigem o estado declarado e não medem desgaste. Com exposição suficiente (≥ 1
ano-equipamento e ≥ 3 eventos), a vida remanescente de cada equipamento passa a ser
`(6 − nível atual) / taxa`. Se o tipo não tem dados, usa-se a taxa geral, e na falta dela, a inclinação
do modelo por idade. O perfil por idade continua no resultado, porque responde a outra pergunta (quando
um tipo fica inservível em uso, útil para o cliente planejar a troca do parque).

**Aderência medida nos dados do seed:**

| Execução (agendada) | Previsões verificadas | Erro médio absoluto |
|---|---|---|
| há 240 dias (pouco histórico: modelo por idade) | 14 | 1.085 dias |
| há 150 dias (taxa de armazenagem com 5 meses de dados) | 16 | 1.049 dias |
| há 60 dias (taxa com 10 meses de dados) | 14 | 691 dias |

O erro cai conforme o histórico cresce: é o ciclo "comparar previsões com realizações e refinar
continuamente" que a atividade pede, e ele é **mensurável** pelo próprio sistema (aba Vida útil →
Aderência, ou `GET /api/v1/internal/analises/vida-util/aderencia`).

**Cuidado com a censura.** Num período curto, só os equipamentos que falharam *cedo* têm data real; os
que vão falhar no prazo previsto ainda não falharam. Medir o erro só sobre os realizados puxa o
resultado para "o modelo foi otimista". Por isso a aderência também informa as previsões **vencidas
sem ocorrência** (sinal de pessimismo) e as **em aberto** (observações censuradas, sem conclusão
possível ainda). Um próximo passo natural é um modelo de sobrevivência (Kaplan-Meier ou Weibull), que
trata a censura de forma explícita.

### 2.6 Persistência dos resultados: como as tabelas foram modeladas

| Tabela | Conteúdo | Por que assim |
|---|---|---|
| `execucoes_analise` | uma linha por execução: tipo, origem (AGENDADA/MANUAL), escopo, parâmetros, **resultado em JSONB**, início, fim, duração, solicitante | o resultado agregado tem estrutura diferente em cada análise e muda com a evolução dos modelos; JSONB guarda o retrato completo sem migração a cada campo novo e ainda permite consultas e índices GIN se necessário |
| `previsoes_vida_util` | uma linha por equipamento e execução: tipo, estado, idade, anos restantes, data prevista, método | é o dado que precisa ser **cruzado** com a realidade (aderência): normalizado, indexado por equipamento, com chave primária (execução, equipamento) |
| `lotes` (+4 colunas) | início e conclusão da triagem e responsáveis | base da eficiência; CHECKs garantem ordem e consistência |

Decisões de integridade: `previsoes_vida_util` **não** tem chave estrangeira para `equipamentos`, porque
a previsão é um registro histórico e deve sobreviver a uma exclusão. A execução e as previsões são
gravadas na mesma transação, junto com o registro de auditoria `ANALISE_EXECUTAR`. Na tabela de
execuções, as previsões individuais **não** são repetidas no JSON (ficaria duplicado e pesado).

### 2.7 Execução sob demanda e agendada

- **Sob demanda:** `GET /analises/{eficiencia|rentabilidade|vida-util}` calcula na hora (não grava);
  `POST /analises/execucoes` calcula e grava no histórico.
- **Agendada:** o agendamento `analises-recorrentes` (cron `ANALISES_CRON`, padrão às 2h no fuso
  `America/Sao_Paulo`) grava as três análises globais com origem AGENDADA. Com Redis, o agendamento é
  um **job scheduler do BullMQ** dentro do próprio worker, como sugere o enunciado ("integrar os
  cálculos como jobs recorrentes dentro do próprio worker"). A vantagem sobre o `node-cron` é que, com
  várias instâncias, cada disparo gera **um único** job (o Redis coordena); com `node-cron` cada
  instância dispararia a sua cópia. Sem Redis (desenvolvimento), a fila em memória usa `node-cron`.

## 3. API pública

### 3.1 Segregação: `/api/v1/public` × `/api/v1/internal`

| | Interna (`/api/v1/internal`) | Pública (`/api/v1/public`) |
|---|---|---|
| Quem usa | front-end e equipe de gestão | parceiros externos |
| Autenticação | JWT de usuário (papéis) | chave de API (escopos) |
| Limite | por IP no login | por IP (antes da autenticação) **e** por chave, conforme o plano |
| Dados expostos | completos | sem dados internos (logins de funcionários, versões, auditoria) |
| Documentação | `/docs` | `/api/v1/public/docs` (só as rotas públicas) |
| Versão | 3.0.0 | **1.0.0**, no caminho e no cabeçalho `api-version` |

As duas usam **os mesmos serviços**. A autorização passou a aceitar um `Ator` (usuário **ou**
parceiro): o usuário é autorizado pelo papel; o parceiro, pelos escopos da chave, que viram um conjunto
fechado de permissões de negócio (`PERMISSOES_POR_ESCOPO`). Assim um lote submetido por um ERP passa
pelas mesmas validações, transações e auditoria de um lote cadastrado pela tela, e fica registrado
como `api:<prefixo>` na auditoria e nas movimentações.

**Isolamento entre clientes:** uma chave ligada a uma organização só enxerga os dados dela. Recurso de
outra organização responde **404** (e não 403), para não revelar que ele existe. A organização não é
parâmetro da API pública: vem sempre da chave. Um `organizacaoId` enviado no corpo é descartado.

**Versionamento:** mudanças compatíveis (campos novos) entram na v1; mudanças incompatíveis só numa v2,
com a v1 mantida durante um período de depreciação anunciado. A própria AV3 aplicou essa política à
API da AV2: os caminhos antigos `/api/...` respondem **308** para `/api/v1/internal/...`, com os
cabeçalhos `Deprecation` e `Link: rel="successor-version"`.

### 3.2 Chaves de API

Como pede o enunciado, a gestão das chaves é um módulo **dentro do serviço de autenticação**:
`ServicoAutenticacao` compõe o `ServicoChaveApi` (`autenticacao.chavesApi`), que autentica parceiros
assim como o restante do serviço autentica usuários.

Formato entregue ao parceiro: `gc_<prefixo>_<segredo>`.

- **Prefixo** (12 hexadecimais, público): localiza a chave por índice único, sem varrer a tabela, e
  identifica o parceiro na auditoria e nos logs sem expor o segredo.
- **Segredo** (256 bits aleatórios em base64url): mostrado **uma única vez**. O banco guarda só o
  **SHA-256**, comparado em tempo constante. Para senhas usamos PBKDF2 lento porque elas têm pouca
  entropia e são atacáveis por dicionário; um segredo aleatório de 256 bits não tem dicionário, então
  um hash rápido basta, e isso importa porque a verificação acontece **em toda requisição**.
- **Ciclo de vida:** desativar (reversível), **rotacionar** (novo segredo, mesmo prefixo e permissões;
  o antigo para na hora), **revogar** (definitivo, registro mantido para auditoria) e expiração
  opcional. Tudo auditado.
- **Escopos** (pelo contrato comercial): `RASTREABILIDADE_LER`, `LOTES_LER`, `LOTES_ESCREVER`,
  `RELATORIOS_GERAR`. Gravar lotes exige chave ligada a uma organização (regra no domínio e CHECK no
  banco).
- O "último uso" é gravado no máximo uma vez por minuto por chave, para não gerar uma escrita no banco
  a cada requisição.

### 3.3 Planos e limite de requisições (@fastify/rate-limit)

| Plano | Requisições/minuto | Relatórios simultâneos |
|---|---|---|
| BASICO | 60 | 2 |
| PROFISSIONAL | 300 | 5 |
| CORPORATIVO | 1200 | 20 |

Duas camadas de limite: **por IP antes da autenticação** (freia tentativas de adivinhar chaves e
protege o banco da consulta da chave) e **por chave depois dela** (o limite do plano, com os cabeçalhos
`x-ratelimit-*`; ao exceder, 429 com `Retry-After`). Com Redis, a contagem fica num store compartilhado:
o limite vale para o parceiro, e não para cada servidor (há um teste com duas instâncias da API
dividindo a mesma cota). Se o Redis cair, a API continua atendendo sem limite (`skipOnError`):
preferimos alguns instantes sem limite a derrubar a integração de todos os parceiros.

Um detalhe encontrado nos testes: o handler padrão do plugin marca a requisição como "já limitada" e
ignora qualquer limite seguinte. Por isso o limite por IP usa `createRateLimit` (que só verifica), e o
do plano usa o handler (que envia os cabeçalhos). O mesmo limite por IP passou a proteger o login da
API interna, um item que a AV2 tinha deixado como próximo passo.

### 3.4 Documentação (@fastify/swagger)

Uma única especificação OpenAPI gera duas interfaces: `/docs` (interna) e `/api/v1/public/docs`
(pública, filtrada por `transformSpecification`, com título, versão e esquema de segurança próprios).
A pública traz, em cada rota: resumo, descrição com o escopo exigido, exemplos de requisição e
resposta, e **todos os códigos de erro descritos** (400, 401, 403, 404, 409, 422, 429, 500). O formato
de erro é único em toda a API: `{ statusCode, erro: { codigo, mensagem, severidade } }`. Um teste
automatizado garante que nenhuma rota pública fica sem essa documentação.

## 4. Processamento assíncrono

### 4.1 Fluxo (polling)

1. `POST /relatorios` grava a tarefa `PENDENTE` no PostgreSQL, publica **só o id** na fila e responde
   **202** com `Location` e os links de acompanhamento, sem esperar o processamento.
2. O worker gera o arquivo (JSON ou CSV) e grava `CONCLUIDA`, com tamanho e SHA-256.
3. O cliente consulta `GET /relatorios/{id}` até `CONCLUIDA` e baixa em `GET /relatorios/{id}/arquivo`
   (com `ETag` = SHA-256). Antes disso o download responde **409**; se a tarefa falhou, **422** com o
   motivo.

Relatórios disponíveis: vida útil de **todos** os equipamentos ativos (o exemplo do enunciado),
inventário com rastreabilidade, rentabilidade por equipamento e eficiência por lote. O CSV segue a RFC
4180, tem BOM UTF-8 para o Excel e neutraliza **CSV injection** (um texto que comece com `=`, `+`, `-`
ou `@`, vindo de marca ou modelo digitados, ganha um apóstrofo e não vira fórmula na planilha).

### 4.2 Por que BullMQ + Redis

- **Persistência e coordenação:** os jobs sobrevivem a reinícios (Redis com AOF), vários workers em
  vários processos ou máquinas consomem a mesma fila sem pegar o mesmo job duas vezes, e um job
  "travado" (worker morto no meio) é detectado e reprocessado (*stalled jobs*).
- **Retry, backoff, deduplicação e agendamentos** prontos e testados.
- **Alternativas consideradas:** RabbitMQ (mais uma infraestrutura e sem agendamento nativo
  equivalente); fila no próprio PostgreSQL com `SELECT … FOR UPDATE SKIP LOCKED` (viável e sem Redis,
  mas exigiria implementar retry, backoff, travamento e agendamento à mão); Kafka (feito para fluxos de
  eventos em alto volume, desproporcional aqui).

**O banco é a fonte da verdade; a fila só transporta o id.** Isso dá três propriedades:

- **Redis fora do ar não perde pedidos:** a tarefa já está gravada; o enfileiramento tem prazo de 3 s
  e, se falhar, a API responde 202 mesmo assim. A **varredura** a cada 5 minutos recoloca na fila o
  que ficou PENDENTE. A API sobe mesmo sem Redis (saúde `degradado`), testado.
- **Idempotência:** `jobId` = id da tarefa (a mesma tarefa nunca fica duas vezes na fila) e o worker só
  processa tarefas ainda não finalizadas (um job repetido de uma tarefa concluída não faz nada).
- **Consulta barata:** a situação é lida no PostgreSQL, sem depender do Redis.

### 4.3 Política de retry

| Situação | Exemplo | O que acontece |
|---|---|---|
| Erro técnico (transitório) | timeout, conexão interrompida, banco ocupado | volta para PENDENTE e é repetido com **backoff exponencial**: 5 s, 10 s… (`FILA_ATRASO_MS` × 2ⁿ⁻¹), até **3 tentativas** (`FILA_TENTATIVAS`); na última, FALHOU |
| Erro de regra ou validação (4xx) | organização apagada, arquivo acima de 10 MB | **falha definitiva na hora** (`UnrecoverableError` do BullMQ): repetir não mudaria o resultado e só ocuparia o worker |
| Worker morre no meio | queda do processo ou da máquina | o BullMQ detecta o job travado e o devolve à fila; a fila em memória é recuperada pela varredura ao reiniciar |

A mensagem do último erro fica na tarefa (o cliente vê por que falhou) e é limpa se uma nova tentativa
concluir. Jobs concluídos saem do Redis em 1 hora (o resultado está no banco); os que falharam ficam 7
dias para inspeção. Os arquivos gerados expiram em `RELATORIO_RETENCAO_HORAS` (72 h) e são apagados por
um agendamento de expurgo. Cada plano limita quantos relatórios o parceiro pode ter em processamento
ao mesmo tempo, o que protege o worker de um parceiro que dispare centenas de pedidos.

### 4.4 Fila em memória (desenvolvimento e Windows sem Docker)

Sem `REDIS_URL`, a mesma interface `FilaTarefas` é atendida por uma fila no próprio processo, com **a
mesma política de retry**, concorrência limitada, deduplicação e `node-cron`. Ela serve para
desenvolver e testar sem Redis e para quem usa Windows sem Docker. Não é para produção: não sobrevive a
reinícios (a varredura recupera as pendentes do banco) e não coordena várias instâncias. O servidor
avisa no log quando está nesse modo, e o worker separado se recusa a subir sem Redis.

## 4.5 Segurança contra entradas maliciosas

A defesa não depende de "filtrar padrões perigosos" (sempre incompleto), e sim de nunca tratar dado como
código:

| Ameaça | Defesa | Comportamento comprovado por teste |
|---|---|---|
| Injeção de SQL (`'; DROP TABLE…`, `' OR '1'='1`, `pg_sleep`) | o Prisma só usa consultas parametrizadas | o texto é gravado e devolvido literalmente; busca por `' OR '1'='1` traz só o registro que contém esse texto; nenhum atraso; nenhuma tabela afetada |
| XSS (`<script>`, `<img onerror>`, `<svg onload>`) | o front-end escapa todo conteúdo dinâmico; **Content-Security-Policy** `script-src 'self'` como segunda barreira | em todas as telas, no Chrome: nada executa, o texto aparece literal e não há nenhuma violação de CSP (o escape basta); um script embutido injetado à força é bloqueado pela CSP |
| Caractere nulo (U+0000) | recusado na entrada (o PostgreSQL não o aceita em texto) | 400 em corpo, filtro e caminho |
| Poluição de protótipo (`__proto__`), objetos no lugar de texto (`{"$gt": ""}`) | parser JSON seguro do Fastify e JSON Schema | 400 |
| Corpo gigante, texto longo | limite de 1 MB e `maxLength` por campo | 413 e 400 |
| Credenciais forjadas (JWT com `alg: none`, chaves malformadas) | algoritmo fixo HS256; chave conferida por hash em tempo constante | 401 |
| Fórmulas em planilha (`=cmd…`) | apóstrofo antes de `= + - @` no CSV | vira texto |

Cabeçalhos em todas as respostas: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
`Cross-Origin-Opener-Policy`, `Permissions-Policy`; CSP rígida na página e `default-src 'none'` na API.
A política é escolhida pelo endereço da requisição, não pelo tipo de conteúdo: um teste de navegador
mostrou que, ao recarregar a página (resposta 304 do cache), o tipo ainda não está definido e a política
da API bloquearia o próprio front-end.

## 5. Evolução para centenas ou milhares de parceiros

| Gargalo previsível | Medida |
|---|---|
| CPU da API | a API é *stateless* (JWT, chave validada no banco, limite no Redis): mais instâncias atrás de um balanceador, com `WORKER_EMBUTIDO=false` |
| Fila de relatórios | `npm run worker` em quantas réplicas forem precisas (escala horizontal independente da API); filas separadas por plano para que os CORPORATIVO não esperem atrás dos BASICO |
| Conexões com o PostgreSQL | PgBouncer em modo *transaction*; réplica de leitura para análises e relatórios (o `RepositorioAnalises` só lê) |
| Análises sobre muitos dados | agregação no banco (visões materializadas atualizadas pelo agendador) em vez de carregar linhas no Node; particionamento de `movimentacoes` por data |
| Validação da chave a cada requisição | cache da chave no Redis por poucos segundos (invalidado ao rotacionar ou revogar) |
| Arquivos de relatório no banco | object storage (S3 ou MinIO) com URL pré-assinada; o banco guarda só os metadados |
| Polling de milhares de parceiros | **webhooks**: ao concluir, POST assinado (HMAC) para a URL do parceiro, com retry próprio; o polling continua como alternativa |
| Abuso e custo | limites por plano já existem; somar cota mensal e medição de uso por chave (cobrança por consumo) |
| Observabilidade | métricas da fila (tamanho, latência, falhas) e por parceiro; OpenTelemetry (o BullMQ tem integração) |

O monólito modular continua adequado: as fronteiras (API pública, analítica, worker) já estão
separadas em código e em processo (o worker é um executável à parte). Extrair um microsserviço só se
justifica quando uma dessas partes precisar escalar ou evoluir num ritmo muito diferente das outras.

## 6. Compatibilidade (Windows 10+, Ubuntu 24.04.3+ e derivados)

- **Nada para compilar:** simple-statistics, BullMQ, ioredis, node-cron e @fastify/rate-limit são
  JavaScript puro (mesmo princípio da AV2 com o Prisma 7 e o driver `pg`). A única peça nativa é o
  `msgpackr-extract`, um acelerador **opcional** usado pelo BullMQ: vem pré-compilado para Windows e
  Linux e, se não puder ser instalado, o BullMQ usa a versão em JavaScript. Um teste de requisitos
  confere no `package-lock.json` que nenhuma dependência obrigatória tem etapa nativa.
- **Instalação em um comando:** depois do `npm install`, o `npm run dev` (via `scripts/configurar.mjs`) cria o
  `.env`, sobe PostgreSQL e Redis pelo Docker (Docker Desktop no Windows) nas portas 55432/56379, troca para uma
  porta livre se outro programa já ocupar a configurada, aplica as migrações e carrega o seed com o banco vazio.
  Sem Docker, basta apontar `DATABASE_URL` para um PostgreSQL local; sem Redis, a fila roda em memória.
- **Sinais:** o worker trata SIGINT, SIGTERM e SIGBREAK (Ctrl+Break no Windows) e espera os jobs em
  andamento terminarem (graceful shutdown).
- **Fusos e datas:** agendamentos com fuso explícito (`FUSO_AGENDAMENTOS`); datas civis em UTC, como
  na AV2.
- **CSV:** CRLF e BOM UTF-8, que o Excel do Windows abre com os acentos corretos.

## 7. Verificação

`npm test` executa **235 testes**; `npm run test:requisitos` roda, em cerca de 5 segundos, os 20 que
comprovam um a um os requisitos do enunciado (`tests/requisitos/av3-requisitos.test.ts`). A suíte
completa inclui unidade, integração com PostgreSQL real, BullMQ com Redis real e interface no Chrome
headless. Os testes da AV3 cobrem, entre outros:

| Área | O que é comprovado |
|---|---|
| Estatística e análises | médias, medianas, desvio amostral, MQO, R², Tukey, gargalo, ranking, estimador com recuo, modelo e alternativa, R² mínimo, taxa de armazenagem e censura, todos com valores exatos |
| Eficiência integrada | com relógio controlado, espera e triagem conferidas em décimos de dia, por operador |
| Histórico e agendador | execução gravada com previsões em tabela; aderência após o equipamento ficar inservível; agendador grava as três análises |
| Chaves de API | segredo mostrado uma vez e nunca listado; escopos; isolamento (404 entre organizações); desativar, rotacionar, revogar e expirar valem na hora |
| Limites | 61ª requisição do plano BASICO → 429 com Retry-After; limite por chave, e não global; cota compartilhada entre duas instâncias via Redis; limite de login por IP |
| Fila | 202 → polling → CSV com ETag; retry com backoff (sucesso na 2ª); falha de regra sem repetir; 3 tentativas esgotadas; limite do plano; recuperação de pendentes; expurgo; Redis fora do ar |
| Documentação | a pública só contém rotas públicas, todas com escopo, exemplos e os códigos 401/403/429 descritos |
| Interface | abas de análise, relatório baixado pelo navegador, chave criada pela tela e usada por um parceiro |
| Robustez | todas as rotas documentadas recebem entradas ausentes, inválidas e maliciosas: nenhum erro 500, erro sempre no formato padrão, toda rota protegida responde 401 sem credencial |
| Processos | API sem worker + `npm run worker` separado, coordenados pelo Redis; encerramento gracioso por SIGTERM |

**Achados da revisão final (corrigidos e cobertos por teste):** a autenticação passou a rodar no
`onRequest`, antes de o corpo ser lido e validado (antes, um pedido sem credencial e com corpo inválido
recebia 400 em vez de 401, revelando as regras de validação a quem não está autenticado); erros do
próprio roteador (parâmetro longo demais, URL mal codificada) passaram ao formato padronizado; um UUID
malformado respondia 500 e agora responde 404; arquivo de relatório vencido responde 410; o limite de
relatórios simultâneos do plano passou a ser verificado dentro da transação, com trava por solicitante
(5 pedidos simultâneos no plano BASICO: exatamente 2 aceitos); relatórios podem ser cancelados na fila
ou excluídos depois de prontos; os relatórios JSON de eficiência e rentabilidade liam os dados duas
vezes e agora leem uma.

## 8. Limites conhecidos

- O modelo de vida útil é linear e não trata a censura de forma explícita (ver 2.5); o próximo passo é
  um modelo de sobrevivência quando houver mais histórico.
- O valor de recuperação é **estimado** pelos parâmetros, não o valor de venda realizado. Registrar o
  valor efetivamente obtido na destinação permitiria comparar estimativa e realidade, como já é feito
  na vida útil.
- Webhooks, cache de chaves e object storage ficaram como evolução (seção 5); o polling atende ao
  enunciado e é o mais simples para o parceiro implementar.
