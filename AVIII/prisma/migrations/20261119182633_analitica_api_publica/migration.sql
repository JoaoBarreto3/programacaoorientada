-- CreateEnum
CREATE TYPE "escopo_api" AS ENUM ('RASTREABILIDADE_LER', 'LOTES_LER', 'LOTES_ESCREVER', 'RELATORIOS_GERAR');

-- CreateEnum
CREATE TYPE "plano_api" AS ENUM ('BASICO', 'PROFISSIONAL', 'CORPORATIVO');

-- CreateEnum
CREATE TYPE "tipo_analise" AS ENUM ('EFICIENCIA_OPERACIONAL', 'RENTABILIDADE', 'VIDA_UTIL');

-- CreateEnum
CREATE TYPE "origem_analise" AS ENUM ('AGENDADA', 'MANUAL');

-- CreateEnum
CREATE TYPE "tipo_relatorio" AS ENUM ('EFICIENCIA_OPERACIONAL', 'RENTABILIDADE', 'VIDA_UTIL', 'INVENTARIO_RASTREABILIDADE');

-- CreateEnum
CREATE TYPE "formato_relatorio" AS ENUM ('JSON', 'CSV');

-- CreateEnum
CREATE TYPE "situacao_tarefa" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDA', 'FALHOU');

-- AlterTable
ALTER TABLE "lotes" ADD COLUMN     "triagem_concluida_em" TIMESTAMPTZ(3),
ADD COLUMN     "triagem_concluida_por" VARCHAR(40),
ADD COLUMN     "triagem_iniciada_em" TIMESTAMPTZ(3),
ADD COLUMN     "triagem_iniciada_por" VARCHAR(40);

-- CreateTable
CREATE TABLE "chaves_api" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "prefixo" CHAR(12) NOT NULL,
    "hash_segredo" CHAR(64) NOT NULL,
    "escopos" "escopo_api"[],
    "plano" "plano_api" NOT NULL DEFAULT 'BASICO',
    "organizacao_id" VARCHAR(12),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "expira_em" TIMESTAMPTZ(3),
    "revogada_em" TIMESTAMPTZ(3),
    "ultimo_uso_em" TIMESTAMPTZ(3),
    "criada_por" VARCHAR(32) NOT NULL,
    "criada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMPTZ(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "chaves_api_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execucoes_analise" (
    "id" UUID NOT NULL,
    "tipo" "tipo_analise" NOT NULL,
    "origem" "origem_analise" NOT NULL,
    "organizacao_id" VARCHAR(12),
    "parametros" JSONB NOT NULL,
    "resultado" JSONB NOT NULL,
    "solicitante" VARCHAR(40) NOT NULL,
    "iniciada_em" TIMESTAMPTZ(3) NOT NULL,
    "concluida_em" TIMESTAMPTZ(3) NOT NULL,
    "duracao_ms" INTEGER NOT NULL,

    CONSTRAINT "execucoes_analise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "previsoes_vida_util" (
    "execucao_id" UUID NOT NULL,
    "equipamento_id" VARCHAR(12) NOT NULL,
    "tipo" "tipo_equipamento" NOT NULL,
    "estado_fisico" "estado_fisico" NOT NULL,
    "idade_anos" DECIMAL(6,2) NOT NULL,
    "anos_restantes" DECIMAL(6,2) NOT NULL,
    "data_prevista_inservivel" DATE NOT NULL,
    "metodo" VARCHAR(30) NOT NULL,

    CONSTRAINT "previsoes_vida_util_pkey" PRIMARY KEY ("execucao_id","equipamento_id")
);

-- CreateTable
CREATE TABLE "tarefas_relatorio" (
    "id" UUID NOT NULL,
    "tipo" "tipo_relatorio" NOT NULL,
    "formato" "formato_relatorio" NOT NULL,
    "parametros" JSONB NOT NULL,
    "organizacao_id" VARCHAR(12),
    "solicitante" VARCHAR(40) NOT NULL,
    "chave_api_id" UUID,
    "situacao" "situacao_tarefa" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" VARCHAR(1000),
    "criada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciada_em" TIMESTAMPTZ(3),
    "concluida_em" TIMESTAMPTZ(3),
    "expira_em" TIMESTAMPTZ(3),
    "conteudo" TEXT,
    "tipo_conteudo" VARCHAR(60),
    "tamanho_bytes" INTEGER,
    "hash_conteudo" CHAR(64),

    CONSTRAINT "tarefas_relatorio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chaves_api_prefixo_key" ON "chaves_api"("prefixo");

-- CreateIndex
CREATE INDEX "chaves_api_organizacao_id_idx" ON "chaves_api"("organizacao_id");

-- CreateIndex
CREATE INDEX "execucoes_analise_tipo_concluida_em_idx" ON "execucoes_analise"("tipo", "concluida_em");

-- CreateIndex
CREATE INDEX "previsoes_vida_util_equipamento_id_idx" ON "previsoes_vida_util"("equipamento_id");

-- CreateIndex
CREATE INDEX "tarefas_relatorio_situacao_idx" ON "tarefas_relatorio"("situacao");

-- CreateIndex
CREATE INDEX "tarefas_relatorio_chave_api_id_situacao_idx" ON "tarefas_relatorio"("chave_api_id", "situacao");

-- CreateIndex
CREATE INDEX "tarefas_relatorio_solicitante_criada_em_idx" ON "tarefas_relatorio"("solicitante", "criada_em");

-- CreateIndex
CREATE INDEX "tarefas_relatorio_expira_em_idx" ON "tarefas_relatorio"("expira_em");

-- CreateIndex
CREATE INDEX "lotes_triagem_concluida_em_idx" ON "lotes"("triagem_concluida_em");

-- AddForeignKey
ALTER TABLE "chaves_api" ADD CONSTRAINT "chaves_api_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "previsoes_vida_util" ADD CONSTRAINT "previsoes_vida_util_execucao_id_fkey" FOREIGN KEY ("execucao_id") REFERENCES "execucoes_analise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefas_relatorio" ADD CONSTRAINT "tarefas_relatorio_chave_api_id_fkey" FOREIGN KEY ("chave_api_id") REFERENCES "chaves_api"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ================================================================== regras escritas à mão (AV3)

-- ------------------------------------------------------------------ triagem dos lotes já existentes
-- Os instantes e responsáveis da triagem passam a ser colunas explícitas. Para os lotes gravados
-- antes desta migração, recupera os valores da trilha de auditoria (operações de triagem da AV2).
UPDATE lotes l
   SET triagem_iniciada_em = a.data_hora, triagem_iniciada_por = a.usuario
  FROM (SELECT DISTINCT ON (entidade_id) entidade_id, data_hora, usuario
          FROM registros_auditoria
         WHERE entidade = 'Lote' AND operacao = 'LOTE_TRIAGEM_INICIAR'
         ORDER BY entidade_id, data_hora) a
 WHERE a.entidade_id = l.id;

UPDATE lotes l
   SET triagem_concluida_em = a.data_hora, triagem_concluida_por = a.usuario
  FROM (SELECT DISTINCT ON (entidade_id) entidade_id, data_hora, usuario
          FROM registros_auditoria
         WHERE entidade = 'Lote' AND operacao = 'LOTE_TRIAGEM_CONCLUIR'
         ORDER BY entidade_id, data_hora) a
 WHERE a.entidade_id = l.id;

ALTER TABLE lotes
    ADD CONSTRAINT ck_lotes_triagem_ordem CHECK (
        triagem_concluida_em IS NULL
        OR (triagem_iniciada_em IS NOT NULL AND triagem_concluida_em >= triagem_iniciada_em)),
    ADD CONSTRAINT ck_lotes_triagem_responsavel CHECK (
        (triagem_iniciada_em IS NULL) = (triagem_iniciada_por IS NULL)
        AND (triagem_concluida_em IS NULL) = (triagem_concluida_por IS NULL));

-- ------------------------------------------------------------------ chaves de API
ALTER TABLE chaves_api
    ADD CONSTRAINT ck_chaves_api_prefixo CHECK (prefixo ~ '^[0-9a-f]{12}$'),
    ADD CONSTRAINT ck_chaves_api_hash CHECK (hash_segredo ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT ck_chaves_api_nome CHECK (length(trim(nome)) >= 3),
    ADD CONSTRAINT ck_chaves_api_escopos CHECK (cardinality(escopos) >= 1),
    -- Gravar lotes exige uma organização: o lote sempre pertence a ela.
    ADD CONSTRAINT ck_chaves_api_escrita_com_organizacao CHECK (
        NOT ('LOTES_ESCREVER' = ANY (escopos)) OR organizacao_id IS NOT NULL),
    -- Revogação é definitiva: a chave revogada fica inativa.
    ADD CONSTRAINT ck_chaves_api_revogada_inativa CHECK (revogada_em IS NULL OR NOT ativa),
    ADD CONSTRAINT ck_chaves_api_versao CHECK (versao >= 1);

-- ------------------------------------------------------------------ resultados analíticos
ALTER TABLE execucoes_analise
    ADD CONSTRAINT ck_execucoes_analise_periodo CHECK (concluida_em >= iniciada_em),
    ADD CONSTRAINT ck_execucoes_analise_duracao CHECK (duracao_ms >= 0);

ALTER TABLE previsoes_vida_util
    ADD CONSTRAINT ck_previsoes_vida_util_valores CHECK (idade_anos >= 0 AND anos_restantes >= 0);

-- ------------------------------------------------------------------ tarefas de relatório
ALTER TABLE tarefas_relatorio
    ADD CONSTRAINT ck_tarefas_relatorio_tentativas CHECK (tentativas >= 0),
    -- Tarefa concluída sempre tem o arquivo; tarefa com falha sempre tem a mensagem de erro.
    ADD CONSTRAINT ck_tarefas_relatorio_concluida CHECK (
        situacao <> 'CONCLUIDA' OR (conteudo IS NOT NULL AND concluida_em IS NOT NULL AND hash_conteudo IS NOT NULL)),
    ADD CONSTRAINT ck_tarefas_relatorio_falha CHECK (situacao <> 'FALHOU' OR erro IS NOT NULL);
