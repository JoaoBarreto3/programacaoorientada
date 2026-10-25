# greencode AV2: arquitetura, decisões e trade-offs

Este documento justifica as decisões da migração do greencode de uma CLI com arquivos cifrados (AV1) para um
**servidor HTTP monolítico** com API REST, PostgreSQL e Prisma ORM (AV2). Ele também registra a revisão da AV1:
o que foi aproveitado, o que foi corrigido e o que deixou de existir.

## 1. Visão geral

```
Navegador (SPA em public/)  ──HTTP/JSON──►  Fastify  ──►  Controllers  ──►  Serviços  ──►  Repositórios  ──►  PostgreSQL
                                             │ JSON Schema       │ só HTTP        │ regras +        │ Prisma Client     │ constraints,
                                             │ hook JWT          │                │ autorização     │ $transaction      │ triggers,
                                             │ erros → HTTP      │                │ domínio rico    │ versionamento     │ sequências
```

| Camada | Pasta | Responsabilidade | Não pode |
|---|---|---|---|
| HTTP | `src/http` | rotas, JSON Schema, autenticação (JWT), conversão de erros em status HTTP, OpenAPI | conter regra de negócio |
| Serviços | `src/servicos` | casos de uso, **autorização por papel**, transações, auditoria | conhecer Fastify ou HTTP |
| Domínio | `src/dominio`, `src/validacao`, `src/fabricas` | entidades com comportamento (estado, transições, cálculos), validadores, fábricas | conhecer Prisma ou banco |
| Repositórios | `src/repositorios` | mapear tabelas ⇄ objetos de domínio, consultas, versionamento otimista | decidir regra de negócio |
| Banco | `prisma/` | modelo relacional, migrações, CHECK, triggers, índices únicos | — |

A regra de dependência é sempre de cima para baixo. O domínio não importa nada de Prisma nem de Fastify: as
enumerações do domínio são objetos constantes com os mesmos valores das enums do banco e, por serem uniões de
literais, são compatíveis com os tipos gerados pelo Prisma sem acoplamento. Os serviços recebem o usuário
autenticado como parâmetro (`UsuarioAutenticado`) e decidem a autorização. Assim a mesma camada de negócio
serviria a uma CLI ou a um consumidor de mensageria, como pede o enunciado.

## 2. Decisões e alternativas

### 2.1 Monólito modular (e não microsserviços)
Uma única aplicação Node, um único banco e um único deploy. Nesta fase o domínio é pequeno e muito acoplado
(lote, equipamento e movimentação mudam juntos na mesma transação). Separar em serviços exigiria transações
distribuídas (sagas) e consistência eventual, para nenhum ganho real. A modularidade fica no código (camadas e
um agregado por serviço), o que mantém aberta uma futura extração (por exemplo, relatórios em um serviço de leitura).

### 2.2 Fastify (e não Express)
- **Validação declarativa com JSON Schema**: entradas inválidas são recusadas (HTTP 400) antes de chegar ao
  controller. O mesmo schema gera a documentação OpenAPI (`/docs`) e acelera a serialização das respostas.
- **Hooks e plugins encapsulados**: a autenticação é um `preHandler` registrado por grupo de rotas.
- **Tratamento de erros centralizado** (`setErrorHandler`) e `return503OnClosing`/`forceCloseConnections`
  para o graceful shutdown.

O Express foi descartado porque exigiria bibliotecas extras para validação e documentação (por exemplo,
`express-validator` e `swagger-jsdoc`) e um tratamento manual de erros em código assíncrono.

### 2.3 Prisma ORM 7 + PostgreSQL
- O `schema.prisma` declara modelos, relacionamentos e índices, e gera um cliente com **tipos TypeScript exatos**.
- As **migrações versionadas** ficam em `prisma/migrations`: a primeira foi gerada pelo Prisma e a segunda
  (`regras_integridade`) foi escrita à mão com o que o Prisma não expressa (CHECK, triggers, sequências).
- O Prisma 7 usa um *driver adapter* (`@prisma/adapter-pg` + `pg`, JavaScript puro) e um compilador de consultas
  em WebAssembly. **Não há binários nativos**, o que elimina a principal fonte de problemas de instalação no
  Windows e simplifica a compatibilidade exigida (Windows 10+, Ubuntu 24.04.3+ e derivados).
- O PostgreSQL oferece transações ACID, `JSONB` (cláusulas do contrato, parâmetros e dados da auditoria), `UUID`,
  `DATE`, CHECK constraints, triggers PL/pgSQL e *advisory locks*.

Alternativas consideradas: o **TypeORM** (decorators, mais "mágica", tipos menos precisos em consultas) e o
**SQL puro com `pg`** (controle total, mas sem tipos gerados nem migrações). O **MySQL** também foi descartado:
os triggers e os CHECK constraints dele são mais limitados, e não há `JSONB` nem *advisory lock* por transação.

### 2.4 Mapeamento objeto-relacional
| Domínio (UML) | Tabela | Observações |
|---|---|---|
| Organizacao | `organizacoes` | PK legível `BR001`, `cnpj` **UNIQUE** |
| Contrato | `contratos` | `organizacao_id` **UNIQUE**, que garante a cardinalidade 0..1; `clausulas` em JSONB |
| Lote | `lotes` | PK `LT-2026-0001`; **UNIQUE (organizacao_id, nota_fiscal)**; FK RESTRICT para organização |
| Equipamento | `equipamentos` | PK `EQ-000001`, `codigo_barras_interno` **UNIQUE**, UNIQUE (lote, posição); FK CASCADE para lote |
| Movimentacao | `movimentacoes` | UUID; coluna `natureza` explícita; FK CASCADE para equipamento |
| Credencial/Usuario | `usuarios` | UUID; `login` UNIQUE; controle de tentativas e `versao_token` |
| ParametrosGlobais | `parametros_globais` | linha única (`CHECK id = 'globais'`), valores em JSONB |
| JournalTransacao | `registros_auditoria` | só-inclusão, antes/depois em JSONB |

Os códigos legíveis (BR001, LT-…, EQ-…) vêm de **sequências do PostgreSQL** (`nextval`). Na AV1 o próximo número
era calculado como "maior número existente + 1" lendo todos os registros. Com vários usuários simultâneos, isso
geraria códigos duplicados. A sequência é atômica. O custo é que uma transação desfeita deixa um "buraco" na
numeração, o que é aceitável para identificadores. Para não gastar números à toa, o CNPJ e a nota fiscal
duplicados são verificados **antes** de reservar o código.

O **Lote é a raiz do agregado** Lote → Equipamentos → Movimentações: o repositório carrega o agregado inteiro
com *eager loading* (`include` aninhado, sem consultas N+1), e as mudanças de status dos equipamentos passam pelo
lote, porque dependem da situação dele (triagem completa) e a alteram (ENCAMINHADO/FINALIZADO).

## 3. Transações e concorrência

### 3.1 Transações (`prisma.$transaction`)
`UnidadeDeTrabalho.executar()` abre uma transação interativa e entrega aos serviços um conjunto de repositórios
ligados a ela. Tudo o que um caso de uso grava é confirmado junto, ou nada é. Operações transacionais:

| Operação | O que é gravado junto |
|---|---|
| Criar lote com N equipamentos | lote + N equipamentos + N movimentações de recebimento + auditoria |
| Iniciar triagem | lote + todos os equipamentos + uma movimentação por equipamento + auditoria |
| Alterar status do equipamento | equipamento + movimentação + (se mudar) situação do lote + auditoria |
| Remover equipamento | exclusão + renumeração das posições dos demais + auditoria |
| Cadastrar organização | organização + contrato (create aninhado) + auditoria |
| Qualquer escrita | o registro de auditoria correspondente |

Um teste comprova o rollback: um lote com um equipamento inválido não deixa nem o lote nem os equipamentos válidos.

### 3.2 Versionamento otimista
Todas as entidades alteráveis têm a coluna `versao`. A proteção acontece em duas barreiras:

1. **O cliente envia a versão que leu** (`versao` no corpo do PUT/PATCH ou `?versao=` no DELETE). Se ela não
   bater com a versão atual, a resposta é **HTTP 409** e o usuário recarrega os dados antes de tentar de novo.
2. **Toda gravação** usa `UPDATE … WHERE id = ? AND versao = ?` com `versao = versao + 1`. Se outra transação
   gravou entre a leitura e a escrita, nenhuma linha é afetada e a transação inteira é desfeita, também com 409.

Isso evita a **atualização perdida** (*lost update*) sem bloquear linhas (`SELECT … FOR UPDATE`), o que é adequado
a uma aplicação web em que o tempo entre ler e gravar inclui a "reflexão" do usuário. Os testes disparam
requisições simultâneas e comprovam que uma vence, a outra recebe 409 e o histórico continua encadeado (a origem de
cada movimentação é o destino da anterior). O controle de acesso (tentativas de login, último acesso) **não**
incrementa a versão, para que um login não cause conflito com a edição feita por um administrador.

### 3.3 Unicidade sob concorrência
Os serviços verificam CNPJ, nota fiscal e login duplicados para devolver mensagens claras. Mas duas requisições
simultâneas podem passar juntas por essa verificação; quem garante a unicidade no fim são os **índices únicos**
do banco. O tratador de erros converte a violação (Prisma `P2002`) em HTTP 409 com uma mensagem amigável. O
provisionamento inicial usa um *advisory lock* para que dois pedidos simultâneos não criem dois administradores.

## 4. Integridade no banco (constraints e triggers)

As regras críticas existem **também** no banco, como segunda barreira contra estados inconsistentes, mesmo que
alguém grave por SQL direto ou por outro sistema:

| Regra | Mecanismo |
|---|---|
| Formato de CNPJ, nota fiscal, códigos, login; peso entre 0 e 2000 kg; ano ≥ 1970; valor ≥ 0; vencimento > assinatura; ao menos uma cláusula; retenção ≥ 180 dias | CHECK constraints |
| Só transições de status previstas (mesma máquina de estados do domínio); equipamento novo entra como AGUARDANDO_TRIAGEM | trigger `fn_equipamentos_status` |
| **Desmonte só depois da triagem completa do lote** | trigger `fn_equipamentos_status` |
| Equipamentos entram e saem apenas de lotes RECEBIDOS; só lotes RECEBIDOS podem ser excluídos | triggers `fn_equipamentos_composicao_lote` e `fn_lotes_exclusao` |
| Histórico de movimentações imutável (exclusão só em cascata) | trigger `fn_movimentacoes_imutaveis` |
| Auditoria imutável; exclusão só depois do prazo de retenção | trigger `fn_auditoria_retencao` |
| Organização com lotes não pode ser excluída | FK `ON DELETE RESTRICT` |

Os triggers usam o SQLSTATE próprio `GC001`, que a API converte em HTTP 422 com a mensagem do banco.

## 5. Segurança

### 5.1 Autenticação stateless com JWT
- `POST /api/auth/login` confere a senha e devolve um **JWT HS256** com `sub` (id), `login`, `papel` e `tv`
  (versão de token), válido por `SESSAO_MINUTOS` (padrão: 30).
- O cliente envia `Authorization: Bearer <token>`. Um hook `preHandler` verifica a assinatura e a expiração e
  injeta o usuário na requisição.
- **Expiração por inatividade (requisito da AV1):** cada requisição autenticada devolve um token renovado no
  cabeçalho `x-token-renovado`. Quem fica 30 minutos sem usar o sistema perde a sessão; quem está usando nunca é
  interrompido.
- **Revogação apesar de ser stateless:** a cada requisição o servidor confere se o usuário existe, está ativo e se
  `tv` é igual à `versao_token` do banco. Logout, troca de senha, mudança de papel e desativação incrementam a
  versão e invalidam **na hora** todos os tokens já emitidos. Custa uma consulta por chave primária por requisição;
  em troca, elimina a principal fraqueza do JWT (um token roubado continuar valendo até expirar). Uma *blacklist*
  em Redis foi descartada: seria mais uma peça de infraestrutura sem necessidade nesta escala.
- O segredo do JWT vem de variável de ambiente (mínimo de 32 caracteres; o servidor recusa iniciar sem ele).
  O algoritmo é fixado em HS256 na verificação, o que evita ataques de troca de algoritmo.

### 5.2 Senhas
**PBKDF2-HMAC-SHA256** com 600 mil iterações (recomendação OWASP), salt aleatório de 128 bits e comparação em tempo
constante. É o mesmo esquema da AV1 ("a mesma biblioteca de criptografia que você empregou no CLI", como pede o
enunciado), do módulo nativo `node:crypto`. Escolhemos não usar o bcrypt porque o pacote nativo exige compilação
(com problemas frequentes no Windows), enquanto o PBKDF2 é nativo e aprovado pelo NIST (SP 800-132). No servidor
foi necessária uma mudança: o hash agora é **assíncrono**, roda no pool de threads e não trava o event loop
enquanto outras requisições são atendidas.

Outras proteções: bloqueio de 15 minutos após 5 tentativas erradas (persistido no banco, então sobrevive a
reinícios); mensagem e tempo de resposta iguais para usuário inexistente e senha errada (não revela quais logins
existem); o hash nunca sai na API (os schemas de resposta só declaram os campos públicos).

### 5.3 Autorização (segregação de funções da AV1)
| Papel | Pode |
|---|---|
| ADMINISTRADOR | tudo, inclusive contas de acesso, parâmetros globais e expurgo da auditoria |
| OPERADOR_CADASTRO | organizações e contratos |
| GESTOR_ALMOXARIFADO | lotes, triagem, equipamentos e movimentações (consulta organizações) |
| AUDITOR | somente consultas, relatórios, parâmetros (leitura) e auditoria; nenhuma alteração |

Outras salvaguardas: o sistema nunca fica sem administrador ativo, e ninguém exclui ou desativa a própria conta.

### 5.4 Outras medidas
Entrada validada por JSON Schema (com campos desconhecidos removidos), limite de 1 MB no corpo das requisições,
consultas parametrizadas (o Prisma não concatena SQL), cabeçalhos `nosniff`/`X-Frame-Options`/`Referrer-Policy`,
e o front-end escapa todo conteúdo dinâmico antes de inserir no HTML (contra XSS).

### 5.5 O que mudou em relação à criptografia da AV1
A AV1 cifrava os arquivos com AES-256-GCM porque eles ficavam soltos no disco. Agora os dados estão em um SGBD com
controle de acesso próprio (usuário e senha do banco, permissões por papel). A cifragem em repouso passa a ser
responsabilidade da infraestrutura (disco cifrado, TDE ou banco gerenciado), e o tráfego deve usar TLS (`sslmode=require`
na `DATABASE_URL` e HTTPS no proxy reverso). Cifrar coluna por coluna impediria buscas e índices (por exemplo, o
CNPJ único) e foi descartado.

## 6. Auditoria (sucessora do journal)
O journal da AV1 (log imutável gravado antes de aplicar a mudança, com reversão) existia porque arquivos não
têm transações. Com o PostgreSQL, **a atomicidade e a recuperação de falhas vêm do próprio banco** (WAL + ACID).
O que continua necessário é a **rastreabilidade**: cada operação grava, na mesma transação, um registro com
operação, entidade, usuário, data e os dados **antes e depois** (JSONB). A tabela é só-inclusão (trigger), e a
retenção mínima de 180 dias da AV1 é configurável (`parametros_globais.retencao_auditoria_dias`, nunca abaixo de
180) e garantida no banco. A rotação por tamanho (10 MB) não se aplica a uma tabela; foi substituída pelo expurgo
por idade (`POST /api/auditoria/expurgo`).

A "reversão" do journal foi descartada de propósito: desfazer uma operação antiga sobrescrevendo dados ignoraria
tudo o que aconteceu depois e quebraria a rastreabilidade. Correções agora são **novas operações**, também
auditadas, como é a prática em sistemas contábeis.

## 7. Operação

- **Porta e host** configuráveis (`PORT`, `HOST`); todas as variáveis são validadas na inicialização.
- **Graceful shutdown** em SIGINT (Ctrl+C), SIGTERM (systemd/Docker) e SIGBREAK (Windows): o servidor para de
  aceitar conexões, responde 503 a novas requisições em conexões já abertas, conclui as em andamento, fecha o pool
  do banco e encerra. Há um prazo máximo (`TEMPO_DESLIGAMENTO_MS`, padrão de 10 s) para não travar o desligamento.
- Logs estruturados em JSON (pino) com id por requisição; nível configurável em `LOG_NIVEL`.
- `GET /api/saude` verifica o servidor e o banco (503 se o banco cair), para monitoramento e *health checks*.
- Na inicialização, o servidor confere a conexão e garante a linha de parâmetros; se o banco estiver fora do
  ar ou sem migrações, ele avisa e não sobe.

## 8. Cenários de falha testados

| Cenário | Resposta do sistema | Teste |
|---|---|---|
| Um equipamento inválido em um lote com vários | 400; nada é gravado (rollback) | `lotes.test.ts` |
| Duas edições simultâneas do mesmo registro | uma grava, a outra recebe 409 | `concorrencia-integridade.test.ts` |
| Movimentações simultâneas do mesmo equipamento | nenhuma é perdida; histórico encadeado | idem |
| Cadastros simultâneos com o mesmo CNPJ | um 201, o outro 409/422 (índice único) | idem |
| SQL direto pulando etapas do ciclo de vida ou desmontando antes da triagem | recusado pelo trigger | idem |
| SQL direto alterando o histórico ou a auditoria | recusado pelo trigger | idem |
| Valores fora da faixa por SQL direto | recusado por CHECK | idem |
| Token adulterado, expirado ou ausente | 401 | `autenticacao.test.ts` |
| Uso de token depois de logout, troca de senha ou desativação | 401 imediato | idem |
| Força bruta na senha | bloqueio após 5 tentativas | idem |
| Papel sem permissão | 403 (matriz completa testada) | `usuarios-permissoes.test.ts` |
| Remover o último administrador | 422 | idem |
| Reinício do servidor no meio da jornada | dados preservados; a jornada continua após o reinício | `jornada.test.ts` |
| SIGTERM com o servidor no ar | encerramento limpo, código 0 | idem |
| Banco fora do ar | `/api/saude` responde 503; na partida, mensagem clara e saída com erro | manual |
| Entradas malformadas em todas as rotas de escrita (29 casos) | 400 padronizado; nada é gravado | `validacao-entrada.test.ts` |
| Cliente tentando definir id, versão, situação ou data de cadastro | campos ignorados; o servidor decide | idem |
| JSON malformado ou corpo acima de 1 MB | 400 / 413 | idem |
| Seed executado duas vezes | a segunda execução é ignorada; nada duplica | `seed.test.ts` |
| CRUD completo feito pela interface no navegador | todas as telas funcionam sem erros de JavaScript | `interface/crud-interface.test.ts` |

## 9. Revisão da AV1

| # | Problema encontrado na AV1 | Por que importa na AV2 | Correção |
|---|---|---|---|
| 1 | Datas no fuso local (`new Date(ano, mes, dia)`) | o PostgreSQL devolve `DATE` à meia-noite UTC; no fuso de Brasília (UTC-3) a data "voltaria um dia" | datas civis em UTC (`comum/datas.ts`), com teste |
| 2 | Próximo código = maior existente + 1 | duplicação com usuários simultâneos | sequências do PostgreSQL |
| 3 | Unicidade de CNPJ/NF só em memória | corrida entre requisições | índices únicos + tradução para 409 |
| 4 | Natureza da movimentação deduzida comparando textos | frágil (um local chamado igual a um status confundiria a análise) | coluna `natureza` explícita |
| 5 | `Equipamento.atualizarStatus` gravava responsável vazio, preenchido depois pelo serviço | invariante quebrável | o responsável é parâmetro do método de domínio |
| 6 | Regras de justificativa e de triagem nos serviços | domínio anêmico | movidas para `Equipamento` e para o agregado `Lote` |
| 7 | Sessões e bloqueio de login em memória do processo | perdidos ao reiniciar; não funcionam com várias instâncias | JWT + `versao_token` + bloqueio persistido |
| 8 | PBKDF2 síncrono | travaria o servidor inteiro a cada login | versão assíncrona |
| 9 | Contrato obrigatório no cadastro | o UML e a AV2 definem 0..1 | contrato opcional, com CRUD próprio |
| 10 | CRUD incompleto (sem editar ou excluir organizações, lotes, equipamentos e usuários; CNPJ errado sem correção) | requisito desta entrega | CRUD completo, com regras de quando cada operação é permitida (ex.: CNPJ corrigível só enquanto não há lotes); matriz no README |
| 11 | Relatórios devolviam texto formatado para terminal | inúteis para um front-end | JSON estruturado |
| 12 | Relatório por organização rastreava um equipamento só para obter a razão social; listas faziam uma leitura por item | consultas N+1 | consultas diretas e *eager loading* |
| 13 | Reversão de transações do journal | podia apagar efeitos posteriores | removida (ver seção 6) |

Aproveitados com pouca ou nenhuma mudança: os validadores (`Validador` abstrato e as subclasses, inclusive o CNPJ
alfanumérico), as enumerações e a máquina de estados, o cálculo de depreciação, o código de barras com dígito
verificador, as fábricas e a matriz de permissões.

## 10. Limites conhecidos e próximos passos
- **Escala horizontal:** a API é stateless e pode rodar em várias instâncias atrás de um balanceador; o limite
  passa a ser o banco (pool de conexões; considerar PgBouncer).
- **Relatórios pesados** são calculados sob demanda; com volume alto, valem visões materializadas ou réplica de leitura.
- **Limite de requisições** (*rate limiting*) por IP no login poderia complementar o bloqueio por conta
  (`@fastify/rate-limit`).
- **HTTPS** deve ser feito por um proxy reverso (Nginx/Caddy) na implantação.
