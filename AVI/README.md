# greencode

CLI de gestão de logística reversa de resíduos eletrônicos (AV1 — Programação Orientada a Objetos).
Node.js + TypeScript, persistência em arquivos cifrados (AES-256-GCM) com journaling, autenticação com
papéis e rastreabilidade completa de cada equipamento.

- Documentação de segurança, justificativas e cenários de falha: [docs/ARQUITETURA_SEGURANCA.md](docs/ARQUITETURA_SEGURANCA.md)
- Diagrama de classes (PlantUML): [docs/uml/greencode.puml](docs/uml/greencode.puml). A implementação segue o UML do enunciado
  (mesmos atributos, métodos e relacionamentos); os acréscimos exigidos pelo texto estão listados na seção 10 do documento de segurança.

## Requisitos

- **Node.js 18 ou superior**. A suíte de testes foi validada nas versões 18.20 e 20.20.
- Windows 10 ou superior, Ubuntu 24.04.3 ou superior, ou derivados do Ubuntu (Mint, Pop!\_OS, Zorin…).
- Nenhuma dependência de execução: só o Node.js. TypeScript e `@types/node` são dependências de desenvolvimento.

Instalar o Node.js:

| Sistema | Comando |
|---|---|
| Windows 10/11 | `winget install OpenJS.NodeJS.LTS` (ou o instalador de https://nodejs.org) |
| Ubuntu 24.04+ / derivados | `sudo apt install nodejs npm` |

> No Ubuntu 24.04+ basta o pacote do repositório padrão: `sudo apt install nodejs npm` (Node 18).

## Instalação e execução

```bash
npm install        # instala TypeScript
npm run build      # compila para dist/
npm start          # compila e executa
```

Para ter o comando `greencode` disponível no terminal (Windows e Linux):

```bash
npm link
greencode --ajuda
```

Opções de linha de comando: `--dados <diretório>`, `--ajuda` e `--versao`.

**Onde ficam os dados** (pode ser alterado com `--dados` ou com a variável `GREENCODE_DADOS`):

| Sistema | Diretório padrão |
|---|---|
| Windows | `%APPDATA%\greencode` |
| Linux | `$XDG_DATA_HOME/greencode` ou `~/.local/share/greencode` |

### Primeira execução: provisionamento inicial

Se não existir o arquivo de configuração mestre (`greencode.conf`), o sistema entra em **modo de provisionamento**:

1. pede o login do administrador (padrão `admin`) e a senha, que é digitada oculta e com confirmação;
2. gera a chave AES-256 mestra;
3. cria os arquivos cifrados e o journal.

> Faça backup do `greencode.conf`. Sem ele, os dados cifrados não podem ser lidos.

## Uso

Depois do login, o menu mostra apenas os comandos do seu perfil. `Tab` completa comandos, opções e valores
(tipos, estados, status, papéis), e `↑`/`↓` navegam pelo histórico, que é mantido entre sessões.

A convenção dos comandos é `<entidade> <ação> [identificadores] [--opção valor]`:

```text
lote criar --org BR001 --nf 123456 --transp TransRapida
```

| Perfil | Comandos principais |
|---|---|
| Todos | `ajuda [comando]`, `menu`, `quem`, `senha`, `sair` (logout), `encerrar` |
| ADMINISTRADOR | todos os abaixo + `usuario criar/listar`, `param listar/definir`, `journal reverter` |
| OPERADOR_CADASTRO | `org criar` (organização + contrato), `org listar/ver`, `contrato renovar` |
| GESTOR_ALMOXARIFADO | `lote criar/listar/ver/triagem`, `equip adicionar/ver/estado/status/mover/rastrear`, `relatorio triagem` |
| AUDITOR | consultas (`org`/`lote`/`equip ver`, `equip rastrear`), `relatorio organizacao/status/financeiro/triagem`, `param listar`, `journal listar/verificar` |

Exemplo de fluxo:

```text
org criar --razao "Banco Horizonte S.A." --cnpj 11.222.333/0001-81 --email ti@horizonte.com.br --endereco "Av. Paulista, 1000, São Paulo/SP" --vencimento 2027-12-31 --valor 4500 --clausulas "Coleta mensal; Laudo de destinação"
lote criar --org BR001 --nf 123456 --transp TransRapida
equip adicionar --lote LT-2026-0001 --tipo NOTEBOOK --marca Dell --modelo "Latitude 5490" --ano 2019 --estado BOM_ESTADO --peso 1.9
lote triagem LT-2026-0001                              # inicia a triagem
equip estado EQ-000001 --estado USADO_LEVE             # reclassifica o estado físico
lote triagem LT-2026-0001                              # conclui a triagem
equip status EQ-000001 AGUARDANDO_DESMONTE
equip mover EQ-000001 --destino "Linha de desmonte 1"
equip rastrear EQ-000001
```

Datas são aceitas como `AAAA-MM-DD` ou `DD/MM/AAAA`, e números decimais com ponto ou vírgula. Cada operação
responde com um nível de severidade: `[OK]`, `[INFO]`, `[AVISO]`, `[ERRO]` ou `[CRÍTICO]`.

A triagem tem duas etapas: o primeiro `lote triagem` coloca os equipamentos em EM_TRIAGEM, e o segundo conclui
a triagem (TRIAGEM_CONCLUIDA). Só depois disso os equipamentos podem seguir para o desmonte.

**Ciclo de vida de um equipamento:**

```
AGUARDANDO_TRIAGEM → EM_TRIAGEM ─(triagem do lote concluída)─┬→ AGUARDANDO_DESMONTE → EM_DESMONTE ─┬→ PECAS_REAPROVEITADAS ─┐
                                                      ├→ PECAS_REAPROVEITADAS                ├→ MATERIAL_RECICLAVEL  ─┼→ BAIXA_DEFINITIVA
                                                      └→ DESCARTE_SEGURO                     └→ DESCARTE_SEGURO      ─┘
```

## Testes

```bash
npm test          # 37 testes: unidade, regras de negócio, journal/falhas e jornada completa
npm run jornada   # apenas a jornada de ponta a ponta (CLI real em processo separado)
npm run demo      # executa scripts/demo-jornada.txt num diretório temporário e mostra a saída
```

A **jornada completa** (`tests/jornada.test.ts`) executa o CLI real com entrada redirecionada:

1. provisionamento inicial;
2. o administrador cria operador, gestor e auditor;
3. o operador cadastra a organização com o contrato e renova o contrato (CNPJ duplicado e inválido são recusados);
4. o gestor registra lote e equipamentos, tenta o desmonte antes da triagem (recusado), faz a triagem, reclassifica o estado com e sem justificativa e registra várias movimentações;
5. o sistema é reiniciado e o auditor consulta a rastreabilidade do equipamento, relatórios e a integridade do journal;
6. por fim, simula adulteração de arquivo e perda da configuração mestre.

## Estrutura

```
src/
  main.ts               ponto de entrada (argumentos, trava de instância, provisionamento, inicialização)
  Aplicacao.ts          raiz de composição (liga todas as dependências)
  cli/                  CLIInterface, comandos, parser de argumentos, saída por severidade, entrada/readline
  servicos/             casos de uso + controle de acesso por papel
  dominio/              entidades (Organizacao, Contrato, Lote, Equipamento, Movimentacao, Credencial, Sessao…) e enums
  validacao/            Validador (abstrata) e validadores concretos (CNPJ, data de entrada, senha, NF…)
  fabricas/             fábricas de objetos compostos (Organização+Contrato, Lote+Equipamentos)
  infra/                repositório cifrado, criptografia, journal, escrita atômica, configuração, trava
tests/                  testes automatizados (node:test)
docs/                   arquitetura de segurança e UML
scripts/                roteiro de demonstração
```

## Requisitos do enunciado → implementação

| Requisito | Onde |
|---|---|
| CLI `greencode` em Node.js + TypeScript | `src/main.ts`, `package.json` (`bin`) |
| Classes e relacionamentos do diagrama UML | todas as classes do diagrama, com os mesmos membros ([docs/ARQUITETURA_SEGURANCA.md](docs/ARQUITETURA_SEGURANCA.md), seção 10) |
| Herança, interfaces, polimorfismo, classes abstratas de validação, fábricas | `Validador` → 6 validadores; `Autenticavel` ← `Credencial`/`Sessao`; `Comando` (polimórfico); `fabricas/` |
| Quatro papéis com menu adaptado | `Permissao.ts` (matriz), `CLIInterface.exibirMenuPorPapel` |
| Senhas com SHA-256 em arquivo separado | `Credencial` (PBKDF2-HMAC-SHA256), `credenciais.dat` |
| Sessão expira após 30 min de inatividade | `Sessao.isValida/renovar`, `ServicoAutenticacao.validarToken`, temporizador na `CLIInterface`, `ContextoSessao` |
| Configuração mestre (chave + cadastro do 1º administrador) e provisionamento inicial | `ConfiguracaoMestre`, `cli/Provisionamento.ts` |
| AES-256 em todos os arquivos de persistência | `CriptografiaArquivo` (GCM), `RepositorioArquivo` |
| Leitura e escrita atômicas (temporário + rename) | `EscritaAtomica.ts`, usada por todos os arquivos de dados, pelo journal, pela configuração e pelo histórico |
| Journal registrado antes da aplicação, com recuperação | `JournalTransacao.registrar/reverter`, `GerenciadorJournal`, `RegistroMudancas` |
| Retenção ≥ 180 dias e rotação ao passar de 10 MB | `GerenciadorJournal` (`expurgarAntigos`, `rotacionarSeNecessario`) |
| CNPJ único com dígitos verificadores (inclui alfanumérico) | `ValidadorCNPJ`, `ServicoOrganizacao` |
| Lote: data não futura e até 90 dias | `ValidadorDataEntrada`, `FabricaLote` |
| Desmonte só após triagem completa | `ServicoLote.processarTriagem`, `ServicoEquipamento.atualizarStatus`, `Equipamento.atualizarStatus` |
| Justificativa quando o estado cai 2+ categorias | `ServicoEquipamento.atualizarEstadoFisico` / `atualizarEstadoFisicoJustificado` |
| readline com auto completar e histórico persistente | `EntradaTerminal`, `CLIInterface.completar`, `HistoricoComandos` |
| Parâmetros posicionais e opcionais | `cli/Argumentos.ts` |
| Mensagens por nível de severidade | `cli/Saida.ts`, `comum/erros.ts` |
| Scripts de teste da jornada completa | `tests/jornada.test.ts`, `scripts/` |
| Documentação de segurança e cenários de falha | `docs/ARQUITETURA_SEGURANCA.md` |
| Windows 10+ / Ubuntu 24.04.3+ | caminhos com `path`, diretórios por plataforma, nomes de arquivo sem `:`, rename com novas tentativas no Windows, sem dependências nativas |
