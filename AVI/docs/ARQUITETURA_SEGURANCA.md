# greencode — Arquitetura de segurança e robustez

Este documento descreve a arquitetura de segurança do greencode e justifica as escolhas de criptografia, hash de senhas e expiração de sessões. Também lista os cenários de falha testados e a resposta do sistema a cada um. Tudo o que está descrito aqui é verificado pela suíte automatizada (`npm test`, 37 testes). A seção 10 relaciona a implementação ao diagrama UML do enunciado.

---

## 1. Visão geral da arquitetura

O sistema é organizado em camadas. Cada camada depende apenas das camadas abaixo dela:

```
 CLI (cli/)              CLIInterface, comandos, Argumentos, Saida, EntradaTerminal, Provisionamento
   │  apresentação: só interpreta texto e exibe resultados
 Serviços (servicos/)    ServicoAutenticacao, ServicoOrganizacao, ServicoLote, ServicoEquipamento,
   │                     ServicoRelatorio, ServicoParametros, ServicoAuditoria, ContextoSessao
   │  casos de uso + autorização (toda operação exige sessão válida e permissão do papel)
 Domínio (dominio/, validacao/, fabricas/)
   │  entidades com regras de negócio, validadores (herança/polimorfismo), fábricas de objetos compostos
 Infraestrutura (infra/) RepositorioArquivo, CriptografiaArquivo, JournalTransacao, GerenciadorJournal,
                         RegistroMudancas, EscritaAtomica, ConfiguracaoMestre, TravaInstancia
```

`Aplicacao.ts` é a raiz de composição e o único ponto onde as dependências concretas são ligadas.

Fluxo de uma operação de escrita (exemplo: `equip estado EQ-000002 --estado DANIFICADO_GRAVE --justificativa "..."`):

1. A `CLIInterface` confere a sessão com `ServicoAutenticacao.validarToken()`, resolve o comando e verifica se o papel pode executá-lo.
2. O serviço consulta o `ContextoSessao` (preenchido pelo login) e exige a permissão do papel. A regra vale mesmo quando o serviço é chamado sem passar pelo CLI.
3. A regra de negócio é aplicada: uma queda de 2 ou mais categorias no estado físico exige justificativa.
4. O serviço monta uma `JournalTransacao` com `dadosAntes`/`dadosDepois` de todas as entidades afetadas e chama `registrar()`:
   1. a transação é gravada no journal, com escrita atômica;
   2. as mudanças são aplicadas ao estado corrente pelo `RepositorioArquivo`, com escrita atômica;
   3. uma linha de CONFIRMAÇÃO sela a transação.

---

## 2. Ameaças consideradas

| Ameaça | Contramedida |
|---|---|
| Cópia ou leitura indevida dos arquivos de dados | AES-256-GCM em todos os arquivos de persistência, no journal e no histórico de comandos |
| Adulteração de dados (edição manual, troca de arquivos) | Tag de autenticação GCM; nome da coleção dentro do conteúdo cifrado; cadeia de hashes SHA-256 no journal |
| Vazamento do arquivo de credenciais | Senhas com PBKDF2-HMAC-SHA256, salt individual e 600.000 iterações |
| Adivinhação de senha online | Bloqueio da conta por 15 min após 5 falhas; mensagem genérica; custo de tempo igual para usuário inexistente |
| Terminal esquecido aberto | Sessão expira após 30 min de inatividade |
| Abuso de privilégio | Segregação por papel verificada nos serviços; o menu oculta o que o papel não pode fazer |
| Queda de energia ou encerramento brusco | Escrita atômica (temporário + `fsync` + rename), journal com escrita antecipada e recuperação automática |
| Dois processos sobre os mesmos dados | Trava de instância (`greencode.lock`) com detecção de trava órfã |

---

## 3. Criptografia dos dados em repouso: AES-256-GCM

**Onde é usada.** Em `credenciais.dat`, `organizacoes.dat`, `contratos.dat`, `lotes.dat`, `equipamentos.dat`, `movimentacoes.dat` e `parametros.dat`, no journal (cada linha cifrada separadamente) e no histórico de comandos de cada usuário.

**Por que AES-256.** O enunciado pede criptografia simétrica AES-256. O AES é o padrão NIST (FIPS 197), tem aceleração em hardware (AES-NI) nos processadores atuais e está disponível nativamente no módulo `crypto` do Node.js, sem dependências de terceiros. A chave de 256 bits também preserva uma margem de segurança contra ataques quânticos (o algoritmo de Grover reduz a força efetiva para 128 bits).

**Por que o modo GCM (e não CBC ou CTR).** O GCM é uma cifra *autenticada* (AEAD): além do sigilo, produz uma tag de 128 bits que falha se um único bit do conteúdo cifrado for alterado. Com CBC ou CTR, uma edição maliciosa passaria despercebida ou exigiria um HMAC separado, que é fácil de implementar errado. No greencode, qualquer adulteração vira um `ErroIntegridade` com severidade CRÍTICO.

**Detalhes de implementação** (`CriptografiaArquivo.cifrar(dados, chave)` / `decifrar(dadosCifrados, chave)` / `gerarChave()`):

- **IV:** 96 bits aleatórios (CSPRNG) a cada gravação. Nunca há reutilização de IV com a mesma chave, o que é requisito do GCM. Um arquivo regravado com o mesmo conteúdo produz um texto cifrado diferente.
- **Troca de arquivos:** o `RepositorioArquivo` grava o nome da coleção dentro do conteúdo cifrado e o confere na leitura. Assim, copiar `lotes.dat` por cima de `organizacoes.dat` é detectado (há teste para isso).
- **Formato:** `GC1:<base64(IV ‖ tag ‖ conteúdo cifrado)>`. O prefixo versionado permite trocar o algoritmo no futuro sem ambiguidade.

**Gestão da chave mestra.** A chave de 256 bits é gerada por `CriptografiaArquivo.gerarChave()` (`crypto.randomBytes`) durante o provisionamento. Ela fica no arquivo de configuração mestre `greencode.conf`, como exige o enunciado ("arquivo de configuração mestre que contém a chave de criptografia mestra e o cadastro do primeiro administrador"). Esse arquivo:

- é gravado com permissão `0600` (Linux) dentro de um diretório `0700`;
- registra o cadastro do primeiro administrador (login, papel e data do provisionamento; a senha fica apenas, com hash, no arquivo separado de credenciais);
- traz uma *sentinela* (um texto conhecido, cifrado) que confirma na inicialização que a chave é a correta;
- é gravado por último no provisionamento. Se o processo cair antes disso, o marcador `.provisionando` permite descartar com segurança os arquivos parciais.

> **Limitação reconhecida.** A chave fica no mesmo disco que os dados cifrados. A criptografia protege contra cópia dos arquivos de dados, backups vazados e adulteração, mas não contra quem tem acesso completo ao diretório. Na evolução do sistema, `ConfiguracaoMestre` é o único ponto a mudar para buscar a chave de um cofre: DPAPI no Windows, `libsecret`/keyring no Ubuntu, um KMS na nuvem, ou uma chave derivada de senha do operador.

---

## 4. Senhas: PBKDF2-HMAC-SHA256

**Requisito:** "senhas armazenadas em arquivo separado utilizando hash com algoritmo SHA-256".

**Escolha:** PBKDF2 com HMAC-SHA256 (RFC 8018), salt aleatório de 128 bits por usuário e 600.000 iterações (recomendação OWASP para PBKDF2-HMAC-SHA256). O algoritmo de hash continua sendo o SHA-256, como pede o enunciado. A diferença está em como ele é aplicado.

**Por que não usar SHA-256 puro.** O SHA-256 foi projetado para ser *rápido*. Uma GPU comum calcula bilhões de SHA-256 por segundo, então um arquivo de credenciais vazado seria quebrado por dicionário em minutos. Com PBKDF2:

- o **salt** individual (atributo `Credencial.salt`) impede tabelas pré-computadas (*rainbow tables*) e faz senhas iguais gerarem hashes diferentes (há teste para isso);
- as **600.000 iterações** multiplicam por 600 mil o custo de cada tentativa do atacante, enquanto o login legítimo leva menos de meio segundo (cerca de 0,45 s no computador de desenvolvimento);
- o atributo `Credencial.hashSenha` guarda os parâmetros junto do hash, no formato `pbkdf2-sha256$<iterações>$<hash>`. Dá para aumentar as iterações no futuro sem invalidar as senhas já cadastradas.

**Outras medidas:**

- **Arquivo separado:** `credenciais.dat` contém só as credenciais e também é cifrado com AES-256-GCM (dupla proteção).
- **Comparação em tempo constante:** `crypto.timingSafeEqual` em `Credencial.verificarSenha`.
- **Usuário inexistente:** o sistema calcula um hash de mesmo custo e responde com a mesma mensagem ("Usuário ou senha inválidos"), sem revelar quais logins existem.
- **Bloqueio de conta:** após 5 falhas seguidas a conta fica bloqueada por 15 minutos. O controle fica em memória no `ServicoAutenticacao`, então reiniciar o programa zera a contagem. Todas as falhas vão para o journal.
- **Política de senha** (`ValidadorSenha`): no mínimo 8 caracteres, com letras e números, e sem conter o login.
- **Entrada oculta:** a senha é digitada sem eco e é retirada do histórico do readline. Senhas nunca são aceitas como argumento de comando, que ficaria no histórico.

> Alternativas como Argon2id ou scrypt são memory-hard e ainda mais resistentes a GPU. Ficaram de fora porque o enunciado exige SHA-256. Se a exigência mudar, só a função `calcularHashSenha` precisa ser alterada; o prefixo do algoritmo já é gravado em cada hash.

---

## 5. Sessões: expiração após 30 minutos de inatividade

- **Criação:** a `Credencial` autenticada gera a `Sessao` (relacionamentos "gera" e "autenticada por" do UML). O token de 256 bits vem de `Credencial.renovarToken()` e é mantido apenas em memória.
- **Expiração deslizante:** `Sessao.renovar()` empurra `expiracao` para *agora + 30 min* a cada comando válido. A contagem é de *inatividade*, não de duração total. `Sessao.isValida()` compara o relógio com `expiracao`, e uma sessão expirada não pode ser renovada.
- **Duas camadas de verificação:**
  1. um temporizador na `CLIInterface` encerra a sessão quando os 30 min se completam, mesmo com o usuário parado no prompt;
  2. todo comando passa por `ServicoAutenticacao.validarToken()`, que confere o relógio. Isso cobre casos em que o temporizador não disparou (por exemplo, o computador em suspensão).
- **Verificação nos serviços:** o `ContextoSessao` recusa sessões expiradas mesmo quando o serviço é chamado sem passar pelo CLI (há teste). Isso prepara o sistema para a futura interface web.
- **Auditoria:** login, logout, falhas, bloqueios e expirações são registrados no journal.

**Justificativa dos 30 minutos.** É o valor pedido no enunciado e coincide com a recomendação do NIST SP 800-63B para o nível AAL2: nova autenticação após 30 minutos de inatividade. Equilibra a segurança (um terminal abandonado no almoxarifado não fica aberto indefinidamente) com a operação (uma triagem longa não é interrompida enquanto houver atividade).

---

## 6. Controle de acesso por papel

A matriz de permissões está em `dominio/enums/Permissao.ts` e é a fonte única de verdade para os serviços, o menu (`CLIInterface.exibirMenuPorPapel`), a ajuda e o auto completar.

| Permissão | ADMINISTRADOR | OPERADOR_CADASTRO | GESTOR_ALMOXARIFADO | AUDITOR |
|---|:-:|:-:|:-:|:-:|
| Gerenciar contas de acesso | ✔ | | | |
| Alterar parâmetros globais | ✔ | | | |
| Consultar parâmetros | ✔ | | | ✔ |
| Cadastrar organizações e contratos | ✔ | ✔ | | |
| Consultar organizações | ✔ | ✔ | ✔ | ✔ |
| Registrar lotes, triagem, códigos de barras e movimentações | ✔ | | ✔ | |
| Consultar lotes e equipamentos, rastrear | ✔ | | ✔ | ✔ |
| Gerar relatórios | ✔ | | | ✔ |
| Consultar e verificar o journal | ✔ | | | ✔ |
| Reverter transação | ✔ | | | |

O menu principal mostra apenas os comandos permitidos. Um comando não permitido recebe a mesma resposta de um comando inexistente, sem revelar que ele existe.

---

## 7. Integridade, atomicidade e journaling

### 7.1 Escrita atômica (`infra/EscritaAtomica.ts`)

Toda gravação em disco usa este procedimento: os arquivos de dados, o journal, o `greencode.conf` e o histórico de comandos.

1. Grava tudo num temporário no mesmo diretório (`arquivo.<pid>.<aleatório>.tmp`).
2. `fsync` do temporário, para forçar o conteúdo ao disco.
3. `rename` sobre o destino. É atômico no mesmo volume, tanto no NTFS quanto no ext4.
4. `fsync` do diretório no Linux. No Windows isso não é permitido nem necessário, porque o NTFS registra o rename no próprio journal.

Uma interrupção em qualquer ponto deixa o arquivo antigo íntegro ou o novo completo, nunca um arquivo pela metade. Temporários órfãos são removidos na inicialização. No Windows, o rename é repetido algumas vezes se um antivírus ou indexador estiver segurando o arquivo (`EPERM`/`EBUSY`).

### 7.2 Journal com escrita antecipada

- **Uma transação por operação de negócio.** Cada `JournalTransacao` tem os atributos do UML: `id`, `timestamp`, `operacao`, `entidade`, `dadosAntes`, `dadosDepois` e `usuarioResponsavel`. `dadosAntes` e `dadosDepois` guardam **todas** as entidades afetadas, no formato `{ arquivo: { id: registro | null } }`. Por exemplo, incluir um equipamento altera o equipamento, a movimentação de entrada e o lote numa só transação.
- **`registrar()`:** grava a transação no log, aplica as mudanças e grava a confirmação. O log é só de acréscimo: cada nova linha é gravada com a escrita atômica (conteúdo atual + nova linha num temporário, depois `rename`), e o conteúdo já existente nunca é editado. O custo é regravar o arquivo a cada linha: no pior caso, com o journal perto de 10 MB, cerca de 80 ms por linha (medido no computador de desenvolvimento). É imperceptível num CLI e volta a ser mínimo após cada rotação.
- **`reverter()`:** cria uma nova transação compensatória (dados antes e depois invertidos). Isso só acontece se o estado atual ainda for exatamente o produzido pela transação; se não, retorna `false`, para não apagar alterações posteriores.
- **Cadeia de hashes:** cada linha contém o SHA-256 da anterior. `journal verificar` detecta remoção, inserção, reordenação ou alteração de linhas, inclusive entre arquivos rotacionados.
- **Recuperação na inicialização:**
  - uma transação registrada mas não confirmada é **refeita** (aplicar `dadosDepois` é idempotente);
  - como defesa adicional, uma linha final incompleta (por exemplo, numa cópia interrompida do arquivo) é **descartada**. Como a transação ainda não tinha sido aplicada, nenhum dado se perde.
- **Rotação:** quando o `journal-atual.log` passa de 10 MB, ele é renomeado para `journal-AAAAMMDDTHHMMSSmmmZ.log` (sem `:`, que é inválido no Windows).
- **Retenção:** arquivos rotacionados são mantidos por pelo menos 180 dias. O parâmetro pode ser aumentado, nunca reduzido abaixo de 180. Ao expurgar um arquivo, o último hash dele é registrado, para a cadeia continuar verificável.
- Após uma falha de gravação, o sistema recusa novas transações até ser reiniciado. Isso evita que uma recuperação posterior sobrescreva mudanças mais recentes.

> O journal guarda cópias completas das entidades, inclusive credenciais, porque a recuperação precisa refazer as mudanças. Ele é cifrado com a mesma chave, e o CLI nunca exibe o conteúdo das entidades: `journal listar` mostra apenas metadados.

---

## 8. Cenários de falha testados e respostas do sistema

| # | Cenário | Teste | Resposta do sistema |
|---|---|---|---|
| 1 | Primeira execução, sem configuração mestre | `jornada.test` | Entra em modo de provisionamento, pede login e senha do admin (com confirmação) e gera a chave |
| 2 | Configuração mestre apagada, com dados existentes | `jornada.test` (4ª execução) | **CRÍTICO**: recusa iniciar e orienta a restaurar o `greencode.conf`. Não reprovisiona por cima de dados que ficariam ilegíveis |
| 3 | Queda durante o provisionamento | `jornada.test` | Na próxima execução descarta os arquivos parciais e recomeça |
| 4 | Arquivo de dados com 1 byte alterado | `jornada.test` (3ª execução) | **CRÍTICO** "Arquivo lotes.dat corrompido ou adulterado"; não inicia |
| 5 | Arquivo de dados trocado por outro | `seguranca.test` | **CRÍTICO** (conteúdo de outra coleção) |
| 6 | Chave errada ou conteúdo cifrado alterado | `seguranca.test` | **CRÍTICO** (falha de autenticação GCM) |
| 7 | Queda entre gravar o temporário e o rename | `seguranca.test` | O arquivo original continua íntegro; o temporário órfão é removido na próxima inicialização |
| 8 | Falha de disco ao aplicar uma transação | `journal.test` | **CRÍTICO** informando que a operação está preservada; novas transações são bloqueadas; ao reiniciar, a transação é refeita |
| 9 | Journal com a última linha incompleta | `journal.test` | A linha incompleta é descartada (AVISO); nenhum dado é alterado |
| 10 | Linha do journal removida | `journal.test` | `journal verificar` → **CRÍTICO** "quebra no encadeamento de hashes" |
| 11 | Linha do journal alterada | `journal.test` | `journal verificar` aponta linha ilegível; a inicialização é recusada |
| 12 | Arquivo antigo do journal apagado manualmente | `journal.test` | `journal verificar` detecta o início de cadeia sem expurgo registrado |
| 13 | Journal ultrapassa o limite de tamanho | `journal.test` | Rotação automática com a cadeia íntegra entre arquivos |
| 14 | Arquivos rotacionados com 179 e com 181 dias | `journal.test` | Mantidos até 180 dias; expurgados depois, com registro |
| 15 | Tentativa de reduzir a retenção para 90 dias | `journal.test` | **ERRO**: "no mínimo 180 dias" |
| 16 | Senha errada / usuário inexistente | `seguranca.test`, `jornada.test` | **ERRO** genérico "Usuário ou senha inválidos" |
| 17 | 5 senhas erradas seguidas | `seguranca.test` | Conta bloqueada por 15 min, inclusive para a senha correta |
| 18 | 31 minutos sem atividade | `seguranca.test` | Sessão expirada e registrada no journal; os serviços recusam a sessão |
| 19 | Papel tenta operação de outro papel | `seguranca.test`, `jornada.test` | **ERRO** "comando indisponível para o perfil"; o serviço lança `ErroPermissao` |
| 20 | Segunda instância no mesmo diretório | `seguranca.test` | **CRÍTICO** "Outra instância (PID n) já está usando o diretório"; trava órfã é removida |
| 21 | CNPJ duplicado ou com dígito errado | `regras.test`, `jornada.test` | **ERRO** com o ID da organização que já usa o CNPJ, ou "dígitos verificadores não conferem" |
| 22 | Lote com data futura, com mais de 90 dias ou de organização com contrato vencido | `regras.test`, `jornada.test` | **ERRO** com a data e o motivo |
| 23 | Desmonte antes da triagem completa | `regras.test`, `jornada.test` | **ERRO** "só pode ir para AGUARDANDO_DESMONTE após a triagem completa" |
| 24 | Estado físico cai 2+ categorias sem justificativa | `regras.test`, `jornada.test` | **ERRO** "Justificativa obrigatória"; com justificativa, ela fica registrada na movimentação |
| 25 | Remoção do último equipamento de um lote | `regras.test` | **ERRO**: o lote deve conter ao menos um equipamento (multiplicidade 1..*) |
| 26 | Reverter transação já sobrescrita | `journal.test` | `reverter()` retorna `false`; a reversão é recusada para não perder alterações posteriores |

Níveis de severidade na saída: `[OK]` sucesso · `[INFO]` · `[AVISO]` · `[ERRO]` (operação recusada, sistema íntegro) · `[CRÍTICO]` (integridade em risco).

---

## 9. Preparação para as próximas atividades

- **Interface web:** a autorização e a validade da sessão são verificadas nos serviços (via `ContextoSessao`), não no CLI. Uma API HTTP pode chamar os mesmos serviços, trocando apenas a camada `cli/` e preenchendo o contexto a cada requisição. O token de sessão já tem 256 bits e pode ir para um cookie `HttpOnly`/`Secure`.
- **Banco de dados relacional:** os serviços usam o `RepositorioArquivo` apenas por `salvarEntidade`, `carregarEntidade`, `listarEntidades` e `excluirEntidade`. Um repositório SQL com a mesma interface mapeia cada arquivo `.dat` para uma tabela, e o `registrar()` da `JournalTransacao` para uma transação `BEGIN … COMMIT`. O journal continua como trilha de auditoria à prova de adulteração.
- **Novos tipos de resíduo** (baterias, painéis solares): basta acrescentar valores aos enums `TipoEquipamento`/`CODIGO_TIPO` e parâmetros de depreciação. As regras de triagem e rastreamento são genéricas.

---

## 10. Conformidade com o diagrama UML

Todas as classes, interfaces e enumerações do diagrama estão implementadas **com os mesmos atributos, métodos, parâmetros e tipos de retorno**, e com os mesmos relacionamentos:

- `CLIInterface` **delega** aos cinco serviços e **mantém** 0..1 `Sessao`;
- `Credencial` e `Sessao` **implementam** `Autenticavel`; a `Credencial` **gera** a `Sessao` (o token vem de `Credencial.renovarToken()`) e a sessão é **autenticada por** ela; a `Credencial` **possui** um `PapelUsuario`;
- `ServicoAutenticacao` **gerencia** as credenciais (`credenciais`) e as sessões (`sessoesAtivas`);
- `ServicoRelatorio` **consulta** `ServicoLote` e `ServicoEquipamento`;
- `ServicoOrganizacao` **utiliza** `ValidadorCNPJ`;
- os serviços **utilizam** `RepositorioArquivo`, que **utiliza** `CriptografiaArquivo`;
- cada `JournalTransacao` é criada e **registrada por** `ServicoAutenticacao`, `ServicoOrganizacao`, `ServicoLote` ou `ServicoEquipamento`;
- `ValidadorCNPJ` e `ValidadorDataEntrada` **herdam** de `Validador`;
- no domínio: `Organizacao` 1 — 0..1 `Contrato`; `Organizacao` 1 — 0..* `Lote`; `Lote` 1 — 1..* `Equipamento`; `Equipamento` 1 — 0..* `Movimentacao`. O `Lote` é **classificado como** `StatusLote`, e o `Equipamento` é **classificado como** `TipoEquipamento`, **apresenta** `EstadoFisico` e **possui** `StatusRastreamento`.

Membros privados (dependências injetadas, como o relógio ou o journal) não aparecem no diagrama, como é usual em UML. **Nada do que está no diagrama foi alterado.** O que foi **acrescentado** atende a requisitos do texto do enunciado que o diagrama não detalha:

| Acréscimo | Requisito do enunciado que o motivou |
|---|---|
| `ServicoAutenticacao.criarUsuario(usuario, senha, papel)` | "administrador … responsável pela gestão de contas de acesso" |
| `ServicoEquipamento.atualizarEstadoFisicoJustificado(id, novoEstado, justificativa)` | "obrigatoriedade de justificativa textual" na queda de estado. `atualizarEstadoFisico(id, novoEstado)` do UML é mantido e usa justificativa vazia |
| `ServicoEquipamento.atualizarStatus(id, novoStatus, justificativa)` | persistir o `Equipamento.atualizarStatus` do UML e aplicar "desmonte só após triagem completa" |
| `ServicoEquipamento.registrarMovimentacao(id, destino)` | persistir o `Equipamento.registrarMovimentacao` do UML (rastreabilidade após múltiplas movimentações) |
| `ServicoParametros` + `ParametrosGlobais` | "configuração de parâmetros globais, como alíquotas de impostos e coeficientes de depreciação" |
| `ServicoAuditoria` | auditor "consultar históricos"; uso de `JournalTransacao.reverter()` |
| `FabricaOrganizacao`, `FabricaLote`, `FabricaEquipamento`, `FabricaCredencial` | "fábricas para criação de objetos compostos" (citadas no texto, sem desenho no diagrama) |
| `ValidadorSenha`, `ValidadorNotaFiscal`, `ValidadorEmail`, `ValidadorUsuario` | subclasses adicionais da classe abstrata `Validador` |
| `GerenciadorJournal`, `RegistroMudancas`, `ConfiguracaoMestre`, `TravaInstancia`, `HistoricoComandos` | journaling com rotação e retenção, arquivo de configuração mestre, atomicidade e histórico persistente |

Três pontos do texto orientaram a leitura do diagrama:

- **Lote 1..\* Equipamento.** O exemplo do enunciado (`lote criar --org BR001 --nf 123456 --transp TransRapida`) cria o lote sem equipamentos. Por isso a multiplicidade é garantida a partir da triagem: não se inicia a triagem de um lote vazio, e o último equipamento de um lote não pode ser removido.
- **`processarTriagem(loteId)`** é chamado duas vezes. A primeira inicia a triagem (os equipamentos passam a EM_TRIAGEM e têm o estado físico reclassificado); a segunda a conclui (TRIAGEM_CONCLUIDA). Só então o desmonte é liberado.
- **`cadastrarOrganizacao(dados)`** cria a organização junto com o contrato de coleta, pela fábrica. Assim a organização sempre tem `contratoVigente: Contrato`, e `renovarContrato` prorroga esse contrato.
