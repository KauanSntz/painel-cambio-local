"""Carrega os JSON do projeto no banco SQLite (cambio.db).

Uso:
    python banco/etl.py                 # gera cambio.db a partir dos JSON da raiz
    python banco/etl.py --db outro.db   # caminho alternativo

O ETL é idempotente: recria o banco do zero a cada execução.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA = os.path.join(RAIZ, "banco", "schema.sql")


def num(valor):
    """Converte número do JSON. O coletor grava em pt-BR: '11.061.405'."""
    if valor is None or valor == "":
        return None
    if isinstance(valor, (int, float)):
        return float(valor)
    texto = str(valor).strip().replace(" ", "").replace(".", "").replace(",", ".")
    return float(texto)


def inteiro(valor):
    numero = num(valor)
    return None if numero is None else int(round(numero))


def ler_json(nome, padrao):
    caminho = os.path.join(RAIZ, nome)
    if not os.path.exists(caminho):
        print(f"aviso: {nome} não encontrado, usando valor padrão", file=sys.stderr)
        return padrao
    with open(caminho, encoding="utf-8") as f:
        return json.load(f)


def criar_banco(db):
    with open(SCHEMA, encoding="utf-8") as f:
        schema = f.read()
    con = sqlite3.connect(db)
    con.executescript(schema)
    return con


def carregar_snapshots(con, historico):
    con.execute("DELETE FROM snapshots")
    linhas = []
    for ponto in historico:
        comprar = ponto.get("comprar") or {}
        vender = ponto.get("vender") or {}
        linhas.append((
            ponto.get("timestamp"),
            comprar.get("quantidade", 0),
            comprar.get("melhor"),
            comprar.get("mediana"),
            vender.get("quantidade", 0),
            vender.get("melhor"),
            vender.get("mediana"),
            ponto.get("spread"),
        ))
    con.executemany(
        "INSERT INTO snapshots (coletado_em, comprar_qtd, comprar_melhor, comprar_mediana,"
        " vender_qtd, vender_melhor, vender_mediana, spread)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        linhas,
    )
    return len(linhas)


def carregar_ofertas(con, dados):
    con.execute("DELETE FROM ofertas")
    linhas = []
    for lado in ("comprar", "vender"):
        for oferta in (dados.get(lado) or {}).get("ofertas", []):
            linhas.append((
                lado,
                oferta.get("vendedor") or "?",
                num(oferta["taxa"]),
                inteiro(oferta["recebe"]),
                inteiro(oferta["paga"]),
                1 if oferta.get("melhor") else 0,
                oferta.get("pagina"),
                oferta.get("status"),
                oferta.get("primeiraVista"),
                oferta.get("ultimaVista"),
                oferta.get("vezesVisto"),
            ))
    con.executemany(
        "INSERT INTO ofertas (lado, vendedor, taxa, recebe, paga, melhor, pagina, status,"
        " primeira_vista, ultima_vista, vezes_visto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        linhas,
    )
    return len(linhas)


# Cada tipo de lançamento guarda os números em campos diferentes no JSON.
TIPOS = {
    "compra_diamantes": ("quantidadeDiamantes", None, "valorReais"),
    "venda_diamantes_gold": ("quantidadeDiamantesVendidas", "quantidadeGoldRecebida", None),
    "uso_diamantes": ("quantidadeDiamantes", None, None),
    "conversao_gold_reais": (None, "quantidadeGold", "valorReais"),
    "ajuste_inicial": ("quantidadeDiamantes", "quantidadeGold", None),
    "saldo_atual": ("quantidadeDiamantes", "quantidadeGold", None),
}


def carregar_config(con, carteira):
    con.execute("DELETE FROM config")
    config = carteira.get("config") or {}
    linhas = [(chave, str(valor)) for chave, valor in config.items()]
    con.executemany("INSERT INTO config (chave, valor) VALUES (?, ?)", linhas)
    return len(linhas)


def carregar_lancamentos(con, carteira):
    con.execute("DELETE FROM lancamentos")
    linhas = []
    ignorados = 0
    for item in carteira.get("lancamentos", []):
        tipo = item.get("tipo")
        mapa = TIPOS.get(tipo)
        if not mapa:
            ignorados += 1
            continue
        campo_dd, campo_gold, campo_reais = mapa
        linhas.append((
            item["id"],
            tipo,
            item["data"],
            item.get("origem", "manual"),
            item.get("observacao", ""),
            item.get(campo_dd) if campo_dd else None,
            item.get(campo_gold) if campo_gold else None,
            item.get(campo_reais) if campo_reais else None,
        ))
    con.executemany(
        "INSERT INTO lancamentos (id, tipo, data, origem, observacao, quantidade_dd,"
        " quantidade_gold, valor_reais) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        linhas,
    )
    return len(linhas), ignorados


def main():
    parser = argparse.ArgumentParser(description="Carrega os JSON no SQLite")
    parser.add_argument("--db", default=os.path.join(RAIZ, "cambio.db"))
    args = parser.parse_args()

    dados = ler_json("cambio_dados.json", {})
    historico = ler_json("cambio_historico.json", [])
    carteira = ler_json("meu_caixa.json", {"lancamentos": []})

    con = criar_banco(args.db)
    n_snap = carregar_snapshots(con, historico)
    n_ofertas = carregar_ofertas(con, dados)
    n_lanc, ignorados = carregar_lancamentos(con, carteira)
    n_config = carregar_config(con, carteira)
    con.commit()

    print(f"snapshots:  {n_snap}")
    print(f"ofertas:    {n_ofertas}")
    print(f"lancamentos: {n_lanc}" + (f" ({ignorados} tipo(s) não mapeado(s))" if ignorados else ""))
    print(f"config:     {n_config} chave(s)")
    print(f"banco:      {args.db}")
    con.close()


if __name__ == "__main__":
    main()
