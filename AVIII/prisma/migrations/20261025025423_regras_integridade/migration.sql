-- Regras de integridade que o schema do Prisma não consegue expressar.
-- Garantem que estados inconsistentes não sejam gravados, mesmo que alguém acesse o banco
-- sem passar pela API. Os erros de regra usam o SQLSTATE próprio 'GC001', que a API
-- converte em HTTP 422.

-- ------------------------------------------------------------------ sequências dos códigos legíveis
-- Geram BR001, LT-2026-0001 e EQ-000001 sem disputa entre requisições simultâneas.
CREATE SEQUENCE seq_organizacao;
CREATE SEQUENCE seq_lote;
CREATE SEQUENCE seq_equipamento;

-- ------------------------------------------------------------------ CHECK constraints
ALTER TABLE usuarios
    ADD CONSTRAINT ck_usuarios_login CHECK (login ~ '^[a-z][a-z0-9._-]{2,31}$'),
    ADD CONSTRAINT ck_usuarios_tentativas CHECK (tentativas_falhas >= 0),
    ADD CONSTRAINT ck_usuarios_versao CHECK (versao >= 1);

ALTER TABLE organizacoes
    ADD CONSTRAINT ck_organizacoes_id CHECK (id ~ '^BR[0-9]{3,}$'),
    ADD CONSTRAINT ck_organizacoes_cnpj CHECK (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
    ADD CONSTRAINT ck_organizacoes_email CHECK (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
    ADD CONSTRAINT ck_organizacoes_razao CHECK (length(trim(razao_social)) >= 3),
    ADD CONSTRAINT ck_organizacoes_versao CHECK (versao >= 1);

ALTER TABLE contratos
    ADD CONSTRAINT ck_contratos_vigencia CHECK (data_vencimento > data_assinatura),
    ADD CONSTRAINT ck_contratos_valor CHECK (valor_mensal >= 0),
    ADD CONSTRAINT ck_contratos_clausulas CHECK (jsonb_typeof(clausulas) = 'array' AND jsonb_array_length(clausulas) > 0),
    ADD CONSTRAINT ck_contratos_versao CHECK (versao >= 1);

ALTER TABLE lotes
    ADD CONSTRAINT ck_lotes_id CHECK (id ~ '^LT-[0-9]{4}-[0-9]{4,}$'),
    ADD CONSTRAINT ck_lotes_nota_fiscal CHECK (nota_fiscal ~ '^[1-9][0-9]{0,8}$'),
    ADD CONSTRAINT ck_lotes_transportadora CHECK (length(trim(transportadora)) >= 2),
    ADD CONSTRAINT ck_lotes_versao CHECK (versao >= 1);

ALTER TABLE equipamentos
    ADD CONSTRAINT ck_equipamentos_id CHECK (id ~ '^EQ-[0-9]{6,}$'),
    ADD CONSTRAINT ck_equipamentos_codigo CHECK (codigo_barras_interno ~ '^GC[A-Z]{3}[0-9]{8}$'),
    ADD CONSTRAINT ck_equipamentos_peso CHECK (peso_quilogramas > 0 AND peso_quilogramas <= 2000),
    ADD CONSTRAINT ck_equipamentos_ano CHECK (ano_fabricacao >= 1970),
    ADD CONSTRAINT ck_equipamentos_posicao CHECK (posicao_no_lote >= 1),
    ADD CONSTRAINT ck_equipamentos_versao CHECK (versao >= 1);

ALTER TABLE movimentacoes
    ADD CONSTRAINT ck_movimentacoes_destino CHECK (length(trim(destino)) >= 2);

ALTER TABLE parametros_globais
    ADD CONSTRAINT ck_parametros_unico CHECK (id = 'globais'),
    ADD CONSTRAINT ck_parametros_retencao CHECK (retencao_auditoria_dias >= 180),
    ADD CONSTRAINT ck_parametros_versao CHECK (versao >= 1);

-- ------------------------------------------------------------------ ciclo de vida do equipamento
-- 1) só aceita transições de status previstas (mesma tabela de TRANSICOES_STATUS do código);
-- 2) desmonte só depois da triagem completa do lote.
CREATE FUNCTION fn_equipamentos_status() RETURNS trigger AS $$
DECLARE
    status_lote_atual status_lote;
    permitido boolean;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status_rastreamento IS DISTINCT FROM OLD.status_rastreamento THEN
        permitido := CASE OLD.status_rastreamento
            WHEN 'AGUARDANDO_TRIAGEM'  THEN NEW.status_rastreamento IN ('EM_TRIAGEM')
            WHEN 'EM_TRIAGEM'          THEN NEW.status_rastreamento IN ('AGUARDANDO_DESMONTE', 'PECAS_REAPROVEITADAS', 'DESCARTE_SEGURO')
            WHEN 'AGUARDANDO_DESMONTE' THEN NEW.status_rastreamento IN ('EM_DESMONTE')
            WHEN 'EM_DESMONTE'         THEN NEW.status_rastreamento IN ('PECAS_REAPROVEITADAS', 'MATERIAL_RECICLAVEL', 'DESCARTE_SEGURO')
            WHEN 'PECAS_REAPROVEITADAS' THEN NEW.status_rastreamento IN ('BAIXA_DEFINITIVA')
            WHEN 'MATERIAL_RECICLAVEL' THEN NEW.status_rastreamento IN ('BAIXA_DEFINITIVA')
            WHEN 'DESCARTE_SEGURO'     THEN NEW.status_rastreamento IN ('BAIXA_DEFINITIVA')
            ELSE false
        END;
        IF NOT permitido THEN
            RAISE EXCEPTION 'Transição de status inválida: % → %.', OLD.status_rastreamento, NEW.status_rastreamento
                USING ERRCODE = 'GC001';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' AND NEW.status_rastreamento <> 'AGUARDANDO_TRIAGEM' THEN
        RAISE EXCEPTION 'Equipamento novo deve entrar como AGUARDANDO_TRIAGEM.' USING ERRCODE = 'GC001';
    END IF;

    IF NEW.status_rastreamento IN ('AGUARDANDO_DESMONTE', 'EM_DESMONTE') THEN
        SELECT status_processamento INTO status_lote_atual FROM lotes WHERE id = NEW.lote_id;
        IF status_lote_atual NOT IN ('TRIAGEM_CONCLUIDA', 'ENCAMINHADO', 'FINALIZADO') THEN
            RAISE EXCEPTION 'O equipamento % só pode ir para desmonte após a triagem completa do lote % (status %).',
                NEW.id, NEW.lote_id, status_lote_atual USING ERRCODE = 'GC001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_equipamentos_status
    BEFORE INSERT OR UPDATE OF status_rastreamento ON equipamentos
    FOR EACH ROW EXECUTE FUNCTION fn_equipamentos_status();

-- ------------------------------------------------------------------ composição do lote
-- Equipamentos só entram ou saem de lotes RECEBIDOS, e só lotes RECEBIDOS podem ser excluídos.
CREATE FUNCTION fn_equipamentos_composicao_lote() RETURNS trigger AS $$
DECLARE
    status_lote_atual status_lote;
    alvo text;
BEGIN
    alvo := CASE WHEN TG_OP = 'DELETE' THEN OLD.lote_id ELSE NEW.lote_id END;
    SELECT status_processamento INTO status_lote_atual FROM lotes WHERE id = alvo;
    -- Lote inexistente: exclusão em cascata do próprio lote (já validada por fn_lotes_exclusao).
    IF FOUND AND status_lote_atual <> 'RECEBIDO' THEN
        RAISE EXCEPTION 'O lote % está em %: só é possível incluir ou remover equipamentos de lotes RECEBIDOS.',
            alvo, status_lote_atual USING ERRCODE = 'GC001';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_equipamentos_composicao_lote
    BEFORE INSERT OR DELETE ON equipamentos
    FOR EACH ROW EXECUTE FUNCTION fn_equipamentos_composicao_lote();

CREATE FUNCTION fn_lotes_exclusao() RETURNS trigger AS $$
BEGIN
    IF OLD.status_processamento <> 'RECEBIDO' THEN
        RAISE EXCEPTION 'O lote % está em % e não pode ser excluído: só lotes RECEBIDOS podem ser removidos.',
            OLD.id, OLD.status_processamento USING ERRCODE = 'GC001';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lotes_exclusao
    BEFORE DELETE ON lotes
    FOR EACH ROW EXECUTE FUNCTION fn_lotes_exclusao();

-- ------------------------------------------------------------------ histórico imutável
-- Movimentações nunca são alteradas. Só podem sumir em cascata, quando o equipamento é
-- excluído (pg_trigger_depth() > 1 indica que a exclusão veio de uma chave estrangeira).
CREATE FUNCTION fn_movimentacoes_imutaveis() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR pg_trigger_depth() <= 1 THEN
        RAISE EXCEPTION 'O histórico de movimentações é imutável.' USING ERRCODE = 'GC001';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_movimentacoes_imutaveis
    BEFORE UPDATE OR DELETE ON movimentacoes
    FOR EACH ROW EXECUTE FUNCTION fn_movimentacoes_imutaveis();

-- Registros de auditoria: nunca alterados; excluídos apenas depois do prazo de retenção
-- (mínimo de 180 dias, configurável em parametros_globais).
CREATE FUNCTION fn_auditoria_retencao() RETURNS trigger AS $$
DECLARE
    dias integer;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Registros de auditoria são imutáveis.' USING ERRCODE = 'GC001';
    END IF;
    SELECT retencao_auditoria_dias INTO dias FROM parametros_globais WHERE id = 'globais';
    IF OLD.data_hora > now() - make_interval(days => GREATEST(COALESCE(dias, 180), 180)) THEN
        RAISE EXCEPTION 'Registro de auditoria dentro do prazo de retenção não pode ser excluído.' USING ERRCODE = 'GC001';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auditoria_retencao
    BEFORE UPDATE OR DELETE ON registros_auditoria
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria_retencao();
