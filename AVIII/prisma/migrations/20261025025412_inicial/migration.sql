-- CreateEnum
CREATE TYPE "papel_usuario" AS ENUM ('ADMINISTRADOR', 'OPERADOR_CADASTRO', 'GESTOR_ALMOXARIFADO', 'AUDITOR');

-- CreateEnum
CREATE TYPE "status_lote" AS ENUM ('RECEBIDO', 'EM_TRIAGEM', 'TRIAGEM_CONCLUIDA', 'ENCAMINHADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "tipo_equipamento" AS ENUM ('COMPUTADOR_MESA', 'NOTEBOOK', 'MONITOR', 'IMPRESSORA', 'SERVIDOR', 'ROTEADOR', 'CABO_ESTRUTURADO', 'FONTE_ALIMENTACAO');

-- CreateEnum
CREATE TYPE "estado_fisico" AS ENUM ('NOVO', 'BOM_ESTADO', 'USADO_LEVE', 'USADO_MODERADO', 'DANIFICADO_LEVE', 'DANIFICADO_GRAVE', 'INSERVIVEL');

-- CreateEnum
CREATE TYPE "status_rastreamento" AS ENUM ('AGUARDANDO_TRIAGEM', 'EM_TRIAGEM', 'AGUARDANDO_DESMONTE', 'EM_DESMONTE', 'PECAS_REAPROVEITADAS', 'MATERIAL_RECICLAVEL', 'DESCARTE_SEGURO', 'BAIXA_DEFINITIVA');

-- CreateEnum
CREATE TYPE "natureza_movimentacao" AS ENUM ('LOCALIZACAO', 'STATUS', 'ESTADO_FISICO');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "login" VARCHAR(32) NOT NULL,
    "hash_senha" TEXT NOT NULL,
    "salt" CHAR(32) NOT NULL,
    "papel" "papel_usuario" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_acesso" TIMESTAMPTZ(3),
    "tentativas_falhas" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_ate" TIMESTAMPTZ(3),
    "versao_token" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizacoes" (
    "id" VARCHAR(12) NOT NULL,
    "razao_social" VARCHAR(150) NOT NULL,
    "cnpj" CHAR(14) NOT NULL,
    "inscricao_estadual" VARCHAR(18) NOT NULL DEFAULT 'ISENTO',
    "endereco_completo" VARCHAR(300) NOT NULL,
    "telefone" VARCHAR(13) NOT NULL DEFAULT '',
    "email" VARCHAR(150) NOT NULL,
    "data_cadastro" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "organizacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contratos" (
    "id" UUID NOT NULL,
    "organizacao_id" VARCHAR(12) NOT NULL,
    "data_assinatura" DATE NOT NULL,
    "data_vencimento" DATE NOT NULL,
    "clausulas" JSONB NOT NULL,
    "valor_mensal" DECIMAL(12,2) NOT NULL,
    "renovacao_automatica" BOOLEAN NOT NULL DEFAULT false,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "contratos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotes" (
    "id" VARCHAR(16) NOT NULL,
    "data_entrada" DATE NOT NULL,
    "organizacao_id" VARCHAR(12) NOT NULL,
    "nota_fiscal" VARCHAR(9) NOT NULL,
    "transportadora" VARCHAR(100) NOT NULL,
    "status_processamento" "status_lote" NOT NULL DEFAULT 'RECEBIDO',
    "observacoes" VARCHAR(1000) NOT NULL DEFAULT '',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipamentos" (
    "id" VARCHAR(12) NOT NULL,
    "codigo_barras_interno" VARCHAR(13) NOT NULL,
    "tipo" "tipo_equipamento" NOT NULL,
    "marca" VARCHAR(60) NOT NULL,
    "modelo" VARCHAR(80) NOT NULL,
    "ano_fabricacao" INTEGER NOT NULL,
    "estado_fisico" "estado_fisico" NOT NULL,
    "peso_quilogramas" DECIMAL(8,3) NOT NULL,
    "lote_id" VARCHAR(16) NOT NULL,
    "posicao_no_lote" INTEGER NOT NULL,
    "status_rastreamento" "status_rastreamento" NOT NULL DEFAULT 'AGUARDANDO_TRIAGEM',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "equipamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes" (
    "id" UUID NOT NULL,
    "equipamento_id" VARCHAR(12) NOT NULL,
    "natureza" "natureza_movimentacao" NOT NULL,
    "data_hora" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origem" VARCHAR(120) NOT NULL,
    "destino" VARCHAR(120) NOT NULL,
    "responsavel" VARCHAR(32) NOT NULL,
    "observacao" VARCHAR(1000) NOT NULL DEFAULT '',

    CONSTRAINT "movimentacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametros_globais" (
    "id" VARCHAR(16) NOT NULL DEFAULT 'globais',
    "aliquotas" JSONB NOT NULL,
    "coeficientes_depreciacao" JSONB NOT NULL,
    "valores_referencia" JSONB NOT NULL,
    "retencao_auditoria_dias" INTEGER NOT NULL DEFAULT 180,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "parametros_globais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_auditoria" (
    "id" UUID NOT NULL,
    "data_hora" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operacao" VARCHAR(40) NOT NULL,
    "entidade" VARCHAR(30) NOT NULL,
    "entidade_id" VARCHAR(40) NOT NULL,
    "usuario" VARCHAR(32) NOT NULL,
    "dados_antes" JSONB,
    "dados_depois" JSONB,

    CONSTRAINT "registros_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_login_key" ON "usuarios"("login");

-- CreateIndex
CREATE UNIQUE INDEX "organizacoes_cnpj_key" ON "organizacoes"("cnpj");

-- CreateIndex
CREATE INDEX "organizacoes_ativo_idx" ON "organizacoes"("ativo");

-- CreateIndex
CREATE UNIQUE INDEX "contratos_organizacao_id_key" ON "contratos"("organizacao_id");

-- CreateIndex
CREATE INDEX "lotes_data_entrada_idx" ON "lotes"("data_entrada");

-- CreateIndex
CREATE INDEX "lotes_status_processamento_idx" ON "lotes"("status_processamento");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_organizacao_id_nota_fiscal_key" ON "lotes"("organizacao_id", "nota_fiscal");

-- CreateIndex
CREATE UNIQUE INDEX "equipamentos_codigo_barras_interno_key" ON "equipamentos"("codigo_barras_interno");

-- CreateIndex
CREATE INDEX "equipamentos_status_rastreamento_idx" ON "equipamentos"("status_rastreamento");

-- CreateIndex
CREATE INDEX "equipamentos_tipo_idx" ON "equipamentos"("tipo");

-- CreateIndex
CREATE UNIQUE INDEX "equipamentos_lote_id_posicao_no_lote_key" ON "equipamentos"("lote_id", "posicao_no_lote");

-- CreateIndex
CREATE INDEX "movimentacoes_equipamento_id_data_hora_idx" ON "movimentacoes"("equipamento_id", "data_hora");

-- CreateIndex
CREATE INDEX "registros_auditoria_entidade_entidade_id_idx" ON "registros_auditoria"("entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "registros_auditoria_data_hora_idx" ON "registros_auditoria"("data_hora");

-- CreateIndex
CREATE INDEX "registros_auditoria_usuario_idx" ON "registros_auditoria"("usuario");

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipamentos" ADD CONSTRAINT "equipamentos_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_equipamento_id_fkey" FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
