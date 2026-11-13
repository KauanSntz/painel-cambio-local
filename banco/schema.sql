-- Camada analítica do projeto.
-- O servidor continua trabalhando com JSON (fonte operacional);
-- este banco é carregado a partir desses JSON para permitir consulta SQL.
-- SQLite: sem instalação, já vem no Python.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Cotações coletadas ao longo do tempo
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snapshots (
    id              INTEGER PRIMARY KEY,
    coletado_em     TEXT    NOT NULL UNIQUE,
    comprar_qtd     INTEGER NOT NULL,
    comprar_melhor  REAL,
    comprar_mediana REAL,
    vender_qtd      INTEGER NOT NULL,
    vender_melhor   REAL,
    vender_mediana  REAL,
    spread          REAL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_data ON snapshots (coletado_em);

-- ---------------------------------------------------------------------------
-- Ofertas do snapshot mais recente
-- recebe/paga mudam de significado conforme o lado, por isso ficam separados
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ofertas (
    id             INTEGER PRIMARY KEY,
    lado           TEXT    NOT NULL CHECK (lado IN ('comprar', 'vender')),
    vendedor       TEXT    NOT NULL,
    taxa           REAL    NOT NULL CHECK (taxa > 0),
    recebe         INTEGER NOT NULL,
    paga           INTEGER NOT NULL,
    melhor         INTEGER NOT NULL DEFAULT 0 CHECK (melhor IN (0, 1)),
    pagina         INTEGER,
    status         TEXT,
    primeira_vista TEXT,
    ultima_vista   TEXT,
    vezes_visto    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ofertas_lado_taxa ON ofertas (lado, taxa);

-- ---------------------------------------------------------------------------
-- Lançamentos da carteira
-- quantidade_dd / quantidade_gold / valor_reais são preenchidos conforme o tipo.
-- Em uso_diamantes e venda_diamantes_gold a quantidade_dd é saída de estoque.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lancamentos (
    id             TEXT    PRIMARY KEY,
    tipo           TEXT    NOT NULL CHECK (tipo IN (
                       'compra_diamantes', 'venda_diamantes_gold', 'uso_diamantes',
                       'conversao_gold_reais', 'ajuste_inicial', 'saldo_atual')),
    data           TEXT    NOT NULL,
    origem         TEXT    NOT NULL DEFAULT 'manual',
    observacao     TEXT,
    quantidade_dd  INTEGER,
    quantidade_gold INTEGER,
    valor_reais    REAL
);

CREATE INDEX IF NOT EXISTS idx_lancamentos_data ON lancamentos (data);
CREATE INDEX IF NOT EXISTS idx_lancamentos_tipo ON lancamentos (tipo);

-- ---------------------------------------------------------------------------
-- Configuração vigente (cotação usada para converter gold em reais)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Lotes de compra (base do FIFO)
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS vw_lotes;
CREATE VIEW vw_lotes AS
SELECT
    id                                AS lote_id,
    data,
    quantidade_dd                     AS qtd_total,
    valor_reais                       AS custo_total,
    ROUND(valor_reais / quantidade_dd, 4) AS custo_unitario
FROM lancamentos
WHERE tipo = 'compra_diamantes'
  AND quantidade_dd > 0;

-- ---------------------------------------------------------------------------
-- Alocação FIFO: cruza cada saída com os lotes na ordem de chegada.
-- A interseção de intervalos acumulados resolve o FIFO sem laço em Python.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS vw_fifo;
CREATE VIEW vw_fifo AS
WITH entradas AS (
    SELECT lote_id, data, qtd_total, custo_unitario,
           SUM(qtd_total) OVER (ORDER BY data, lote_id
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acumulado
    FROM vw_lotes
),
saidas AS (
    SELECT id AS saida_id, tipo, data, quantidade_dd AS qtd,
           SUM(quantidade_dd) OVER (ORDER BY data, id
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acumulado
    FROM lancamentos
    WHERE tipo IN ('venda_diamantes_gold', 'uso_diamantes')
      AND quantidade_dd > 0
)
SELECT
    s.saida_id,
    s.tipo,
    s.data          AS data_saida,
    e.lote_id,
    e.data          AS data_lote,
    e.custo_unitario,
    (MIN(e.acumulado, s.acumulado)
     - MAX(e.acumulado - e.qtd_total, s.acumulado - s.qtd)) AS qtd_consumida
FROM saidas s
JOIN entradas e
  ON e.acumulado > s.acumulado - s.qtd
 AND e.acumulado - e.qtd_total < s.acumulado;
