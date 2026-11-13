-- Consultas do projeto.
-- Rodar com: python banco/relatorio.py
-- Ou no cliente SQL de sua preferência, apontando para cambio.db

-- ---------------------------------------------------------------------------
-- 1. Melhor oferta de cada lado
-- ---------------------------------------------------------------------------
SELECT lado, vendedor, taxa, recebe, paga
FROM ofertas
WHERE melhor = 1
ORDER BY lado;

-- ---------------------------------------------------------------------------
-- 2. Spread atual, em % sobre o lado de venda
-- Mesma conta do dashboard: melhor de compra (menor taxa) menos melhor de venda (maior taxa)
-- ---------------------------------------------------------------------------
SELECT
    coletado_em,
    comprar_melhor,
    vender_melhor,
    ROUND((comprar_melhor - vender_melhor) / vender_melhor * 100, 2) AS spread_pct
FROM snapshots
ORDER BY coletado_em DESC
LIMIT 1;

-- ---------------------------------------------------------------------------
-- 3. Comportamento do spread nas últimas 1.440 coletas (~24h de coleta por minuto)
-- ---------------------------------------------------------------------------
SELECT
    COUNT(*)                        AS coletas,
    MIN(spread)                     AS menor,
    MAX(spread)                     AS maior,
    ROUND(AVG(spread), 0)           AS medio,
    ROUND(AVG((comprar_melhor - vender_melhor) / vender_melhor * 100), 2) AS spread_pct_medio
FROM (SELECT * FROM snapshots ORDER BY coletado_em DESC LIMIT 1440);

-- ---------------------------------------------------------------------------
-- 4. FIFO: qual lote pagou cada diamante vendido
-- ---------------------------------------------------------------------------
SELECT
    f.saida_id,
    f.data_saida,
    f.lote_id,
    f.data_lote,
    f.qtd_consumida,
    f.custo_unitario,
    ROUND(f.qtd_consumida * f.custo_unitario, 2) AS custo_alocado
FROM vw_fifo AS f
ORDER BY f.data_saida, f.data_lote;

-- ---------------------------------------------------------------------------
-- 5. Estoque restante e custo médio do que sobrou
-- ---------------------------------------------------------------------------
WITH consumido AS (
    SELECT lote_id, SUM(qtd_consumida) AS qtd
    FROM vw_fifo
    GROUP BY lote_id
),
restante AS (
    SELECT
        l.lote_id,
        l.data,
        l.qtd_total - COALESCE(c.qtd, 0) AS qtd,
        l.custo_unitario
    FROM vw_lotes AS l
    LEFT JOIN consumido AS c ON c.lote_id = l.lote_id
)
SELECT
    SUM(qtd)                                              AS dd_restantes,
    ROUND(SUM(qtd * custo_unitario), 2)                   AS custo_restante,
    ROUND(SUM(qtd * custo_unitario) / NULLIF(SUM(qtd), 0), 4) AS custo_medio
FROM restante
WHERE qtd > 0;

-- ---------------------------------------------------------------------------
-- 6. Resultado por venda: gold recebido contra custo convertido em gold
-- A cotação (R$ por 1 milhão de gold) vem da tabela config.
-- ---------------------------------------------------------------------------
WITH custo AS (
    SELECT saida_id, SUM(qtd_consumida * custo_unitario) AS custo_brl
    FROM vw_fifo
    GROUP BY saida_id
),
cotacao AS (
    SELECT CAST(valor AS REAL) AS rs_por_milhao FROM config WHERE chave = 'reaisPorMilhaoGold'
)
SELECT
    l.data,
    l.quantidade_dd                                             AS dd_vendidos,
    l.quantidade_gold                                           AS gold_recebido,
    ROUND(l.quantidade_gold * 1.0 / l.quantidade_dd, 0)         AS gold_por_dd,
    ROUND(c.custo_brl, 2)                                       AS custo_reais,
    ROUND(c.custo_brl / (SELECT rs_por_milhao FROM cotacao) * 1000000, 0) AS custo_em_gold,
    ROUND(l.quantidade_gold
          - c.custo_brl / (SELECT rs_por_milhao FROM cotacao) * 1000000, 0)  AS lucro_gold,
    ROUND((l.quantidade_gold
          - c.custo_brl / (SELECT rs_por_milhao FROM cotacao) * 1000000)
          * (SELECT rs_por_milhao FROM cotacao) / 1000000, 2)                AS lucro_reais
FROM lancamentos AS l
JOIN custo AS c ON c.saida_id = l.id
WHERE l.tipo = 'venda_diamantes_gold'
ORDER BY l.data;

-- ---------------------------------------------------------------------------
-- 7. Evolução diária do spread
-- ---------------------------------------------------------------------------
SELECT
    substr(coletado_em, 1, 10) AS dia,
    COUNT(*)                   AS coletas,
    ROUND(AVG(spread), 0)      AS spread_medio,
    MIN(spread)                AS menor,
    MAX(spread)                AS maior
FROM snapshots
GROUP BY dia
ORDER BY dia;

-- ---------------------------------------------------------------------------
-- 8. Volume e preço médio por lado no snapshot
-- ---------------------------------------------------------------------------
SELECT
    lado,
    COUNT(*)              AS ofertas,
    ROUND(AVG(taxa), 0)   AS taxa_media,
    MIN(taxa)             AS menor_taxa,
    MAX(taxa)             AS maior_taxa,
    SUM(recebe)           AS dd_ofertados
FROM ofertas
GROUP BY lado;
