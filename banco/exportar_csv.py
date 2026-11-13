"""Exporta as tabelas e visões para CSV compatível com Excel.

Uso:
    python banco/exportar_csv.py

Gera arquivos em saida/. O CSV é gravado em utf-8 com BOM (utf-8-sig)
para o Excel no Windows abrir os acentos corretamente.
"""
from __future__ import annotations

import csv
import os
import sqlite3
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CONSULTAS = {
    "ofertas": "SELECT * FROM ofertas ORDER BY lado, taxa",
    "snapshots": "SELECT * FROM snapshots ORDER BY coletado_em",
    "lancamentos": "SELECT * FROM lancamentos ORDER BY data",
    "fifo_alocacao": "SELECT * FROM vw_fifo ORDER BY data_saida, data_lote",
    "resumo_diario": """
        SELECT substr(coletado_em, 1, 10) AS dia,
               COUNT(*)                   AS coletas,
               ROUND(AVG(spread), 0)      AS spread_medio,
               MIN(spread)                AS menor,
               MAX(spread)                AS maior
        FROM snapshots
        GROUP BY dia
        ORDER BY dia
    """,
}


def exportar(con, pasta):
    os.makedirs(pasta, exist_ok=True)
    for nome, sql in CONSULTAS.items():
        cur = con.execute(sql)
        colunas = [d[0] for d in cur.description]
        linhas = cur.fetchall()
        caminho = os.path.join(pasta, f"{nome}.csv")
        with open(caminho, "w", newline="", encoding="utf-8-sig") as f:
            escritor = csv.writer(f, delimiter=";")
            escritor.writerow(colunas)
            escritor.writerows(linhas)
        print(f"{nome}.csv  ({len(linhas)} linha(s))")


def main():
    db = os.path.join(RAIZ, "cambio.db")
    if not os.path.exists(db):
        sys.exit("cambio.db não encontrado. Rode antes: python banco/etl.py")
    con = sqlite3.connect(db)
    exportar(con, os.path.join(RAIZ, "saida"))
    con.close()


if __name__ == "__main__":
    main()
