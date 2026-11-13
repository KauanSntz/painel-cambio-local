// ==UserScript==
// @name         Leveling Idle — Câmbio (Sincronizar + Ofertas)
// @namespace    leveling-idle-2d
// @version      2.2.0
// @description  Sincroniza cotações do Câmbio e permite criar ofertas de diamantes por gold em abas separadas.
// @match        https://levelingidle2d.com.br/jogar*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  'use strict';

  window.__cambioModuloUnificado = true;

  const SERVER = 'http://127.0.0.1:8765/dados';
  const LS_AUTO = 'cambioSyncLocal.auto';
  const LS_INTERVAL = 'cambioSyncLocal.intervalMin';

  function getInterval() { return parseInt(localStorage.getItem(LS_INTERVAL) || '1', 10) || 1; }
  function getAuto() { return localStorage.getItem(LS_AUTO) === '1'; }

  let lastSentKey = ''; // para informar se os dados mudaram
  let isSending = false;

  function postJson(url, payload) {
    return new Promise((resolve, reject) => {
      const onload = (res) => {
        if (res.status < 200 || res.status >= 300) return reject(new Error('servidor respondeu HTTP ' + res.status));
        try { resolve(JSON.parse(res.responseText)); }
        catch (_) { reject(new Error('resposta inválida do servidor')); }
      };
      const onerror = () => reject(new Error('não foi possível conectar ao servidor local'));
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({ method: 'POST', url, headers: { 'Content-Type': 'application/json' }, data: payload, onload, onerror });
      } else if (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function') {
        GM.xmlHttpRequest({ method: 'POST', url, headers: { 'Content-Type': 'application/json' }, data: payload }).then(onload, onerror);
      } else {
        reject(new Error('API do Tampermonkey indisponível. Abra este arquivo no Tampermonkey e confirme que o cabeçalho @grant foi mantido.'));
      }
    });
  }

  // ---------- painel ----------
  const panel = document.createElement('div');
  panel.id = 'csPainel';
  panel.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:99999;background:#111;color:#eee;font:12px/1.4 system-ui,Segoe UI,sans-serif;padding:0;border-radius:10px;border:1px solid #444;min-width:340px;width:390px;max-width:calc(100vw - 24px);max-height:85vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.5);user-select:none;';
  panel.innerHTML = `
    <div id="csHeader"><b>◈ Câmbio</b><button id="csMini" type="button" title="minimizar">—</button></div>
    <div id="csTabs">
      <button type="button" class="csTab csTabOn" data-tab="sync">Sincronização</button>
      <button type="button" class="csTab" data-tab="offers">Criar ofertas</button>
      <button type="button" class="csTab" data-tab="calc">Calculadora</button>
    </div>
    <div id="csTabSync">
      <div id="csStatus">parado</div>
      <div id="csInfo">—</div>
      <div class="csControls">
        <button id="csSend" class="csButton">Enviar agora</button>
        <button id="csAuto" class="csButton">Auto: OFF</button>
      </div>
      <div class="csControls">
        <input id="csIv" type="number" value="1" min="1" aria-label="Intervalo em minutos">
        <span class="csUnit">min</span>
        <button id="csStop" class="csButton">Parar</button>
      </div>
    </div>
    <div id="csTabOffers" style="display:none"></div>
    <div id="csTabCalc" style="display:none">
      <div class="csCalcDisplay" id="csCalcDisplay" aria-live="polite">0</div>
      <div class="csCalcKeys">
        <button type="button" data-calc="clear" class="csCalcUtility">AC</button>
        <button type="button" data-calc="back" class="csCalcUtility">⌫</button>
        <button type="button" data-calc="op" data-value="/" class="csCalcOp">÷</button>
        <button type="button" data-calc="op" data-value="*" class="csCalcOp">×</button>
        <button type="button" data-calc="digit" data-value="7">7</button>
        <button type="button" data-calc="digit" data-value="8">8</button>
        <button type="button" data-calc="digit" data-value="9">9</button>
        <button type="button" data-calc="op" data-value="-" class="csCalcOp">−</button>
        <button type="button" data-calc="digit" data-value="4">4</button>
        <button type="button" data-calc="digit" data-value="5">5</button>
        <button type="button" data-calc="digit" data-value="6">6</button>
        <button type="button" data-calc="op" data-value="+" class="csCalcOp">+</button>
        <button type="button" data-calc="digit" data-value="1">1</button>
        <button type="button" data-calc="digit" data-value="2">2</button>
        <button type="button" data-calc="digit" data-value="3">3</button>
        <button type="button" data-calc="equals" class="csCalcEquals">=</button>
        <button type="button" data-calc="sign">±</button>
        <button type="button" data-calc="digit" data-value="0">0</button>
        <button type="button" data-calc="decimal">,</button>
      </div>
      <div class="csCalcHint">Contas básicas · resultado em sequência</div>
    </div>
  `;
  document.body.appendChild(panel);

  const panelStyle = document.createElement('style');
  panelStyle.textContent = `
    #csHeader{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;background:#1b1d26;border-bottom:1px solid #2a2c38;cursor:move}
    #csHeader b{color:#fbbf24;font-size:14px}
    #csHeader button,.csTab,.csButton{background:#22242f;border:1px solid #33364a;color:#e6e8f0;border-radius:6px;padding:6px 9px;cursor:pointer}
    #csTabs{display:flex;gap:6px;padding:9px 10px 0}
    .csTab{flex:1;background:#101117;color:#9aa3b8;font-weight:600}
    .csTab.csTabOn{color:#fff;border-color:#fbbf24;background:#29200d}
    #csTabSync{padding:9px 11px 11px}
    #csStatus{font-size:12px;color:#aaa;margin-bottom:6px;overflow-wrap:anywhere}
    #csInfo{font-size:10px;color:#888;margin-bottom:8px;overflow-wrap:anywhere}
    .csControls{display:flex;align-items:center;gap:6px;margin-top:6px}
    .csControls .csButton{flex:1}
    .csControls input{width:60px;background:#222;color:#eee;border:1px solid #444;border-radius:4px;padding:5px}
    .csUnit{font-size:11px;color:#888}
    #csTabCalc{padding:10px 12px 12px}
    .csCalcDisplay{min-height:42px;display:flex;align-items:center;justify-content:flex-end;overflow:hidden;background:#0f1015;border:1px solid #303342;border-radius:8px;padding:5px 10px;margin-bottom:8px;font:24px/1.3 ui-monospace,Consolas,monospace;color:#f3f4f6;word-break:break-all}
    .csCalcKeys{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
    .csCalcKeys button{min-height:38px;background:#22242f;border:1px solid #33364a;color:#e6e8f0;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer}
    .csCalcKeys button:hover{filter:brightness(1.2)}
    .csCalcKeys .csCalcUtility{background:#343644;color:#fca5a5}
    .csCalcKeys .csCalcOp{background:#29200d;color:#fbbf24}
    .csCalcKeys .csCalcEquals{grid-column:4;grid-row:5;background:#0f766e;color:#fff}
    .csCalcHint{font-size:10px;color:#777f91;margin-top:7px}
    #csPainel.csMini #csTabs,#csPainel.csMini #csTabSync,#csPainel.csMini #csTabOffers,#csPainel.csMini #csTabCalc{display:none!important}
  `;
  document.head.appendChild(panelStyle);

  // ---------- drag ----------
  const header = panel.querySelector('#csHeader');
  let isDragging = false;
  let offsetX = 0, offsetY = 0;
  // restore position
  const savedPos = localStorage.getItem('cambioSyncLocal.pos');
  if (savedPos) {
    try {
      const p = JSON.parse(savedPos);
      panel.style.left = p.x + 'px';
      panel.style.top = p.y + 'px';
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
    } catch (e) {}
  }
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    isDragging = true;
    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    panel.style.bottom = 'auto';
    panel.style.right = 'auto';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = (e.clientX - offsetX) + 'px';
    panel.style.top = (e.clientY - offsetY) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    localStorage.setItem('cambioSyncLocal.pos', JSON.stringify({
      x: parseInt(panel.style.left),
      y: parseInt(panel.style.top)
    }));
  });

  const status = panel.querySelector('#csStatus');
  const info = panel.querySelector('#csInfo');
  const btnAuto = panel.querySelector('#csAuto');
  const ivInput = panel.querySelector('#csIv');

  panel.querySelector('#csMini').onclick = () => panel.classList.toggle('csMini');
  panel.querySelectorAll('.csTab').forEach(btn => {
    btn.onclick = () => {
      const active = btn.dataset.tab;
      panel.querySelectorAll('.csTab').forEach(x => x.classList.toggle('csTabOn', x === btn));
      ['sync', 'offers', 'calc'].forEach(tab => {
        panel.querySelector('#csTab' + (tab === 'sync' ? 'Sync' : tab === 'offers' ? 'Offers' : 'Calc')).style.display = tab === active ? '' : 'none';
      });
    };
  });

  // Calculadora simples, sem eval e sem interferir nos campos de ofertas.
  const calcDisplay = panel.querySelector('#csCalcDisplay');
  let calcValue = '0', calcStored = null, calcOperator = null, calcAwaiting = false;
  const calcFormat = value => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 8 });
  function calcShow(value) {
    if (value === 'Erro') { calcDisplay.textContent = value; return; }
    const raw = String(value);
    calcDisplay.textContent = raw.endsWith('.') ? calcFormat(raw.slice(0, -1)) + ',' : calcFormat(raw);
  }
  function calcClear() { calcValue = '0'; calcStored = null; calcOperator = null; calcAwaiting = false; calcShow(calcValue); }
  function calcApply(a, op, b) {
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/') return b === 0 ? null : a / b;
    return b;
  }
  function calcPress(button) {
    const kind = button.dataset.calc, value = button.dataset.value;
    if (kind === 'clear') return calcClear();
    if (calcDisplay.textContent === 'Erro') calcClear();
    if (kind === 'digit') {
      calcValue = calcAwaiting || calcValue === '0' ? value : calcValue + value;
      calcAwaiting = false; calcShow(calcValue); return;
    }
    if (kind === 'decimal') {
      if (calcAwaiting) { calcValue = '0'; calcAwaiting = false; }
      if (!calcValue.includes('.')) calcValue += '.';
      calcShow(calcValue); return;
    }
    if (kind === 'sign') {
      if (calcValue !== '0') calcValue = calcValue.startsWith('-') ? calcValue.slice(1) : '-' + calcValue;
      calcShow(calcValue); return;
    }
    if (kind === 'back') {
      if (calcAwaiting) return;
      calcValue = calcValue.length > 1 ? calcValue.slice(0, -1) : '0';
      if (calcValue === '-') calcValue = '0';
      calcShow(calcValue); return;
    }
    if (kind === 'op') {
      const current = Number(calcValue);
      if (calcOperator && calcStored !== null && !calcAwaiting) {
        const result = calcApply(calcStored, calcOperator, current);
        if (result === null || !Number.isFinite(result)) { calcDisplay.textContent = 'Erro'; calcStored = null; calcOperator = null; return; }
        calcValue = String(result); calcShow(calcValue); calcStored = result;
      } else calcStored = current;
      calcOperator = value; calcAwaiting = true; return;
    }
    if (kind === 'equals' && calcOperator && calcStored !== null) {
      const result = calcApply(calcStored, calcOperator, Number(calcValue));
      if (result === null || !Number.isFinite(result)) { calcDisplay.textContent = 'Erro'; calcStored = null; calcOperator = null; return; }
      calcValue = String(result); calcShow(calcValue); calcStored = null; calcOperator = null; calcAwaiting = true;
    }
  }
  panel.querySelector('.csCalcKeys').addEventListener('click', e => {
    const button = e.target.closest('button[data-calc]');
    if (button) calcPress(button);
  });

  function setStatus(msg, color) { status.textContent = msg; status.style.color = color || '#aaa'; }
  function setInfo(msg) { info.textContent = msg; }
  function setAutoLabel() { btnAuto.textContent = 'Auto: ' + (getAuto() ? 'ON' : 'OFF'); }
  setAutoLabel();
  ivInput.value = getInterval();

  // ---------- helpers jogo ----------
  function abrirMercado() {
    if (document.querySelector('.slPanel-market')) return true;
    const btn = [...document.querySelectorAll('.slGmItem')].find(b => (b.textContent || '').trim().toLowerCase().startsWith('mercado'));
    if (!btn) return false;
    btn.click();
    return true;
  }
  async function irCambio() {
    const normalizar = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const tab = [...document.querySelectorAll('.slPanel-market .slTab, .slPanel-market [role="tab"], .slPanel-market button')]
      .find(e => normalizar(e.textContent) === 'cambio');
    if (!tab) throw new Error('aba Câmbio não encontrada no Mercado');
    tab.click();
    const limite = Date.now() + 10000;
    while (Date.now() < limite) {
      const temLista = !!document.querySelector('.cbLista .cbLinha');
      const temLado = !!document.querySelector('.cbLadoBt');
      const temPag = [...document.querySelectorAll('.slPanel-market .mkPagTexto, .slPanel-market .mkPaginas')].some(el => /(\d+)\s*(?:de|\/)\s*(\d+)/.test(String(el.textContent || '')));
      if (temLista || temLado || temPag) return;
      await waitMs(150);
    }
    throw new Error('a aba Câmbio não carregou');
  }
  async function fecharMercadoCambio() {
    const mercado = document.querySelector('.slPanel-market');
    if (!mercado) return true;
    const fechar = mercado.querySelector('.slWinClose') || document.querySelector('.slWinClose');
    if (!fechar) return false;
    try { fechar.click(); } catch (_) { return false; }
    const limite = Date.now() + 3000;
    while (document.querySelector('.slPanel-market') && Date.now() < limite) await waitMs(150);
    return !document.querySelector('.slPanel-market');
  }
  function trocarLado(queroVender) {
    const btns = [...document.querySelectorAll('.cbLadoBt')];
    const alvo = btns.find(b => (b.textContent || '').toLowerCase().includes(queroVender ? 'vender' : 'comprar'));
    if (alvo) alvo.click();
  }
  function lerPagina() {
    return [...document.querySelectorAll('.cbLista .cbLinha')].map(l => {
      const taxa = (l.querySelector('.cbTaxa b') || {}).textContent?.trim() || null;
      const vendedor = (l.querySelector('.cbVendedor') || {}).textContent?.trim() || null;
      const melhor = !!l.querySelector('.cbSelo');
      const monies = [...l.querySelectorAll('.slMoney')].map(m => (m.textContent || '').trim());
      return { taxa, vendedor, melhor, recebe: monies[0], paga: monies[1] };
    });
  }
  function getPagInfo() {
    const mercado = document.querySelector('.slPanel-market');
    if (!mercado) return { atual: null, total: null };
    const candidatos = [...mercado.querySelectorAll('.mkPagTexto, .mkPaginas, [class*="Pag"], [class*="pag"]')];
    for (const el of candidatos) {
      const m = String(el.textContent || '').replace(/\s+/g, ' ').match(/(\d+)\s*(?:de|\/)\s*(\d+)/i);
      if (m) return { atual: +m[1], total: +m[2] };
    }
    // Quando o jogo não renderiza o controle de paginação, há somente uma página.
    if (lerPagina().length) return { atual: 1, total: 1 };
    return { atual: null, total: null };
  }
  async function esperarPagina(pagina, timeout = 10000) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeout) {
      if (getPagInfo().atual === pagina) return;
      await waitMs(150);
    }
    // fallback tolerante: se a página já mostra ofertas, não aborta
    if (lerPagina().length) return;
    throw new Error('a pagina ' + pagina + ' nao carregou; coleta cancelada para evitar dados parciais');
  }
  async function coletarLado(queroVender) {
    trocarLado(queroVender);
    await waitMs(300);
    let info = getPagInfo();
    const limitePag = Date.now() + 5000;
    while ((!info.atual || !info.total) && Date.now() < limitePag) {
      await waitMs(150);
      info = getPagInfo();
    }
    if (!info.atual || !info.total) {
      // fallback: se já há ofertas na tela, assume uma única página
      if (lerPagina().length) info = { atual: 1, total: 1 };
      else throw new Error('paginacao do cambio nao encontrada');
    }
    while (info.atual > 1) {
      const b = [...document.querySelectorAll('.slPanel-market .mkPaginas .slPagBtn')].find(x => (x.textContent || '').includes('‹'));
      if (!b) throw new Error('botao para voltar a primeira pagina nao encontrado');
      b.click();
      await esperarPagina(info.atual - 1);
      info = getPagInfo();
    }
    const todas = [];
    for (let p = 1; p <= info.total; p++) {
      if (p > 1) {
        const b = [...document.querySelectorAll('.slPanel-market .mkPaginas .slPagBtn')].find(x => (x.textContent || '').includes('›'));
        if (!b) throw new Error('botao para avancar pagina nao encontrado');
        b.click();
        await esperarPagina(p);
      }
      const linhas = lerPagina();
      if (!linhas.length) throw new Error('pagina ' + p + ' veio vazia; coleta cancelada para preservar os dados atuais');
      for (const l of linhas) todas.push({ pagina: p, lado: queroVender ? 'vender' : 'comprar', ...l });
    }
    return todas;
  }
  function waitMs(ms) { return new Promise(res => setTimeout(res, ms)); }
  async function coletarTudo() {
    if (!abrirMercado()) throw new Error('nao consegui abrir o Mercado');
    await waitMs(300);
    await irCambio();
    const comprar = await coletarLado(false);
    const vender = await coletarLado(true);
    return { comprar, vender, coletadoEm: new Date().toISOString() };
  }

  // ---------- envio ----------
  async function enviar() {
    if (isSending) return;
    if (window.__cambioOfertaRunning) {
      setStatus('adiado: lote de ofertas em andamento', '#fc0');
      return;
    }
    isSending = true;
    window.__cambioSyncBusy = true;
    setStatus('coletando...', '#ff0');
    try {
      const dados = await coletarTudo();
      const key = JSON.stringify([dados.comprar, dados.vender].map(lado => lado.map(o=>[o.taxa,o.vendedor,o.recebe,o.paga])));
      const novo = (key !== lastSentKey);
      const total = dados.comprar.length + dados.vender.length;
      setInfo('coletado: ' + total + ' ofertas (' + dados.comprar.length + ' compra, ' + dados.vender.length + ' venda)');
      lastSentKey = key;
      const payload = JSON.stringify(dados);
      const j = await postJson(SERVER, payload);
      setStatus('enviado: ' + (j.ofertas || 0) + ' ofertas' + (novo ? ' (NOVO)' : ''), novo ? '#0f0' : '#aaa');
      setInfo('ultima: ' + new Date().toLocaleTimeString() + ' | novos: ' + (j.novos || 0) + ' | total: ' + (j.ofertas || 0));
    } catch (e) {
      setStatus('erro: ' + (e && e.message ? e.message : e), '#f66');
    } finally {
      const fechado = await fecharMercadoCambio();
      if (!fechado) setInfo((info.textContent ? info.textContent + ' | ' : '') + 'aviso: Market/Câmbio ficou aberto');
      isSending = false;
      window.__cambioSyncBusy = false;
    }
  }

  // ---------- controles ----------
  panel.querySelector('#csSend').addEventListener('click', () => { enviar(); });
  btnAuto.addEventListener('click', () => {
    const novo = !getAuto();
    localStorage.setItem(LS_AUTO, novo ? '1' : '0');
    if (ivInput.value) localStorage.setItem(LS_INTERVAL, ivInput.value);
    setAutoLabel();
    if (novo) startAuto(); else { if (timer) clearInterval(timer); timer = null; setStatus('auto desligado', '#aaa'); }
  });
  panel.querySelector('#csStop').addEventListener('click', () => {
    if (timer) clearInterval(timer);
    timer = null;
    localStorage.setItem(LS_AUTO, '0');
    setAutoLabel();
    setStatus('parado', '#aaa');
  });

  let timer = null;
  function startAuto() {
    if (timer) clearInterval(timer);
    if (!getAuto()) { setStatus('auto desligado', '#aaa'); return; }
    const ms = getInterval() * 60 * 1000;
    timer = setInterval(() => { enviar(); }, ms);
    setStatus('auto ligado (' + getInterval() + 'min)', '#0f0');
  }
  if (getAuto()) startAuto();
})();

// ---------- aba: criação de ofertas ----------
(function () {
  'use strict';

  if (window.__cambioOfertasUnificado) return;
  window.__cambioOfertasUnificado = true;
  const painelAntigo = document.getElementById('coPainel');
  if (painelAntigo) painelAntigo.remove();

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  let toastTimer = null;
  function toast(msg) {
    let t = $('coToast');
    if (!t) { t = document.createElement('div'); t.id = 'coToast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('coToastOn');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('coToastOn'), 5000);
  }

  const MAX_OFFERS_PER_BATCH = 100;

  const state = { running: false, stopped: false, log: [] };

  // ---------- painel ----------
  const panel = document.createElement('div');
  panel.id = 'coPainel';
  panel.innerHTML = `
    <div id="coCorpo">
      <div class="coHint">
        Cria <b>várias ofertas com o tamanho que você escolher</b>. Cada oferta vende a quantidade de diamantes informada pelo total de gold correspondente.
        Exemplo: 5 ofertas de 2 DD a 375.000/DD = 5 ofertas de 2 DD por 750.000 gold cada (10 DD e 3.750.000 gold no total). Limite de 100 ofertas por lote.
        <b>Gasta diamantes de verdade</b> — a quantia sai da conta assim que o anúncio entra. Começa pausado.
      </div>
      <div class="coSec">
        <label>Diamantes por oferta<input id="coDiam" type="number" min="1" step="1" placeholder="ex.: 2"></label>
        <label>Quantidade de ofertas<input id="coOffers" type="number" min="1" step="1" placeholder="ex.: 5"></label>
        <label>Gold a receber por diamante<input id="coGold" type="number" min="1" step="1" placeholder="ex.: 375000"></label>
      </div>
      <div id="coPreview" class="coPreview">Preencha os campos para ver a prévia.</div>
      <div class="coBtns">
        <button id="coPreviewBtn" class="coB3">Atualizar prévia</button>
        <button id="coStart" class="coB4">Iniciar lote</button>
        <button id="coStop" class="coB2">Parar</button>
      </div>
      <div id="coStatus" class="coStatus">pausado</div>
      <div class="coLogHeader"><b>Log de criação</b><button id="coLogToggle" type="button">Recolher log</button></div>
      <div id="coLog" class="coLog"><div class="coVazio">—</div></div>
    </div>`;
  const mount = document.getElementById('csTabOffers');
  if (!mount) return;
  mount.appendChild(panel);

  const coDiam = $('coDiam');
  const coOffers = $('coOffers');
  const coGold = $('coGold');
  const coPreview = $('coPreview');
  const coStatus = $('coStatus');
  const coLog = $('coLog');
  const coStart = $('coStart');
  const coStop = $('coStop');

  const coLogToggle = $('coLogToggle');
  const logCollapsedKey = 'cambioOfertas.logCollapsed';
  const setLogCollapsed = collapsed => {
    panel.classList.toggle('coLogMin', collapsed);
    coLogToggle.textContent = collapsed ? 'Mostrar log' : 'Recolher log';
    localStorage.setItem(logCollapsedKey, collapsed ? '1' : '0');
  };
  setLogCollapsed(localStorage.getItem(logCollapsedKey) === '1');
  coLogToggle.onclick = () => setLogCollapsed(!panel.classList.contains('coLogMin'));

  function setStatus(t) { if (coStatus) coStatus.textContent = t; }
  function log(msg, tipo) {
    state.log.push({ t: Date.now(), msg, tipo: tipo || '' });
    if (state.log.length > 200) state.log.shift();
    if (!coLog) return;
    const d = new Date().toLocaleTimeString('pt-BR');
    const cls = tipo === 'ok' ? 'coLogOk' : (tipo === 'err' ? 'coLogErr' : '');
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = d + ' ' + msg;
    const vazio = coLog.querySelector('.coVazio');
    if (vazio) vazio.remove();
    coLog.appendChild(div);
    coLog.scrollTop = coLog.scrollHeight;
  }

  // ---------- helpers do jogo ----------
  function abrirMercado() {
    if (document.querySelector('.slPanel-market')) return true;
    const btn = [...document.querySelectorAll('.slGmItem')]
      .find(b => (b.textContent || '').trim().toLowerCase().startsWith('mercado'));
    if (!btn) return false;
    btn.click();
    return true;
  }
  async function abrirCambio() {
    if (!abrirMercado()) return false;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && !document.querySelector('.slPanel-market')) await sleep(200);
    if (!document.querySelector('.slPanel-market')) return false;
    const tab = [...document.querySelectorAll('.slPanel-market .slTab')]
      .find(e => (e.textContent || '').trim().toLowerCase() === 'câmbio');
    if (tab) tab.click();
    await sleep(900);
    return !!document.querySelector('.cbForm');
  }
  function estadoSelecionado(el) {
    if (!el) return null;
    for (const attr of ['aria-pressed', 'aria-selected']) {
      const v = el.getAttribute(attr);
      if (v === 'true') return true;
      if (v === 'false') return false;
    }
    const classes = [...el.classList];
    if (['on', 'active', 'selected', 'is-active', 'is-selected'].some(c => classes.includes(c))) return true;
    if (['on', 'active', 'selected', 'is-active', 'is-selected'].some(c => classes.some(x => x.startsWith(c + '-')))) return false;
    return null;
  }
  async function fecharMercado() {
    const m = document.querySelector('.slPanel-market');
    if (!m) return true;
    const fechar = m.querySelector('.slWinClose') || document.querySelector('.slWinClose');
    if (!fechar) return false;
    try { fechar.click(); } catch (e) { return false; }
    const t0 = Date.now();
    while (document.querySelector('.slPanel-market') && Date.now() - t0 < 3000) await sleep(150);
    return !document.querySelector('.slPanel-market');
  }
  async function ladoVender() {
    const btn = [...document.querySelectorAll('.cbLadoBt')]
      .find(b => /vender diamantes/i.test(b.textContent || ''));
    if (!btn) return false;
    if (estadoSelecionado(btn) !== true) { btn.click(); await sleep(250); }
    return estadoSelecionado(btn) === true;
  }
  async function oferecerDiamante() {
    const btn = [...document.querySelectorAll('.cbForm .mkSegBt')]
      .find(b => /^diamante$/i.test((b.textContent || '').trim()));
    if (!btn) return false;
    if (estadoSelecionado(btn) !== true) { btn.click(); await sleep(250); }
    return estadoSelecionado(btn) === true;
  }
  function form() { return document.querySelector('.cbForm'); }
  function inputQuantia() {
    const f = form(); if (!f) return null;
    const ins = [...f.querySelectorAll('input')];
    return ins[0] || null;
  }
  function inputEuQuero() {
    const f = form(); if (!f) return null;
    const ins = [...f.querySelectorAll('input')];
    return ins[1] || null;
  }
  function btnAnunciar() {
    const f = form(); if (!f) return null;
    return f.querySelector('.cbAnunciar');
  }
  function lerSaldoDiamante() {
    const f = form(); if (!f) return null;
    for (const s of f.querySelectorAll('small')) {
      const m = (s.textContent || '').match(/você tem\s*([\d.]+)/i);
      if (m) return parseInt(m[1].replace(/\./g, ''), 10);
    }
    return null;
  }
  function lerMotivo() {
    const f = form(); if (!f) return '';
    const m = f.querySelector('.cbMotivo');
    return m ? (m.textContent || '').trim() : '';
  }
  function valorInteiro(el) {
    if (!el) return NaN;
    return parseInt(String(el.value || '').replace(/[^\d-]/g, ''), 10);
  }

  // ---------- prévia ----------
  function calcular() {
    const perOffer = Number(coDiam.value);
    const offers = Number(coOffers.value);
    const goldPorDiamante = Number(coGold.value);
    if (coDiam.value === '' || coOffers.value === '' || coGold.value === '' ||
        !Number.isSafeInteger(perOffer) || !Number.isSafeInteger(offers) || !Number.isSafeInteger(goldPorDiamante) ||
        perOffer <= 0 || offers <= 0 || goldPorDiamante <= 0) {
      coPreview.textContent = 'Informe diamantes por oferta, quantidade de ofertas e gold por diamante (números inteiros positivos).';
      coStart.disabled = true;
      return null;
    }
    if (offers > MAX_OFFERS_PER_BATCH) {
      coPreview.textContent = 'O lote passou do limite de segurança de ' + MAX_OFFERS_PER_BATCH + ' ofertas. Divida em lotes menores.';
      coStart.disabled = true;
      return null;
    }
    const totalD = perOffer * offers;
    const goldPerOffer = perOffer * goldPorDiamante;
    const totalG = totalD * goldPorDiamante;
    if (!Number.isSafeInteger(totalD) || !Number.isSafeInteger(goldPerOffer) || !Number.isSafeInteger(totalG)) {
      coPreview.textContent = 'Os totais ultrapassam o limite numérico seguro. Reduza as quantidades ou o gold por diamante.';
      coStart.disabled = true;
      return null;
    }
    coPreview.innerHTML =
      'Cada oferta: <b>' + perOffer.toLocaleString('pt-BR') + ' DD</b> por <b>' + goldPerOffer.toLocaleString('pt-BR') + ' gold</b> (' + goldPorDiamante.toLocaleString('pt-BR') + '/DD)<br>' +
      'Total: <b>' + offers.toLocaleString('pt-BR') + ' oferta(s)</b> · <b>' + totalD.toLocaleString('pt-BR') + ' DD</b> · <b>' + totalG.toLocaleString('pt-BR') + ' gold</b>';
    coStart.disabled = false;
    return { perOffer, offers, totalD, totalG, goldPorDiamante, goldPerOffer, n: offers };
  }

  coDiam.addEventListener('input', calcular);
  coOffers.addEventListener('input', calcular);
  coGold.addEventListener('input', calcular);
  $('coPreviewBtn').onclick = calcular;

  // ---------- execução ----------
  async function esperarConfirmacao(chunkD, saldoAntes) {
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      if (state.stopped) return false;
      await sleep(400);
      const f = form();
      if (!f) return false;
      const btn = f.querySelector('.cbAnunciar');
      const qIn = inputQuantia();
      const wIn = inputEuQuero();
      const saldo = lerSaldoDiamante();
      const btnDesabilitado = !btn || btn.disabled;
      const camposLimpos = (qIn && (qIn.value === '' || qIn.value === '0')) &&
                          (wIn && (wIn.value === '' || wIn.value === '0'));
      const saldoCaiu = (saldoAntes !== null && saldo !== null && saldo <= saldoAntes - chunkD);
      if (btnDesabilitado && (camposLimpos || saldoCaiu)) return true;
    }
    return false;
  }

  async function criarOferta(chunk) {
    if (!form()) { log('formulário do Câmbio não encontrado', 'err'); return false; }
    if (state.stopped) return false;
    // lado
    if (!await ladoVender()) { log('não consegui confirmar o lado "Vender diamantes"; abortando sem anunciar', 'err'); return false; }
    await sleep(350);
    if (state.stopped) return false;
    // moeda oferecida
    if (!await oferecerDiamante()) { log('não consegui confirmar "Diamante" como moeda oferecida; abortando sem anunciar', 'err'); return false; }
    await sleep(350);
    if (state.stopped) return false;
    if (!form()) { log('formulário sumiu ao preparar', 'err'); return false; }

    // saldo
    const saldo = lerSaldoDiamante();
    if (saldo === null) { log('não consegui ler o saldo de diamantes', 'err'); return false; }
    if (saldo < chunk.d) {
      log('diamantes insuficientes: tem ' + saldo + ', precisa ' + chunk.d, 'err');
      return false;
    }

    // preenche
    const qIn = inputQuantia();
    const wIn = inputEuQuero();
    if (!qIn || !wIn) { log('campos de entrada não encontrados', 'err'); return false; }
    qIn.value = String(chunk.d);
    qIn.dispatchEvent(new Event('input', { bubbles: true }));
    qIn.dispatchEvent(new Event('change', { bubbles: true }));
    wIn.value = String(chunk.g);
    wIn.dispatchEvent(new Event('input', { bubbles: true }));
    wIn.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(600);
    if (state.stopped) return false;

    // confere campos
    if (valorInteiro(qIn) !== chunk.d) {
      log('campo "Quantia" não refletiu ' + chunk.d + ' (mostra ' + qIn.value + ')', 'err');
      return false;
    }
    if (valorInteiro(wIn) !== chunk.g) {
      log('campo "Eu quero" não refletiu ' + chunk.g + ' (mostra ' + wIn.value + ')', 'err');
      return false;
    }
    const btn = btnAnunciar();
    if (!btn || btn.disabled) {
      log('botão "Anunciar câmbio" desabilitado: ' + (lerMotivo() || 'motivo desconhecido'), 'err');
      return false;
    }

    const saldoAntes = lerSaldoDiamante();
    // reconfere saldo e campos imediatamente antes de confirmar
    if (saldoAntes === null || saldoAntes < chunk.d) {
      log('saldo de diamantes insuficiente antes de confirmar (' + saldoAntes + ' < ' + chunk.d + ')', 'err');
      return false;
    }
    if (valorInteiro(qIn) !== chunk.d || valorInteiro(wIn) !== chunk.g) {
      log('campos mudaram antes da confirmação — abortando para evitar duplicata', 'err');
      return false;
    }
    const ladoAtual = [...document.querySelectorAll('.cbLadoBt')].find(b => /vender diamantes/i.test(b.textContent || ''));
    const moedaAtual = [...document.querySelectorAll('.cbForm .mkSegBt')].find(b => /^diamante$/i.test((b.textContent || '').trim()));
    if (estadoSelecionado(ladoAtual) !== true || estadoSelecionado(moedaAtual) !== true) {
      log('lado ou moeda oferecida mudou antes da confirmação — abortando', 'err');
      return false;
    }
    if (state.stopped) return false;
    btn.click();
    log('confirmado: clicou em "Anunciar câmbio" (' + chunk.d + ' diamantes → ' + chunk.g + ' gold)');

    const ok = await esperarConfirmacao(chunk.d, saldoAntes);
    if (!ok) {
      log('não foi possível confirmar a criação da oferta (parando para evitar duplicata)', 'err');
      return false;
    }
    log('oferta criada e confirmada: ' + chunk.d + ' diamantes → ' + chunk.g + ' gold', 'ok');
    return true;
  }

  async function run() {
    if (state.running) { toast('O lote já está rodando.'); return; }
    if (window.__cambioSyncBusy) { toast('A sincronização está usando o Mercado. Aguarde terminar.'); return; }
    const calc = calcular();
    if (!calc) { toast('Preencha diamantes e gold válidos.'); return; }

    state.running = true;
    window.__cambioOfertaRunning = true;
    state.stopped = false;
    coStart.disabled = true;
    coStop.disabled = false;
      coDiam.disabled = coOffers.disabled = coGold.disabled = true;
    let feitas = 0;
    try {
      setStatus('abrindo Câmbio…');
      log('lote iniciado: ' + calc.n + ' oferta(s) de ' + calc.perOffer + ' DD · ' + calc.goldPorDiamante + ' gold/DD · ' + calc.goldPerOffer + ' gold por oferta · total ' + calc.totalD + ' DD / ' + calc.totalG + ' gold');

      const abriu = await abrirCambio();
      if (!abriu) { log('não consegui abrir o Mercado → Câmbio', 'err'); return; }
      if (state.stopped) { log('parado pelo usuário antes de anunciar', 'err'); return; }
      if (!await ladoVender() || !await oferecerDiamante()) {
        log('não consegui confirmar o lado e a moeda da oferta; nenhum anúncio foi enviado', 'err');
        return;
      }
      const saldoInicial = lerSaldoDiamante();
      if (saldoInicial === null) { log('não consegui ler o saldo; nenhum anúncio foi enviado', 'err'); return; }
      if (saldoInicial < calc.totalD) {
        log('saldo insuficiente para o lote inteiro: tem ' + saldoInicial + ', precisa ' + calc.totalD + ' diamantes; nenhum anúncio foi enviado', 'err');
        return;
      }

      for (let i = 0; i < calc.n; i++) {
        if (state.stopped) { log('parado pelo usuário', 'err'); break; }
        if (!document.querySelector('.cbForm')) { log('formulário do Câmbio sumiu da tela — parando', 'err'); break; }
        const chunk = { d: calc.perOffer, g: calc.goldPerOffer };
        log('--- oferta ' + (i + 1) + '/' + calc.n + ': ' + chunk.d + ' DD → ' + chunk.g + ' gold ---');
        setStatus('oferta ' + (i + 1) + '/' + calc.n);
        const ok = await criarOferta(chunk);
        if (ok) {
          feitas++;
          setStatus('feitas ' + feitas + '/' + calc.n);
        } else {
          if (state.stopped) { log('parado; confira no jogo se a oferta atual foi criada antes de iniciar outro lote', 'err'); break; }
          log('interrompido na oferta ' + (i + 1) + ' — sem repetir para evitar duplicata', 'err');
          break;
        }
        await sleep(1500);
      }

      if (feitas === calc.n) {
        log('lote concluído: ' + feitas + ' oferta(s) criada(s)', 'ok');
      }
    } catch (e) {
      log('erro inesperado; lote interrompido: ' + (e && e.message ? e.message : String(e)), 'err');
    } finally {
      let fechado = false;
      try { fechado = await fecharMercado(); } catch (e) { }
      if (!fechado) log('aviso: Mercado/Câmbio ficou aberto', 'err');

      state.running = false;
      window.__cambioOfertaRunning = false;
      state.stopped = false;
      coDiam.disabled = coOffers.disabled = coGold.disabled = false;
      coStop.disabled = true;
      coStart.disabled = !calcular();
      setStatus('pausado');
    }
  }

  $('coStart').onclick = () => { run(); };
  $('coStop').onclick = () => {
    if (!state.running) { toast('O lote não está rodando.'); return; }
    state.stopped = true;
    log('parada solicitada…');
  };
  $('coPreviewBtn').onclick = calcular;

  // estado inicial
  coStop.disabled = true;
  calcular();
  setStatus('pausado');

  // boot: não inicia nada automaticamente
  log('pronto — preencha e clique em "Iniciar lote"');

  // ---------- CSS ----------
  const style = document.createElement('style');
  style.textContent = `
    #coPainel{position:relative;width:100%;z-index:auto;background:transparent;border:0;border-radius:0;box-shadow:none;color:#e6e8f0;overflow:visible;font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    #coPainel.coLogMin .coLog{display:none}
    .coLogHeader{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0 5px;font-size:11px;color:#9aa3b8}
    .coLogHeader button{background:#2a2c38;border:1px solid #3a3d4d;color:#c8ccdb;border-radius:5px;padding:3px 7px;font-size:10px;cursor:pointer}
    #coTopo .coLogo{font-weight:700;font-size:12.5px;letter-spacing:.3px;flex:1}
    #coTopo .coLogo b{color:#fbbf24}
    #coTopo button{background:#22242f;border:1px solid #33364a;color:#c8ccdb;border-radius:6px;width:22px;height:22px;cursor:pointer;line-height:1}
    #coCorpo{padding:11px}
    .coHint{font-size:11px;color:#8b93a7;background:#13141c;border:1px solid #23252f;border-radius:8px;padding:7px 9px;margin-bottom:10px}
    .coHint b{color:#fde68a}
    .coSec{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:7px;margin-bottom:9px}
    .coSec label{font-size:10.5px;color:#9aa3b8;display:flex;flex-direction:column;gap:3px}
    .coSec input{background:#101117;border:1px solid #2f3244;color:#e6e8f0;border-radius:6px;padding:5px 7px;font-size:12px;width:100%;box-sizing:border-box}
    .coPreview{font-size:11.5px;color:#c8ccdb;background:#13141c;border:1px solid #23252f;border-radius:8px;padding:8px 10px;margin-bottom:9px;min-height:34px;line-height:1.5}
    .coPreview b{color:#fbbf24}
    .coBtns{display:flex;gap:7px;margin-bottom:9px}
    .coBtns button{flex:1;border:0;border-radius:7px;padding:8px 6px;font-size:12px;font-weight:600;cursor:pointer;transition:.15s}
    .coB2{background:#1f6feb;color:#fff}.coB2:hover{background:#388bfd}
    .coB3{background:#2a2c38;color:#c8ccdb}.coB3:hover{background:#353849}
    .coB4{background:#b45309;color:#fff}.coB4:hover{background:#d97706}
    #coStatus{font-size:11px;color:#9aa3b8;background:#13141c;border:1px solid #23252f;border-radius:7px;padding:6px 8px;margin-bottom:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #coStatus.coRodando{color:#fde68a;border-color:#b45309;background:#1c1508}
    .coLog{max-height:170px;overflow:auto;border:1px solid #23252f;border-radius:8px;background:#0f1015;padding:5px 8px;font:10.5px/1.5 ui-monospace,Consolas,monospace;color:#9aa3b8}
    .coLog div{padding:1px 0}
    .coLog .coLogOk{color:#86efac}
    .coLog .coLogErr{color:#fca5a5}
    .coVazio{padding:8px;text-align:center;color:#6b7280;font-size:11px}
    #coToast{position:fixed;right:14px;bottom:184px;z-index:100000;background:#101117;border:1px solid #fbbf24;color:#fef3c7;
      border-radius:9px;padding:9px 13px;font:12.5px system-ui,sans-serif;opacity:0;transform:translateY(8px);
      transition:.25s;pointer-events:none;max-width:340px;box-shadow:0 8px 24px rgba(0,0,0,.5)}
    #coToast.coToastOn{opacity:1;transform:none}`;
  document.head.appendChild(style);
})();

