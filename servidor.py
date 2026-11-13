import http.server
import socketserver
import json
import os
import datetime
import statistics
import math

PORT = int(os.environ.get("PORT", "8765"))
DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(DIR, "cambio_dados.json")
HISTORY_FILE = os.path.join(DIR, "cambio_historico.json")
CASH_FILE = os.path.join(DIR, "meu_caixa.json")
MAX_HISTORY = 10080  # até 7 dias, com uma coleta por minuto

def default_cashbook():
    return {"versao": 1, "config": {"reaisPorMilhaoGold": 1}, "lancamentos": []}

def valid_cash_number(value, name, integer=False, allow_zero=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} precisa ser numérico")
    if integer and not isinstance(value, int):
        raise ValueError(f"{name} precisa ser um número {'inteiro ' if integer else ''}finito")
    if isinstance(value, int) and value > 9007199254740991:
        raise ValueError(f"{name} ultrapassa o limite numérico seguro")
    if not math.isfinite(value):
        raise ValueError(f"{name} precisa ser finito")
    if value < 0 or (value == 0 and not allow_zero):
        raise ValueError(f"{name} precisa ser {'maior ou igual a zero' if allow_zero else 'maior que zero'}")
    if value > 9007199254740991:
        raise ValueError(f"{name} ultrapassa o limite numérico seguro")
    return value

def validate_cashbook(doc):
    if not isinstance(doc, dict) or type(doc.get("versao")) is not int or doc.get("versao") != 1:
        raise ValueError("formato da carteira inválido")
    config = doc.get("config", {})
    records = doc.get("lancamentos", [])
    if not isinstance(config, dict) or not isinstance(records, list):
        raise ValueError("configuração ou lista de lançamentos inválida")
    if len(records) > 5000:
        raise ValueError("limite de 5.000 lançamentos excedido")
    rate = valid_cash_number(config.get("reaisPorMilhaoGold", 1), "cotação R$/1 milhão", allow_zero=False)
    if rate > 1000000:
        raise ValueError("cotação R$/1 milhão fora do limite permitido")

    allowed = {"compra_diamantes", "venda_diamantes_gold", "uso_diamantes", "conversao_gold_reais", "ajuste_inicial", "ajuste_saldo", "saldo_atual", "resumo"}
    normalized, ids = [], set()
    for row in records:
        if not isinstance(row, dict):
            raise ValueError("cada lançamento precisa ser um objeto")
        rid = row.get("id")
        kind = row.get("tipo")
        date = row.get("data")
        origin = row.get("origem", "manual")
        note = row.get("observacao", "")
        if not isinstance(rid, str) or not rid.strip() or len(rid) > 100 or rid in ids:
            raise ValueError("ID de lançamento ausente ou duplicado")
        if not isinstance(kind, str) or kind not in allowed:
            raise ValueError("tipo de lançamento desconhecido")
        if origin not in ("manual", "jogo"):
            raise ValueError("origem de lançamento desconhecida")
        if not isinstance(date, str) or not date.strip() or len(date) > 40:
            raise ValueError("data do lançamento inválida")
        try:
            datetime.datetime.fromisoformat(date.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError("data do lançamento precisa estar em formato ISO")
        if not isinstance(note, str) or len(note) > 500:
            raise ValueError("observação deve ter até 500 caracteres")

        item = {"id": rid, "tipo": kind, "data": date, "origem": origin, "observacao": note}
        if kind == "compra_diamantes":
            item["quantidadeDiamantes"] = valid_cash_number(row.get("quantidadeDiamantes"), "quantidade de diamantes", integer=True)
            item["valorReais"] = valid_cash_number(row.get("valorReais"), "valor pago em reais")
        elif kind == "uso_diamantes":
            item["quantidadeDiamantes"] = valid_cash_number(row.get("quantidadeDiamantes"), "diamantes usados ou transferidos", integer=True)
        elif kind == "venda_diamantes_gold":
            item["quantidadeDiamantesVendidas"] = valid_cash_number(row.get("quantidadeDiamantesVendidas"), "diamantes vendidos", integer=True)
            item["quantidadeGoldRecebida"] = valid_cash_number(row.get("quantidadeGoldRecebida"), "gold recebido", integer=True)
            if origin == "jogo":
                item["contraparte"] = str(row.get("contraparte") or "")
                item["statusPagamento"] = str(row.get("statusPagamento") or "")
                item["textoOrigem"] = str(row.get("textoOrigem") or "")
                item["importadoEm"] = str(row.get("importadoEm") or "")
        elif kind == "conversao_gold_reais":
            item["quantidadeGold"] = valid_cash_number(row.get("quantidadeGold"), "gold convertido", integer=True)
            item["valorReais"] = valid_cash_number(row.get("valorReais"), "reais recebidos")
        elif kind == "ajuste_inicial":
            dd = valid_cash_number(row.get("quantidadeDiamantes", 0), "saldo inicial de diamantes", integer=True, allow_zero=True)
            gold = valid_cash_number(row.get("quantidadeGold", 0), "saldo inicial de gold", integer=True, allow_zero=True)
            if dd == 0 and gold == 0:
                raise ValueError("o ajuste inicial precisa informar DD ou gold")
            item["quantidadeDiamantes"] = dd
            item["quantidadeGold"] = gold
        elif kind == "ajuste_saldo":
            dd = row.get("quantidadeDiamantes", 0)
            gold = row.get("quantidadeGold", 0)
            if isinstance(dd, bool) or not isinstance(dd, int):
                raise ValueError("diamantes do ajuste de saldo precisam ser inteiros")
            if isinstance(gold, bool) or not isinstance(gold, int):
                raise ValueError("gold do ajuste de saldo precisa ser inteiro")
            if dd == 0 and gold == 0:
                raise ValueError("o ajuste de saldo precisa informar DD ou gold")
            item["quantidadeDiamantes"] = dd
            item["quantidadeGold"] = gold
        elif kind == "resumo":
            item["quantidadeDiamantesComprados"] = valid_cash_number(row.get("quantidadeDiamantesComprados"), "DD comprados no resumo", integer=True, allow_zero=True)
            item["valorInvestidoReais"] = valid_cash_number(row.get("valorInvestidoReais"), "total investido no resumo", allow_zero=True)
            item["quantidadeDiamantesVendidos"] = valid_cash_number(row.get("quantidadeDiamantesVendidos"), "DD vendidos no resumo", integer=True, allow_zero=True)
            item["quantidadeGoldVendida"] = valid_cash_number(row.get("quantidadeGoldVendida"), "gold vendido no resumo", integer=True, allow_zero=True)
            item["valorRecebidoReais"] = valid_cash_number(row.get("valorRecebidoReais"), "total recebido no resumo", allow_zero=True)
            item["quantidadeDiamantesRestantes"] = valid_cash_number(row.get("quantidadeDiamantesRestantes"), "DD restantes no resumo", integer=True, allow_zero=True)
            item["quantidadeGoldRestante"] = valid_cash_number(row.get("quantidadeGoldRestante"), "gold restante no resumo", integer=True, allow_zero=True)
        else:
            item["quantidadeDiamantes"] = valid_cash_number(row.get("quantidadeDiamantes"), "saldo atual de diamantes", integer=True, allow_zero=True)
            item["quantidadeGold"] = valid_cash_number(row.get("quantidadeGold"), "saldo atual de gold", integer=True, allow_zero=True)
        ids.add(rid)
        normalized.append(item)

    return {"versao": 1, "config": {"reaisPorMilhaoGold": rate}, "lancamentos": normalized}

def save_cashbook(data):
    temp_file = CASH_FILE + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp_file, CASH_FILE)

def number(value):
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or "").strip().replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None

def summarize(offers, prefer="min"):
    rates = [n for n in (number(o.get("taxa")) for o in offers) if n is not None]
    return {
        "quantidade": len(offers),
        "melhor": (min(rates) if prefer == "min" else max(rates)) if rates else None,
        "mediana": statistics.median(rates) if rates else None,
    }

def record_history(data):
    history = []
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                history = json.load(f)
        except (json.JSONDecodeError, OSError):
            history = []
    comprar = data.get("comprar", {}).get("ofertas", [])
    vender = data.get("vender", {}).get("ofertas", [])
    buy = summarize(comprar, "min")
    sell = summarize(vender, "max")
    history.append({
        "timestamp": data["meta"]["ultimaAtualizacao"],
        "comprar": buy,
        "vender": sell,
        "spread": (buy["melhor"] - sell["melhor"])
            if buy["melhor"] is not None and sell["melhor"] is not None else None,
    })
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history[-MAX_HISTORY:], f, ensure_ascii=False, separators=(",", ":"))

def make_key(o):
    return f"{o.get('lado','')}|{o.get('taxa','')}|{o.get('vendedor','')}|{o.get('recebe','')}|{o.get('paga','')}"

def load_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"comprar": {"ofertas": []}, "vender": {"ofertas": []}, "meta": {}}

def save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def merge_side(existing_list, new_list, lado):
    now = datetime.datetime.now().isoformat()
    # index existing by key
    existing_map = {}
    for item in existing_list:
        existing_map[make_key(item)] = item
    new_keys = set()
    merged = []
    # process new: add or update
    for item in new_list:
        item = dict(item)
        item["lado"] = lado
        item["ultimaVista"] = now
        item["status"] = "ativo"
        key = make_key(item)
        new_keys.add(key)
        if key in existing_map:
            # update (keep firstSeen)
            old = existing_map[key]
            item["primeiraVista"] = old.get("primeiraVista", now)
            item["vezesVisto"] = old.get("vezesVisto", 0) + 1
        else:
            item["primeiraVista"] = now
            item["vezesVisto"] = 1
        merged.append(item)
    # process existing not in new: mark as removido (keep for 1 cycle? remove)
    for key, item in existing_map.items():
        if key not in new_keys:
            # remove (do not keep)
            pass
    return merged


def merge_vendas(cashbook, vendas):
    """Mescla vendas importadas (origem 'jogo') por ID no arquivo da carteira.

    Lançamentos manuais nunca são sobrescritos. Vendas com ID novo entram no
    resultado; vendas com ID de origem 'jogo' já presentes são atualizadas.
    """
    lancamentos = [r for r in (cashbook.get("lancamentos") or []) if isinstance(r, dict)]
    existing = {}
    for r in lancamentos:
        rid = r.get("id")
        if isinstance(rid, str) and rid and rid not in existing:
            existing[rid] = r
    adicionados, atualizados, invalidos = [], [], []
    for row in vendas:
        if not isinstance(row, dict):
            invalidos.append({"erro": "venda inválida: não é objeto"})
            continue
        rid = row.get("id")
        if not isinstance(rid, str) or not rid.strip():
            invalidos.append({"id": None, "erro": "venda sem ID estável para deduplicação"})
            continue
        if rid in existing and existing[rid].get("origem") == "manual":
            invalidos.append({"id": rid, "erro": "ID pertence a lançamento manual; não foi alterado"})
            continue
        if row.get("tipo") != "venda_diamantes_gold":
            invalidos.append({"id": rid, "erro": "tipo não aceito para importação de vendas: " + str(row.get("tipo"))})
            continue
        quantidadeDiamantes = valid_cash_number(row.get("quantidadeDiamantesVendidas"), "diamantes vendidos", integer=True)
        quantidadeGold = valid_cash_number(row.get("quantidadeGoldRecebida"), "gold recebido", integer=True)
        if quantidadeDiamantes <= 0 or quantidadeGold <= 0:
            invalidos.append({"id": rid, "erro": "venda precisa ter diamantes vendidos e gold recebido maiores que zero"})
            continue
        try:
            data = str(row.get("data") or "")
            datetime.datetime.fromisoformat(data.replace("Z", "+00:00"))
        except ValueError:
            invalidos.append({"id": rid, "erro": "data de venda inválida"})
            continue
        item = {
            "id": rid,
            "tipo": "venda_diamantes_gold",
            "data": data,
            "origem": "jogo",
            "observacao": str(row.get("observacao") or ""),
            "quantidadeDiamantesVendidas": quantidadeDiamantes,
            "quantidadeGoldRecebida": quantidadeGold,
            "contraparte": str(row.get("contraparte") or ""),
            "statusPagamento": str(row.get("statusPagamento") or ""),
            "textoOrigem": str(row.get("textoOrigem") or row.get("textoOrigem") or ""),
            "importadoEm": str(row.get("importadoEm") or datetime.datetime.now().isoformat()),
        }
        if rid in existing and existing[rid].get("origem") == "jogo":
            atualizados.append(item)
        else:
            adicionados.append(item)
    for item in atualizados:
        lancamentos = [i if i.get("id") != item["id"] else item for i in lancamentos]
    for item in adicionados:
        lancamentos.append(item)
    novo = {
        "versao": 1,
        "config": cashbook.get("config") or {"reaisPorMilhaoGold": 1},
        "lancamentos": lancamentos,
    }
    return novo, adicionados, atualizados, invalidos

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/carteira" or self.path.startswith("/carteira?"):
            try:
                with open(CASH_FILE, "r", encoding="utf-8") as f:
                    data = validate_cashbook(json.load(f))
            except FileNotFoundError:
                data = default_cashbook()
            except (json.JSONDecodeError, OSError, ValueError) as e:
                self.send_json(500, {"ok": False, "erro": "arquivo da carteira inválido: " + str(e)})
                return
            self.send_json(200, data)
            return
        if self.path == "/historico" or self.path.startswith("/historico?"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            try:
                with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                    history = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError, OSError):
                history = []
            self.wfile.write(json.dumps(history, ensure_ascii=False).encode("utf-8"))
            return
        if self.path == "/dados" or self.path.startswith("/dados?"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            data = load_data()
            # add meta
            data.setdefault("meta", {})
            data["meta"]["ultimaAtualizacao"] = data.get("meta", {}).get("ultimaAtualizacao", "")
            self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/carteira":
            try:
                length = int(self.headers.get("Content-Length", 0))
                if length <= 0 or length > 2_000_000:
                    raise ValueError("tamanho do corpo inválido")
                incoming = json.loads(self.rfile.read(length).decode("utf-8"))
                data = validate_cashbook(incoming)
                save_cashbook(data)
                self.send_json(200, {"ok": True, "lancamentos": len(data["lancamentos"])})
            except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as e:
                self.send_json(400, {"ok": False, "erro": str(e)})
            except OSError as e:
                self.send_json(500, {"ok": False, "erro": "não foi possível salvar a carteira: " + str(e)})
            return
        if self.path == "/carteira/importar-vendas":
            try:
                length = int(self.headers.get("Content-Length", 0))
                if length <= 0 or length > 2_000_000:
                    raise ValueError("tamanho do corpo inválido")
                incoming = json.loads(self.rfile.read(length).decode("utf-8"))
                vendas = incoming.get("vendas")
                if not isinstance(vendas, list):
                    raise ValueError("vendas precisa ser uma lista")
                with open(CASH_FILE, "r", encoding="utf-8") as f:
                    current = validate_cashbook(json.load(f))
                data, adicionados, atualizados, invalidos = merge_vendas(current, vendas)
                save_cashbook(data)
                self.send_json(200, {
                    "ok": True,
                    "adicionados": len(adicionados),
                    "atualizados": len(atualizados),
                    "invalidos": len(invalidos),
                    "detalhesInvalidos": invalidos,
                    "vendas": adicionados + atualizados,
                })
            except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as e:
                self.send_json(400, {"ok": False, "erro": str(e)})
            except OSError as e:
                self.send_json(500, {"ok": False, "erro": "não foi possível salvar a carteira: " + str(e)})
            return
        if self.path == "/dados":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                incoming = json.loads(body.decode("utf-8"))
                data = load_data()
                new_comprar = incoming.get("comprar", [])
                if isinstance(new_comprar, dict):
                    new_comprar = new_comprar.get("ofertas", [])
                new_vender = incoming.get("vender", [])
                if isinstance(new_vender, dict):
                    new_vender = new_vender.get("ofertas", [])
                old_comprar = data.get("comprar", {}).get("ofertas", [])
                old_vender = data.get("vender", {}).get("ofertas", [])
                merged_comprar = merge_side(old_comprar, new_comprar, "comprar")
                merged_vender = merge_side(old_vender, new_vender, "vender")
                data["comprar"] = {"ofertas": merged_comprar}
                data["vender"] = {"ofertas": merged_vender}
                data["meta"] = {
                    "ultimaAtualizacao": datetime.datetime.now().isoformat(),
                    "novosComprar": len(new_comprar),
                    "novosVender": len(new_vender),
                    "totalComprar": len(merged_comprar),
                    "totalVender": len(merged_vender),
                }
                save_data(data)
                record_history(data)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                resp = {"ok": True, "ofertas": len(merged_comprar) + len(merged_vender), "novos": len(new_comprar) + len(new_vender)}
                self.wfile.write(json.dumps(resp).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "erro": str(e)}).encode("utf-8"))
            return
        self.send_response(404)
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")

if __name__ == "__main__":
    os.chdir(DIR)
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Servidor rodando em http://127.0.0.1:{PORT}")
        print(f"Dashboard: http://127.0.0.1:{PORT}/dashboard.html")
        print(f"Dados: http://127.0.0.1:{PORT}/dados")
        print("Pressione Ctrl+C para parar.")
        httpd.serve_forever()
