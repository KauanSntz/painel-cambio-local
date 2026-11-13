"""Relatório em texto a partir do banco.

Uso:
    python banco/relatorio.py

Útil para conferir os números sem abrir o dashboard.
"""
from __future__ import annotations

import os
import sqlite3
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def titulo(texto):
    print()
    print(texto)
    print("-" * len(texto))


def tabela(colunas, linhas, larguras=None):
    larguras = larguras or [
        max(len(str(c)), *(len(str(l[i])) for l in linhas)) if linhas else len(str(c))
        for i, c in enumerate(colunas)
    ]
    formato = "  ".join("{:<%d}" % w for w in larguras)
    print(formato.format(*colunas))
    print(formato.format(*["-" * w for w in larguras]))
    for linha in linhas:
        print(formato.format(*[str(v) for v in linha]))


def fmt(valor, casas=0):
    if valor is None:
        return "-"
    if isinstance(valor, float):
        return f"{valor:,.{casas}f}".replace(",", "_").replace(".", ",").replace("_", ".")
    if isinstance(valor, int):
        return f"{valor:,}".replace(",", ".")
    return str(valor)


def main():
    db = os.path.join(RAIZ, "cambio.db")
    if not os.path.exists(db):
        sys.exit("cambio.db não encontrado. Rode antes: python banco/etl.py")
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row

    titulo("Melhores ofertas")
    linhas = con.execute(
        "SELECT lado, vendedor, taxa, recebe, paga FROM ofertas WHERE melhor = 1 ORDER BY lado"
    ).fetchall()
    tabela(["lado", "vendedor", "taxa", "recebe", "paga"],
           [[r["lado"], r["vendedor"], fmt(r["taxa"]), fmt(r["recebe"]), fmt(r["paga"])] for r in linhas])

    titulo("Spread atual")
    r = con.execute(
        "SELECT coletado_em, comprar_melhor, vender_melhor,"
        " ROUND((comprar_melhor - vender_melhor) / vender_melhor * 100, 2) AS pct"
        " FROM snapshots ORDER BY coletado_em DESC LIMIT 1"
    ).fetchone()
    if r:
        print(f"coleta:   {r['coletado_em']}")
        print(f"comprar:  {fmt(r['comprar_melhor'])}")
        print(f"vender:   {fmt(r['vender_melhor'])}")
        print(f"spread:   {fmt(r['pct'], 2)}%")

    titulo("Estoque e custo (FIFO)")
    r = con.execute("""
        WITH consumido AS (
            SELECT lote_id, SUM(qtd_consumida) AS qtd FROM vw_fifo GROUP BY lote_id
        ),
        restante AS (
            SELECT l.qtd_total - COALESCE(c.qtd, 0) AS qtd, l.custo_unitario
            FROM vw_lotes l LEFT JOIN consumido c ON c.lote_id = l.lote_id
        )
        SELECT SUM(qtd) AS dd,
               ROUND(SUM(qtd * custo_unitario), 2) AS custo,
               ROUND(SUM(qtd * custo_unitario) / NULLIF(SUM(qtd), 0), 4) AS medio
        FROM restante WHERE qtd > 0
    """).fetchone()
    print(f"diamantes restantes:  {fmt(r['dd'])}")
    print(f"custo restante:       R$ {fmt(r['custo'], 2)}")
    print(f"custo médio por DD:   R$ {fmt(r['medio'], 4)}")

    titulo("Consumo por venda (lote a lote)")
    linhas = con.execute("""
        SELECT saida_id, data_saida, lote_id, qtd_consumida, custo_unitario,
               ROUND(qtd_consumida * custo_unitario, 2) AS custo
        FROM vw_fifo ORDER BY data_saida, data_lote
    """).fetchall()
    tabela(["saída", "data", "lote", "qtd", "custo/DD", "custo"],
           [[r["saida_id"], (r["data_saida"] or "")[:10], r["lote_id"],
             fmt(r["qtd_consumida"]), fmt(r["custo_unitario"], 4), fmt(r["custo"], 2)] for r in linhas])

    titulo("Resultado por venda")
    linhas = con.execute("""
        WITH custo AS (
            SELECT saida_id, SUM(qtd_consumida * custo_unitario) AS custo_brl
            FROM vw_fifo GROUP BY saida_id
        ),
        cotacao AS (
            SELECT CAST(valor AS REAL) AS rs FROM config WHERE chave = 'reaisPorMilhaoGold'
        )
        SELECT l.data, l.quantidade_dd AS dd, l.quantidade_gold AS gold,
               ROUND(l.quantidade_gold * 1.0 / l.quantidade_dd, 0) AS gold_por_dd,
               ROUND(c.custo_brl, 2) AS custo,
               ROUND(l.quantidade_gold
                     - c.custo_brl / (SELECT rs FROM cotacao) * 1000000, 0) AS lucro_gold,
               ROUND((l.quantidade_gold
                     - c.custo_brl / (SELECT rs FROM cotacao) * 1000000)
                     * (SELECT rs FROM cotacao) / 1000000, 2) AS lucro_reais
        FROM lancamentos l JOIN custo c ON c.saida_id = l.id
        WHERE l.tipo = 'venda_diamantes_gold'
        ORDER BY l.data
    """).fetchall()
    tabela(["data", "DD", "gold", "gold/DD", "custo R$", "lucro gold", "lucro R$"],
           [[(r["data"] or "")[:10], fmt(r["dd"]), fmt(r["gold"]), fmt(r["gold_por_dd"]),
             fmt(r["custo"], 2), fmt(r["lucro_gold"]), fmt(r["lucro_reais"], 2)] for r in linhas])

    titulo("Spread por dia")
    linhas = con.execute("""
        SELECT substr(coletado_em, 1, 10) AS dia, COUNT(*) AS coletas,
               ROUND(AVG(spread), 0) AS medio, MIN(spread) AS menor, MAX(spread) AS maior
        FROM snapshots GROUP BY dia ORDER BY dia
    """).fetchall()
    tabela(["dia", "coletas", "médio", "menor", "maior"],
           [[r["dia"], fmt(r["coletas"]), fmt(r["medio"]), fmt(r["menor"]), fmt(r["maior"])] for r in linhas])

    con.close()


if __name__ == "__main__":
    main()
