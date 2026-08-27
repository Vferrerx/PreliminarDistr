/* ============================================================================
 * APP - Control Tower / Gerador de Programacao
 * UI + orquestracao. Depende de: window.ExcelJS, funcoes globais de core-logic.js,
 * e das constantes PDFJS_MAIN_B64 / PDFJS_WORKER_B64 / MODELO_XLSX_B64 (embutidas
 * pelo build.js).
 * ==========================================================================*/

(function () {
  'use strict';

  /* ------------------------------ estado ------------------------------- */
  const state = {
    pdfFile: null,
    modelFile: null, // ArrayBuffer custom, se o usuario enviar um modelo proprio
    modelFileName: null,
    pdfjsLib: null,
    rawExtraction: null,
    normalized: null,
    autoReturns: [],
    intelHistorico: [],
    generated: null // { workbook, fileName, blob }
  };

  /* ------------------------------ helpers ------------------------------- */
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }
  function fmtDateBR(d) {
    if (!(d instanceof Date)) return '';
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  function fmtHora(h) {
    if (!h) return '';
    return String(h.h).padStart(2, '0') + ':' + String(h.m).padStart(2, '0');
  }
  function b64ToUint8Array(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function b64ToUtf8Text(b64) {
    const bytes = b64ToUint8Array(b64);
    return new TextDecoder('utf-8').decode(bytes);
  }
  function setStep(stepEl, status) {
    stepEl.classList.remove('step-pending', 'step-active', 'step-done');
    stepEl.classList.add('step-' + status);
  }

  /* ------------------------------ abas (tabs) ----------------------------- */
  const pageProcessar = $('#pageProcessar');
  const pageBase = $('#pageBase');
  const pageIntel = $('#pageIntel');
  const tabProcessarBtn = $('#tabProcessarBtn');
  const tabBaseBtn = $('#tabBaseBtn');
  const tabIntelBtn = $('#tabIntelBtn');
  function switchTab(tab) {
    pageProcessar.hidden = tab !== 'processar';
    pageBase.hidden = tab !== 'base';
    pageIntel.hidden = tab !== 'intel';
    tabProcessarBtn.classList.toggle('active', tab === 'processar');
    tabBaseBtn.classList.toggle('active', tab === 'base');
    tabIntelBtn.classList.toggle('active', tab === 'intel');
    if (tab === 'base') refreshBaseTable().catch(err => console.error(err));
    if (tab === 'intel') refreshIntelPage().catch(err => console.error(err));
  }
  tabProcessarBtn.addEventListener('click', () => switchTab('processar'));
  tabBaseBtn.addEventListener('click', () => switchTab('base'));
  tabIntelBtn.addEventListener('click', () => switchTab('intel'));

  /* ----------------------- carregamento das libs (offline) -------------- */
  let libsReadyPromise = null;
  function ensureLibsLoaded() {
    if (libsReadyPromise) return libsReadyPromise;
    libsReadyPromise = (async () => {
      // pdf.js (ESM) carregado como arquivo real - requer servidor http(s).
      // O especificador do import() e relativo a ESTE arquivo (js/app.js),
      // mas o workerSrc e resolvido pelo navegador relativo ao documento
      // (index.html na raiz do site), entao os caminhos sao diferentes.
      const pdfjsLib = await import('../vendor/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';
      state.pdfjsLib = pdfjsLib;
      return pdfjsLib;
    })();
    return libsReadyPromise;
  }

  /* ------------------------------ upload PDF ----------------------------- */
  const dropZone = $('#dropZone');
  const pdfInput = $('#pdfInput');
  const fileInfo = $('#fileInfo');
  const fileNameEl = $('#fileName');
  const fileSizeEl = $('#fileSize');
  const removeFileBtn = $('#removeFileBtn');
  const btnProcessar = $('#btnProcessar');

  function onPdfSelected(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      showToast('Selecione um arquivo PDF valido (.pdf).', 'error');
      return;
    }
    state.pdfFile = file;
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = fmtBytes(file.size);
    fileInfo.hidden = false;
    dropZone.hidden = true;
    btnProcessar.disabled = false;
    resetProcessingUI();
  }

  dropZone.addEventListener('click', () => pdfInput.click());
  dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') pdfInput.click(); });
  pdfInput.addEventListener('change', e => onPdfSelected(e.target.files[0]));
  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove('dragover'); });
  });
  dropZone.addEventListener('drop', e => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    onPdfSelected(file);
  });
  removeFileBtn.addEventListener('click', () => {
    state.pdfFile = null;
    pdfInput.value = '';
    fileInfo.hidden = true;
    dropZone.hidden = false;
    btnProcessar.disabled = true;
    resetProcessingUI();
  });

  /* ------------------------------ upload modelo (opcional) --------------- */
  const modelInput = $('#modelInput');
  const modelFileNameEl = $('#modelFileName');
  const modelStatusEl = $('#modelStatus');
  modelInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    state.modelFile = await file.arrayBuffer();
    state.modelFileName = file.name;
    modelFileNameEl.textContent = file.name;
    modelStatusEl.textContent = 'Modelo personalizado carregado.';
    modelStatusEl.classList.add('ok');
  });
  $('#resetModelBtn').addEventListener('click', () => {
    state.modelFile = null;
    state.modelFileName = null;
    modelInput.value = '';
    modelFileNameEl.textContent = 'Nenhum (usando modelo padrao embutido)';
    modelStatusEl.textContent = '';
    modelStatusEl.classList.remove('ok');
  });

  /* ------------------------- reconhecimento de ORIGEM ---------------------- */
  // O mapeamento por prefixo NAO e mais configuravel manualmente (regra
  // definitiva): e aprendido automaticamente a partir da Base de CDs a cada
  // processamento (ver buildPrefixLookup em core-logic.js). Resta apenas o
  // valor de ultimo recurso, usado somente quando nao ha nenhuma evidencia.
  const origemFallbackInput = $('#origemFallback');

  /* ------------------------------ toasts --------------------------------- */
  function showToast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = msg;
    $('#toastContainer').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 6000);
  }

  /* ------------------------------ processamento --------------------------- */
  const progressSection = $('#progressSection');
  const progressBar = $('#progressBar');
  const progressStatus = $('#progressStatus');
  const progressDetail = $('#progressDetail');
  const summarySection = $('#summarySection');
  const issuesSection = $('#issuesSection');
  const autoReturnSection = $('#autoReturnSection');
  const btnGerar = $('#btnGerar');
  const genSection = $('#genSection');

  function resetProcessingUI() {
    progressSection.hidden = true;
    summarySection.hidden = true;
    issuesSection.hidden = true;
    autoReturnSection.hidden = true;
    genSection.hidden = true;
    btnGerar.disabled = true;
    state.rawExtraction = null;
    state.normalized = null;
    state.autoReturns = [];
    state.generated = null;
  }

  btnProcessar.addEventListener('click', async () => {
    if (!state.pdfFile) return;
    btnProcessar.disabled = true;
    progressSection.hidden = false;
    summarySection.hidden = true;
    issuesSection.hidden = true;
    genSection.hidden = true;
    progressBar.style.width = '2%';
    progressStatus.textContent = 'Carregando bibliotecas de leitura de PDF...';
    progressDetail.textContent = '';

    try {
      const pdfjsLib = await ensureLibsLoaded();
      progressStatus.textContent = 'Abrindo o arquivo PDF...';
      const buf = await state.pdfFile.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

      progressStatus.textContent = 'Processando PDF...';
      const origemFallback = (origemFallbackInput.value || 'CDFT').trim().toUpperCase();

      const raw = await extractPdfRecords(pdfDoc, {}, (p) => {
        const pct = 5 + Math.round((p.page / p.totalPages) * 70);
        progressBar.style.width = pct + '%';
        progressDetail.textContent = `Pagina ${p.page} de ${p.totalPages} — Registros encontrados: ${p.recordsSoFar}`;
      });

      progressStatus.textContent = 'Consultando Base de CDs...';
      const nomenclaturas = await CTDB.getAllNomenclaturas();
      const nomenclatureMap = await CTDB.buildNomenclatureLookup();
      const prefixLookup = buildPrefixLookup(nomenclaturas);
      const vehicleTypeRules = await CTDB.getAllVehicleRules();

      progressStatus.textContent = 'Analisando dados...';
      progressBar.style.width = '80%';
      await new Promise(r => setTimeout(r, 50));

      const norm = normalizeAndValidate(raw, { origemFallback, nomenclatureMap, prefixLookup, vehicleTypeRules });

      progressStatus.textContent = 'Consultando histórico de retorno...';
      progressBar.style.width = '92%';
      const historico = await CTDB.getAllHistorico();
      const autoReturns = buildAutoReturnRecords(norm.records, historico, {});

      progressBar.style.width = '100%';
      progressStatus.textContent = 'Concluido.';

      state.rawExtraction = raw;
      state.normalized = norm;
      state.autoReturns = autoReturns;

      renderSummary(pdfDoc.numPages, raw, norm, autoReturns);
      renderIssues(norm);
      renderAutoReturns(autoReturns);

      // alimenta o historico com os dados explicitos deste PDF (aprendizado continuo)
      const validRecords = norm.records.filter(r => r.valido);
      const pdfHistorico = buildHistoricoFromPdfRecords(validRecords, { origemArquivo: state.pdfFile.name, origemRegistro: 'pdf' });
      if (pdfHistorico.length) await CTDB.addHistoricoBulk(pdfHistorico);

      btnGerar.disabled = validRecords.length === 0;
      genSection.hidden = false;
      showToast('PDF processado com sucesso.', 'success');
    } catch (err) {
      console.error(err);
      progressStatus.textContent = 'Erro ao processar o PDF';
      progressDetail.textContent = err && err.message ? err.message : String(err);
      progressBar.style.width = '100%';
      progressBar.classList.add('error');
      showToast('Erro ao processar o PDF: ' + (err && err.message ? err.message : String(err)), 'error');
    } finally {
      btnProcessar.disabled = false;
    }
  });

  function renderSummary(numPages, raw, norm, autoReturns) {
    const total = norm.records.length;
    const validos = norm.records.filter(r => r.valido).length;
    const invalidos = total - validos;
    $('#sumPages').textContent = numPages;
    $('#sumRecords').textContent = total;
    $('#sumValid').textContent = validos;
    $('#sumInvalid').textContent = invalidos;
    $('#sumWarnings').textContent = norm.warnings.length;
    $('#sumAutoReturns').textContent = (autoReturns || []).length;
    summarySection.hidden = false;
    summarySection.classList.toggle('has-problems', invalidos > 0);
  }

  function renderAutoReturns(autoReturns) {
    const box = $('#autoReturnList');
    box.innerHTML = '';
    if (!autoReturns || autoReturns.length === 0) {
      autoReturnSection.hidden = true;
      return;
    }
    autoReturnSection.hidden = false;
    autoReturns.forEach(ar => {
      const div = document.createElement('div');
      div.className = 'issue issue-info';
      const dataStr = fmtDateBR(ar.dataEntrega);
      const horaStr = fmtHora(ar.horaEntrega);
      div.innerHTML = `<span class="issue-badge">RETORNO</span><span><strong>${ar.rota}</strong> → ${ar.loja} em ${dataStr} ${horaStr} <em>(${ar._auto.motivo})</em></span>`;
      box.appendChild(div);
    });
  }

  function renderIssues(norm) {
    const box = $('#issuesList');
    box.innerHTML = '';
    const items = [];
    norm.errors.forEach(e => items.push({ level: 'error', text: `Rota ${e.rota || '?'} / Loja ${e.loja || '?'} (pag. ${e.page}): ${e.motivos.join('; ')}` }));

    const grouped = {};
    norm.warnings.forEach(w => {
      const key = w.type;
      grouped[key] = grouped[key] || [];
      grouped[key].push(w);
    });
    const labels = {
      carregamento_ausente: 'Hora/dia de carregamento nao identificado no bloco da rota (usada a data de faturamento como base)',
      inconsistencia_caixas: 'Soma das categorias (congelado+resfriado+seco) diverge do total informado',
      duplicado: 'Possivel registro duplicado (mesma rota + loja + data de faturamento)',
      linha_incompleta: 'Linha da tabela do PDF com menos valores numericos que o esperado',
      origem_nao_cadastrada: 'Rota nao encontrada na Base de CDs (nem por rota exata, nem por prefixo aprendido) — origem definida pelo valor padrao (importe a programacao do CD correto na aba "Base de CDs" para corrigir)',
      origem_em_conflito: 'Rota marcada como conflito na Base de CDs — resolva em "Base de CDs" para garantir a origem correta',
      conflito_prefixo: 'CONFLITO DE PREFIXO: o prefixo da rota tem historico ambiguo entre mais de um CD — o sistema nao escolheu automaticamente, confira o cadastro na Base de CDs'
    };
    Object.entries(grouped).forEach(([type, arr]) => {
      if (type === 'conflito_prefixo') {
        const seen = new Set();
        arr.forEach(w => {
          if (seen.has(w.detail)) return;
          seen.add(w.detail);
          items.push({ level: 'warning', text: w.detail, detail: `rotas afetadas: ${arr.filter(x => x.detail === w.detail).map(x => x.rota).join(', ')}` });
        });
        return;
      }
      items.push({ level: 'warning', text: `${labels[type] || type}: ${arr.length} ocorrencia(s)`, detail: arr.slice(0, 8).map(w => `${w.rota || ''}/${w.loja || ''}`).join(', ') + (arr.length > 8 ? '...' : '') });
    });

    // Auditoria: rotas cujo CD foi identificado por prefixo aprendido (secao 17 do pedido)
    const viaPrefixo = norm.records.filter(r => r.valido && (r.origemFonte === 'prefixo' || r.origemFonte === 'prefixo_geral'));
    if (viaPrefixo.length > 0) {
      const porPrefixo = {};
      viaPrefixo.forEach(r => {
        const k = r.origemPrefixo || '?';
        porPrefixo[k] = porPrefixo[k] || { origem: r.origem, confiancaPct: r.origemConfiancaPct, ocorrencias: r.origemOcorrencias, rotas: [] };
        porPrefixo[k].rotas.push(r.rota);
      });
      Object.entries(porPrefixo).forEach(([prefixo, info]) => {
        items.push({
          level: 'info',
          text: `CD identificado por prefixo "${prefixo}" → ${info.origem} (confiança ${info.confiancaPct}%, base de ${info.ocorrencias} ocorrência(s) histórica(s))`,
          detail: `rotas: ${info.rotas.join(', ')}`
        });
      });
    }

    if (items.length === 0) {
      issuesSection.hidden = true;
      return;
    }
    issuesSection.hidden = false;
    items.forEach(it => {
      const div = document.createElement('div');
      div.className = 'issue issue-' + it.level;
      const badgeText = it.level === 'error' ? 'ERRO' : (it.level === 'info' ? 'INFO' : 'ATENCAO');
      div.innerHTML = `<span class="issue-badge">${badgeText}</span><span>${it.text}${it.detail ? ' <em>(' + it.detail + ')</em>' : ''}</span>`;
      box.appendChild(div);
    });
  }

  /* ------------------------------ geracao do excel ------------------------ */
  const downloadSection = $('#downloadSection');
  const downloadBtn = $('#downloadBtn');
  const genStatus = $('#genStatus');

  btnGerar.addEventListener('click', async () => {
    if (!state.normalized) return;
    btnGerar.disabled = true;
    genStatus.hidden = false;
    genStatus.textContent = 'Gerando Excel...';
    downloadSection.hidden = true;

    try {
      let modelBuffer = state.modelFile;
      if (!modelBuffer) {
        const resp = await fetch('./data/modelo-excel.xlsx');
        if (!resp.ok) throw new Error('Nao foi possivel carregar o modelo padrao (data/modelo-excel.xlsx). Sirva os arquivos por http(s) e verifique se a pasta "data" foi enviada.');
        modelBuffer = await resp.arrayBuffer();
      }
      const validRecords = state.normalized.records.filter(r => r.valido).concat(state.autoReturns || []);
      const result = await buildExcelWorkbook(modelBuffer, validRecords, {});
      const arrayBuffer = await result.workbook.xlsx.writeBuffer();
      const blob = new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const fileName = generateFileName(validRecords);

      state.generated = { blob, fileName };
      genStatus.textContent = '✓ Excel gerado com sucesso';
      genStatus.classList.add('ok');
      downloadSection.hidden = false;
      downloadBtn.onclick = () => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
      $('#downloadFileName').textContent = fileName;
      showToast('Excel gerado com sucesso.', 'success');
    } catch (err) {
      console.error(err);
      genStatus.textContent = 'Erro ao gerar o Excel: ' + (err && err.message ? err.message : String(err));
      genStatus.classList.add('error');
      showToast('Erro ao gerar o Excel.', 'error');
    } finally {
      btnGerar.disabled = false;
    }
  });

  /* ------------------------------ painel avancado -------------------------- */
  const advToggle = $('#advToggle');
  const advPanel = $('#advPanel');
  advToggle.addEventListener('click', () => {
    const open = advPanel.hidden;
    advPanel.hidden = !open;
    advToggle.setAttribute('aria-expanded', String(open));
    advToggle.textContent = open ? 'Ocultar configuracoes avancadas ▲' : 'Configuracoes avancadas (modelo Excel, mapeamento de origem) ▼';
  });

  /* ============================================================================
   * MODAL GENERICO
   * ==========================================================================*/
  const modalOverlay = $('#modalOverlay');
  const modalTitle = $('#modalTitle');
  const modalBody = $('#modalBody');
  const modalFooter = $('#modalFooter');
  const modalCloseBtn = $('#modalCloseBtn');

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function openModal(opts) {
    modalTitle.textContent = opts.title || '';
    modalBody.innerHTML = '';
    if (typeof opts.bodyEl === 'string') modalBody.innerHTML = opts.bodyEl;
    else if (opts.bodyEl) modalBody.appendChild(opts.bodyEl);

    modalFooter.innerHTML = '';
    (opts.footerButtons || []).forEach(btnCfg => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (btnCfg.className || 'btn-secondary');
      b.textContent = btnCfg.label;
      b.addEventListener('click', async () => {
        if (!btnCfg.onClick) { closeModal(); return; }
        b.disabled = true;
        try {
          const result = await btnCfg.onClick();
          if (result !== false) closeModal();
        } finally {
          b.disabled = false;
        }
      });
      modalFooter.appendChild(b);
    });

    modalOverlay.hidden = false;
  }
  function closeModal() {
    modalOverlay.hidden = true;
    modalBody.innerHTML = '';
    modalFooter.innerHTML = '';
  }
  modalCloseBtn.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

  function confirmModal(title, bodyHtml, confirmLabel, onConfirm) {
    openModal({
      title,
      bodyEl: `<div class="confirm-body">${bodyHtml}</div>`,
      footerButtons: [
        { label: 'Cancelar', className: 'btn-secondary' },
        { label: confirmLabel || 'Confirmar', className: 'btn-danger', onClick: onConfirm }
      ]
    });
  }

  /* ============================================================================
   * BASE DE CDs — estado, formatacao e renderizacao
   * ==========================================================================*/
  state.baseCds = [];
  state.baseNomenclaturas = [];

  function fmtDateTimeBR(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  }
  function fmtDateBRFromIso(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  const baseCdCount = $('#baseCdCount');
  const baseNomenCount = $('#baseNomenCount');
  const baseConflictCount = $('#baseConflictCount');
  const baseLastUpdate = $('#baseLastUpdate');
  const baseCdFilter = $('#baseCdFilter');
  const baseSearch = $('#baseSearch');
  const baseTableBody = $('#baseTableBody');
  const baseTableWrap = $('.base-table-wrap');
  const baseEmptyState = $('#baseEmptyState');

  async function refreshBaseTable() {
    const [cds, nomenclaturas] = await Promise.all([CTDB.getAllCDs(), CTDB.getAllNomenclaturas()]);
    state.baseCds = cds;
    state.baseNomenclaturas = nomenclaturas;
    renderCdFilterOptions();
    renderBaseIndicators();
    renderBaseTableRows();
  }

  function renderCdFilterOptions() {
    const prevValue = baseCdFilter.value;
    baseCdFilter.innerHTML = '<option value="">Todos os CDs</option>';
    state.baseCds.slice().sort((a, b) => a.nome.localeCompare(b.nome)).forEach(cd => {
      const opt = document.createElement('option');
      opt.value = String(cd.id);
      opt.textContent = `${cd.nome} (${cd.codigo})`;
      baseCdFilter.appendChild(opt);
    });
    if ([...baseCdFilter.options].some(o => o.value === prevValue)) baseCdFilter.value = prevValue;
  }

  function renderBaseIndicators() {
    baseCdCount.textContent = state.baseCds.length;
    baseNomenCount.textContent = state.baseNomenclaturas.length;
    baseConflictCount.textContent = state.baseNomenclaturas.filter(n => n.status === 'conflito').length;
    let lastTs = null;
    state.baseCds.concat(state.baseNomenclaturas).forEach(r => {
      if (r.ultimaAtualizacao && (!lastTs || r.ultimaAtualizacao > lastTs)) lastTs = r.ultimaAtualizacao;
    });
    baseLastUpdate.textContent = lastTs ? fmtDateTimeBR(lastTs) : '—';
  }

  function renderBaseTableRows() {
    const cdById = new Map(state.baseCds.map(c => [c.id, c]));
    const search = (baseSearch.value || '').trim().toUpperCase();
    const cdFilterVal = baseCdFilter.value ? parseInt(baseCdFilter.value, 10) : null;

    let rows = state.baseNomenclaturas.slice();
    if (cdFilterVal != null) rows = rows.filter(r => r.cdId === cdFilterVal);
    if (search) {
      rows = rows.filter(r => {
        const cd = cdById.get(r.cdId);
        const hay = [r.nomenclatura, r.cdNome, r.cdCodigo, cd && cd.nome, cd && cd.codigo].filter(Boolean).join(' ').toUpperCase();
        return hay.includes(search);
      });
    }
    rows.sort((a, b) => a.nomenclatura.localeCompare(b.nomenclatura));

    baseTableBody.innerHTML = '';
    rows.forEach(r => {
      const cd = cdById.get(r.cdId);
      const cdLabel = cd ? `${cd.nome} (${cd.codigo})` : (r.cdNome ? `${r.cdNome} (${r.cdCodigo})` : (r.cdCodigo || '—'));
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="nomen-code">${escapeHtml(r.nomenclatura)}</td>
        <td><span class="cd-badge">${escapeHtml(cdLabel)}</span></td>
        <td><span class="status-badge ${r.status === 'conflito' ? 'status-conflito' : 'status-ok'}">${r.status === 'conflito' ? 'CONFLITO' : 'OK'}</span></td>
        <td>${fmtDateBRFromIso(r.dataCadastro)}</td>
        <td>${fmtDateTimeBR(r.ultimaAtualizacao)}</td>
        <td class="base-row-actions">
          <button type="button" class="btn-link" data-action="edit" data-nomen="${escapeHtml(r.nomenclatura)}">editar</button>
          <button type="button" class="btn-link" data-action="delete" data-nomen="${escapeHtml(r.nomenclatura)}">excluir</button>
        </td>`;
      baseTableBody.appendChild(tr);
    });

    baseTableWrap.classList.toggle('is-empty', state.baseNomenclaturas.length === 0);
    baseEmptyState.textContent = rows.length === 0 && state.baseNomenclaturas.length > 0
      ? 'Nenhuma nomenclatura encontrada para os filtros aplicados.'
      : 'Nenhuma nomenclatura cadastrada ainda. Clique em "Importar programação de um CD" para começar.';
    if (rows.length === 0 && state.baseNomenclaturas.length > 0) {
      baseTableWrap.classList.add('is-empty');
    }
  }

  baseSearch.addEventListener('input', renderBaseTableRows);
  baseCdFilter.addEventListener('change', renderBaseTableRows);

  baseTableBody.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const nomen = btn.dataset.nomen;
    if (btn.dataset.action === 'edit') openEditNomenModal(nomen);
    else if (btn.dataset.action === 'delete') openDeleteNomenModal(nomen);
  });

  function cdSelectOptionsHtml(selectedId) {
    return state.baseCds.map(cd => `<option value="${cd.id}" ${cd.id === selectedId ? 'selected' : ''}>${escapeHtml(cd.nome)} (${escapeHtml(cd.codigo)})</option>`).join('')
      + `<option value="__new__">+ Novo CD...</option>`;
  }

  function openEditNomenModal(nomenclatura) {
    const rec = state.baseNomenclaturas.find(n => n.nomenclatura === nomenclatura);
    if (!rec) return;
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="import-file-field"><label>Nomenclatura</label><span class="nomen-code">${escapeHtml(rec.nomenclatura)}</span></div>
      <div class="import-file-field">
        <label>CD de origem</label>
        <select class="text-input" id="editCdSelect">${cdSelectOptionsHtml(rec.cdId)}</select>
      </div>
      <div class="new-cd-fields" id="editNewCdFields">
        <input type="text" class="text-input" id="editNewCdNome" placeholder="Nome do CD" />
        <input type="text" class="text-input" id="editNewCdCodigo" placeholder="Código" maxlength="8" />
      </div>`;
    container.querySelector('#editCdSelect').addEventListener('change', e => {
      container.querySelector('#editNewCdFields').classList.toggle('show', e.target.value === '__new__');
    });
    openModal({
      title: 'Editar nomenclatura',
      bodyEl: container,
      footerButtons: [
        { label: 'Cancelar', className: 'btn-secondary' },
        {
          label: 'Salvar', className: 'btn-primary', onClick: async () => {
            const sel = container.querySelector('#editCdSelect').value;
            let cdId, cdNome, cdCodigo;
            if (sel === '__new__') {
              const nome = container.querySelector('#editNewCdNome').value.trim();
              const codigo = container.querySelector('#editNewCdCodigo').value.trim().toUpperCase();
              if (!nome || !codigo) { showToast('Preencha nome e código do novo CD.', 'error'); return false; }
              const cd = await CTDB.putCD({ nome, codigo });
              cdId = cd.id; cdNome = cd.nome; cdCodigo = cd.codigo;
            } else {
              const cd = state.baseCds.find(c => c.id === parseInt(sel, 10));
              if (!cd) { showToast('Selecione um CD válido.', 'error'); return false; }
              cdId = cd.id; cdNome = cd.nome; cdCodigo = cd.codigo;
            }
            await CTDB.putNomenclatura(Object.assign({}, rec, {
              cdId, cdNome, cdCodigo, status: 'ok', pendingCdCodigo: undefined, pendingCdNome: undefined,
              ultimaAtualizacao: new Date().toISOString()
            }));
            await refreshBaseTable();
            showToast('Nomenclatura atualizada.', 'success');
            return true;
          }
        }
      ]
    });
  }

  function openDeleteNomenModal(nomenclatura) {
    const rec = state.baseNomenclaturas.find(n => n.nomenclatura === nomenclatura);
    if (!rec) return;
    confirmModal(
      'Excluir nomenclatura',
      `Tem certeza que deseja excluir esta nomenclatura?<div class="confirm-target"><strong>${escapeHtml(rec.nomenclatura)}</strong><br>CD: ${escapeHtml(rec.cdNome || rec.cdCodigo || '—')}</div>`,
      'Excluir',
      async () => {
        await CTDB.deleteNomenclatura(nomenclatura);
        await refreshBaseTable();
        showToast('Nomenclatura excluída.', 'success');
        return true;
      }
    );
  }

  /* ------------------------- Adicionar CD manualmente ---------------------- */
  $('#btnAddCdManual').addEventListener('click', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="import-file-field"><label>Nome</label><input type="text" class="text-input" id="newCdNomeInput" placeholder="Ex: São Paulo" /></div>
      <div class="import-file-field"><label>Código</label><input type="text" class="text-input" id="newCdCodigoInput" placeholder="Ex: CDSP" maxlength="8" /></div>`;
    openModal({
      title: 'Adicionar CD',
      bodyEl: container,
      footerButtons: [
        { label: 'Cancelar', className: 'btn-secondary' },
        {
          label: 'Adicionar', className: 'btn-primary', onClick: async () => {
            const nome = container.querySelector('#newCdNomeInput').value.trim();
            const codigo = container.querySelector('#newCdCodigoInput').value.trim().toUpperCase();
            if (!nome || !codigo) { showToast('Preencha nome e código.', 'error'); return false; }
            const existing = await CTDB.getCDByCodigo(codigo);
            if (existing) { showToast(`Já existe um CD com o código "${codigo}".`, 'error'); return false; }
            await CTDB.putCD({ nome, codigo });
            await refreshBaseTable();
            showToast('CD adicionado.', 'success');
            return true;
          }
        }
      ]
    });
  });

  /* ============================================================================
   * IMPORTACAO DE PROGRAMACAO DE CD (single + multi-arquivo)
   * ==========================================================================*/
  const importCdInput = $('#importCdInput');
  $('#btnImportCd').addEventListener('click', () => importCdInput.click());

  const COMBINING_DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');
  function normalizeForMatch(s) {
    return (s || '').toString()
      .normalize('NFD').replace(COMBINING_DIACRITICS_RE, '')
      .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  }
  function suggestCdForFilename(filename, cds) {
    const norm = normalizeForMatch(filename);
    if (!norm) return null;
    for (const cd of cds) {
      const nomeNorm = normalizeForMatch(cd.nome);
      if (nomeNorm && norm.includes(nomeNorm)) return cd;
    }
    for (const cd of cds) {
      const codigoNorm = normalizeForMatch(cd.codigo);
      if (codigoNorm && norm.includes(codigoNorm)) return cd;
    }
    return null;
  }

  importCdInput.addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    importCdInput.value = '';
    if (files.length === 0) return;
    await startImportWizard(files);
  });

  async function startImportWizard(files) {
    const cds = await CTDB.getAllCDs();
    const rows = [];
    for (const file of files) {
      let wb;
      try {
        const buf = await file.arrayBuffer();
        wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
      } catch (err) {
        showToast(`Não foi possível abrir "${file.name}": arquivo Excel inválido.`, 'error');
        continue;
      }
      const ws = wb.worksheets[0];
      if (!ws || (ws.rowCount || 0) < 2) {
        showToast(`"${file.name}" não possui dados reconhecíveis.`, 'error');
        continue;
      }
      const detection = detectNomenclatureColumn(ws);
      const headerSignature = computeHeaderSignature(ws, detection.headerRow);
      const remembered = await CTDB.getMeta('colSignature:' + headerSignature);
      const columnIndex = (remembered != null) ? remembered : detection.suggestedColumn;
      const suggestedCd = suggestCdForFilename(file.name, cds);
      const historicalDetection = detectHistoricalColumns(ws);
      const hasOwnOrigemColumn = !!(historicalDetection.fieldCols && historicalDetection.fieldCols.origem);
      rows.push({
        file, ws, detection, headerSignature,
        columnIndex, headerRow: detection.headerRow,
        cdMode: suggestedCd ? 'existing' : 'new',
        cdId: suggestedCd ? suggestedCd.id : null,
        newCdNome: '', newCdCodigo: '',
        historicalDetection,
        hasOwnOrigemColumn,
        useAsHistorical: historicalDetection.isRich
      });
    }
    if (rows.length === 0) return;
    renderImportWizardModal(rows, cds);
  }

  function renderImportWizardModal(rows, cds) {
    const container = document.createElement('div');
    rows.forEach((row, idx) => {
      const div = document.createElement('div');
      div.className = 'import-file-row';

      const cdOptionsHtml = cds.map(cd => `<option value="${cd.id}" ${row.cdId === cd.id ? 'selected' : ''}>${escapeHtml(cd.nome)} (${escapeHtml(cd.codigo)})</option>`).join('');
      const candidatesHtml = row.detection.candidates.map(c =>
        `<option value="${c.col}" ${c.col === row.columnIndex ? 'selected' : ''}>${escapeHtml(c.headerText || ('Coluna ' + c.col))}${c.headerMatches ? ' ★' : ''}</option>`
      ).join('');

      const cdFieldHtml = row.hasOwnOrigemColumn
        ? `<div class="import-col-hint">Este arquivo já possui uma coluna ORIGEM — o CD de cada rota será identificado automaticamente por ela (CDs novos são criados conforme necessário).</div>`
        : `<div class="import-file-field">
             <label>CD de origem</label>
             <select class="wiz-cd-select">${cdOptionsHtml}<option value="__new__" ${row.cdMode === 'new' ? 'selected' : ''}>+ Novo CD...</option></select>
           </div>
           <div class="new-cd-fields ${row.cdMode === 'new' ? 'show' : ''}">
             <input type="text" class="text-input wiz-new-nome" placeholder="Nome do CD (ex: São Paulo)" value="${escapeHtml(row.newCdNome)}" />
             <input type="text" class="text-input wiz-new-codigo" placeholder="Código (ex: CDSP)" maxlength="8" value="${escapeHtml(row.newCdCodigo)}" />
           </div>`;

      div.innerHTML = `
        <div class="import-file-name">${escapeHtml(row.file.name)}</div>
        ${cdFieldHtml}
        <div class="import-file-field">
          <label>Coluna de rota</label>
          <select class="wiz-col-select">${candidatesHtml}</select>
        </div>
        <div class="import-col-hint ${row.detection.confidence === 'baixa' ? 'low' : ''}">
          Confiança da detecção: ${row.detection.confidence}${row.detection.confidence === 'baixa' ? ' — confirme a coluna correta acima' : ''}
        </div>
        <div class="import-file-field hist-field">
          <label class="hist-checkbox-label">
            <input type="checkbox" class="wiz-hist-checkbox" ${row.useAsHistorical ? 'checked' : ''} />
            Usar também como referência histórica (padrões de carregamento e retorno)
          </label>
        </div>
        <div class="import-col-hint ${row.historicalDetection.isRich ? '' : 'low'}">
          ${row.historicalDetection.isRich
            ? `Planilha rica: ${row.historicalDetection.matchedRequired}/6 campos reconhecidos (rota, loja, origem, data/hora carregamento, caixas) — poderá alimentar padrões de carregamento e retorno.`
            : `Planilha simples: apenas a nomenclatura será aprendida (faltam colunas como ORIGEM, DATA/HORA CARREGAMENTO para gerar padrões históricos).`}
        </div>`;
      container.appendChild(div);

      const cdSelectEl = div.querySelector('.wiz-cd-select');
      if (cdSelectEl) {
        cdSelectEl.addEventListener('change', e => {
          const v = e.target.value;
          row.cdMode = v === '__new__' ? 'new' : 'existing';
          row.cdId = v === '__new__' ? null : parseInt(v, 10);
          div.querySelector('.new-cd-fields').classList.toggle('show', row.cdMode === 'new');
        });
        div.querySelector('.wiz-new-nome').addEventListener('input', e => { row.newCdNome = e.target.value; });
        div.querySelector('.wiz-new-codigo').addEventListener('input', e => { row.newCdCodigo = e.target.value.toUpperCase(); });
      }
      div.querySelector('.wiz-col-select').addEventListener('change', e => { row.columnIndex = parseInt(e.target.value, 10); });
      div.querySelector('.wiz-hist-checkbox').addEventListener('change', e => { row.useAsHistorical = e.target.checked; });
    });

    openModal({
      title: `Importar programação de CD (${rows.length} arquivo${rows.length > 1 ? 's' : ''})`,
      bodyEl: container,
      footerButtons: [
        { label: 'Cancelar', className: 'btn-secondary' },
        { label: 'Importar', className: 'btn-primary', onClick: () => processImportWizard(rows) }
      ]
    });
  }

  async function processImportWizard(rows) {
    for (const row of rows) {
      if (!row.hasOwnOrigemColumn) {
        if (row.cdMode === 'new') {
          if (!row.newCdNome.trim() || !row.newCdCodigo.trim()) {
            showToast(`Preencha nome e código do novo CD para "${row.file.name}".`, 'error');
            return false;
          }
        } else if (!row.cdId) {
          showToast(`Selecione um CD para "${row.file.name}".`, 'error');
          return false;
        }
      }
      if (!row.columnIndex) {
        showToast(`Selecione a coluna de nomenclatura para "${row.file.name}".`, 'error');
        return false;
      }
    }

    for (const row of rows) {
      if (row.hasOwnOrigemColumn) {
        await CTDB.setMeta('colSignature:' + row.headerSignature, row.columnIndex);
        continue;
      }
      if (row.cdMode === 'new') {
        const cd = await CTDB.putCD({ nome: row.newCdNome.trim(), codigo: row.newCdCodigo.trim().toUpperCase() });
        row.cdId = cd.id; row.cdNome = cd.nome; row.cdCodigo = cd.codigo;
      } else {
        const cds = await CTDB.getAllCDs();
        const cd = cds.find(c => c.id === row.cdId);
        row.cdNome = cd ? cd.nome : null;
        row.cdCodigo = cd ? cd.codigo : null;
      }
      await CTDB.setMeta('colSignature:' + row.headerSignature, row.columnIndex);
    }

    let historicoCount = 0;
    for (const row of rows) {
      if (!row.useAsHistorical || !row.historicalDetection.isRich) continue;
      const richRows = extractRichRows(row.ws, row.historicalDetection);
      const historicoRecords = buildHistoricoRecordsFromRows(richRows, { origemArquivo: row.file.name, origemRegistro: 'excel_importado' });
      if (historicoRecords.length > 0) {
        await CTDB.addHistoricoBulk(historicoRecords);
        historicoCount += historicoRecords.length;
      }
    }

    // Planilhas "ricas" podem conter mais de um CD (coluna ORIGEM propria por linha) — nesse
    // caso a nomenclatura e associada ao CD daquela linha, nao ao CD unico escolhido no assistente
    // (que so serve de fallback para planilhas simples, com uma unica coluna de nomenclatura).
    const batch = [];
    for (const row of rows) {
      if (row.historicalDetection.isRich && row.historicalDetection.fieldCols.origem) {
        const richRows = extractRichRows(row.ws, row.historicalDetection);
        const byRota = new Map();
        richRows.forEach(rr => { if (!byRota.has(rr.rota)) byRota.set(rr.rota, rr.origem); });
        for (const [rota, origemCodigo] of byRota.entries()) {
          if (!origemCodigo) continue;
          let cd = await CTDB.getCDByCodigo(origemCodigo);
          if (!cd) cd = await CTDB.putCD({ nome: origemCodigo, codigo: origemCodigo });
          batch.push({ nomenclatura: rota, cdId: cd.id, cdCodigo: cd.codigo, cdNome: cd.nome, origemArquivo: row.file.name });
        }
      } else {
        const values = extractUniqueColumnValues(row.ws, row.columnIndex, row.headerRow);
        values.forEach(v => batch.push({ nomenclatura: v, cdId: row.cdId, cdCodigo: row.cdCodigo, cdNome: row.cdNome, origemArquivo: row.file.name }));
      }
    }
    const batchMap = new Map();
    batch.forEach(b => batchMap.set(b.nomenclatura, b));
    const uniqueBatch = Array.from(batchMap.values());

    const existing = await CTDB.getAllNomenclaturas();
    const existingMap = new Map(existing.map(e => [e.nomenclatura, e]));

    const toInsert = [], toTouch = [], conflicts = [];
    for (const b of uniqueBatch) {
      const ex = existingMap.get(b.nomenclatura);
      if (!ex) toInsert.push(b);
      else if (ex.cdId === b.cdId) toTouch.push(ex);
      else conflicts.push({ novo: b, atual: ex });
    }

    if (conflicts.length > 0) {
      renderConflictModal(conflicts, toInsert, toTouch, historicoCount);
      return false;
    }

    await commitImport(toInsert, toTouch, []);
    closeModal();
    const histSuffix = historicoCount > 0 ? ` ${historicoCount} registro(s) histórico(s) adicionados.` : '';
    showToast(`Importação concluída: ${toInsert.length} nova(s), ${toTouch.length} já cadastrada(s).${histSuffix}`, 'success');
    return true;
  }

  async function commitImport(toInsert, toTouch, resolutions) {
    const now = new Date().toISOString();
    const records = [];
    toInsert.forEach(b => records.push({
      nomenclatura: b.nomenclatura, cdId: b.cdId, cdCodigo: b.cdCodigo, cdNome: b.cdNome,
      status: 'ok', dataCadastro: now, ultimaAtualizacao: now, origemArquivo: b.origemArquivo
    }));
    toTouch.forEach(ex => records.push(Object.assign({}, ex, { ultimaAtualizacao: now })));
    resolutions.forEach(r => records.push(r));
    if (records.length > 0) await CTDB.putNomenclaturasBulk(records);
    await refreshBaseTable();
  }

  function renderConflictModal(conflicts, toInsert, toTouch, historicoCount) {
    const container = document.createElement('div');
    const applyAllDiv = document.createElement('div');
    applyAllDiv.className = 'conflict-apply-all';
    applyAllDiv.innerHTML = `
      <span>Aplicar a todos:</span>
      <select id="conflictApplyAllSelect">
        <option value="">—</option>
        <option value="manter">Manter cadastro atual</option>
        <option value="atualizar">Atualizar para o novo CD</option>
        <option value="conflito">Cadastrar como conflito</option>
      </select>`;
    container.appendChild(applyAllDiv);

    conflicts.forEach((c, idx) => {
      const div = document.createElement('div');
      div.className = 'conflict-row';
      div.innerHTML = `
        <div class="conflict-row-title">${escapeHtml(c.novo.nomenclatura)}</div>
        <div class="conflict-row-sub">CD atualmente cadastrado: <strong>${escapeHtml(c.atual.cdNome || c.atual.cdCodigo)}</strong> &nbsp;→&nbsp; CD informado no novo arquivo: <strong>${escapeHtml(c.novo.cdNome || c.novo.cdCodigo)}</strong></div>
        <div class="conflict-choices">
          <label><input type="radio" name="conflict-${idx}" value="manter" checked /> Manter atual</label>
          <label><input type="radio" name="conflict-${idx}" value="atualizar" /> Atualizar para o novo CD</label>
          <label><input type="radio" name="conflict-${idx}" value="conflito" /> Cadastrar como conflito</label>
        </div>`;
      container.appendChild(div);
    });

    applyAllDiv.querySelector('#conflictApplyAllSelect').addEventListener('change', e => {
      const v = e.target.value;
      if (!v) return;
      container.querySelectorAll('.conflict-row').forEach(row => {
        const radio = row.querySelector(`input[value="${v}"]`);
        if (radio) radio.checked = true;
      });
    });

    openModal({
      title: `Possível conflito de nomenclatura (${conflicts.length})`,
      bodyEl: container,
      footerButtons: [
        { label: 'Cancelar importação', className: 'btn-secondary' },
        {
          label: 'Confirmar', className: 'btn-primary', onClick: async () => {
            const now = new Date().toISOString();
            const resolutions = [];
            conflicts.forEach((c, idx) => {
              const choice = container.querySelector(`input[name="conflict-${idx}"]:checked`).value;
              if (choice === 'manter') {
                resolutions.push(Object.assign({}, c.atual, { ultimaAtualizacao: now }));
              } else if (choice === 'atualizar') {
                resolutions.push({
                  nomenclatura: c.novo.nomenclatura, cdId: c.novo.cdId, cdCodigo: c.novo.cdCodigo, cdNome: c.novo.cdNome,
                  status: 'ok', dataCadastro: c.atual.dataCadastro, ultimaAtualizacao: now, origemArquivo: c.novo.origemArquivo
                });
              } else {
                resolutions.push(Object.assign({}, c.atual, {
                  status: 'conflito', pendingCdCodigo: c.novo.cdCodigo, pendingCdNome: c.novo.cdNome, ultimaAtualizacao: now
                }));
              }
            });
            await commitImport(toInsert, toTouch, resolutions);
            const histSuffix = historicoCount > 0 ? ` ${historicoCount} registro(s) histórico(s) adicionados.` : '';
            showToast(`Importação concluída com ${conflicts.length} conflito(s) resolvido(s).${histSuffix}`, 'success');
            return true;
          }
        }
      ]
    });
  }

  /* ============================================================================
   * BACKUP: EXPORTAR / IMPORTAR BASE (JSON)
   * ==========================================================================*/
  $('#btnExportBase').addEventListener('click', async () => {
    const data = await CTDB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    a.href = url;
    a.download = `backup_base_control_tower_${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('Backup exportado.', 'success');
  });

  const importBaseInput = $('#importBaseInput');
  $('#btnImportBase').addEventListener('click', () => importBaseInput.click());
  importBaseInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    importBaseInput.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      showToast('Arquivo de backup inválido (JSON malformado).', 'error');
      return;
    }
    if (!data || !Array.isArray(data.cds) || !Array.isArray(data.nomenclaturas)) {
      showToast('Arquivo de backup inválido: estrutura inesperada.', 'error');
      return;
    }
    openModal({
      title: 'Importar backup da base',
      bodyEl: `<div class="confirm-body">Encontrados <strong>${data.cds.length}</strong> CD(s) e <strong>${data.nomenclaturas.length}</strong> nomenclatura(s) no arquivo.<br><br>Como deseja importar?</div>`,
      footerButtons: [
        { label: 'Cancelar', className: 'btn-secondary' },
        {
          label: 'Mesclar com a base atual', className: 'btn-secondary', onClick: async () => {
            await CTDB.importAll(data, 'merge');
            await refreshBaseTable();
            showToast('Backup mesclado com sucesso.', 'success');
            return true;
          }
        },
        {
          label: 'Substituir base atual', className: 'btn-danger', onClick: async () => {
            await CTDB.importAll(data, 'replace');
            await refreshBaseTable();
            showToast('Base restaurada a partir do backup.', 'success');
            return true;
          }
        }
      ]
    });
  });

  /* ============================================================================
   * INTELIGENCIA / HISTORICO
   * ==========================================================================*/
  const intelSearch = $('#intelSearch');
  const intelSearchResult = $('#intelSearchResult');
  const vehicleRulesBody = $('#vehicleRulesBody');

  async function refreshIntelPage() {
    const [historico, cds, nomenclaturas] = await Promise.all([
      CTDB.getAllHistorico(), CTDB.getAllCDs(), CTDB.getAllNomenclaturas()
    ]);
    const rotasHistorico = new Set(historico.map(h => h.rota));
    const rotasComCarregPattern = new Set();
    const rotasComRetornoPattern = new Set();
    const porRota = new Map();
    historico.forEach(h => {
      if (!porRota.has(h.rota)) porRota.set(h.rota, []);
      porRota.get(h.rota).push(h);
    });
    for (const rota of rotasHistorico) {
      const stats = computeRotaCarregamentoStats(historico, rota);
      if (stats.confidence !== 'sem_evidencia') rotasComCarregPattern.add(rota);
      const retStats = computeReturnPatternStats(historico, rota);
      if (retStats.hasEvidence && retStats.recomendaRetorno) rotasComRetornoPattern.add(rota);
    }

    $('#intelHistCount').textContent = historico.length;
    $('#intelCdCount').textContent = cds.length;
    $('#intelNomenCount').textContent = nomenclaturas.length;
    $('#intelRotaCount').textContent = rotasHistorico.size;
    $('#intelCarregPatterns').textContent = rotasComCarregPattern.size;
    $('#intelRetornoPatterns').textContent = rotasComRetornoPattern.size;

    state.intelHistorico = historico;
    const vehicleRules = await CTDB.getAllVehicleRules();
    state.intelVehicleRules = vehicleRules;
    renderVehicleRulesTable(vehicleRules);
    renderPrefixTable(nomenclaturas);
    renderIntelSearch();
  }

  function renderPrefixTable(nomenclaturas) {
    const table = buildPrefixDisplayTable(nomenclaturas);
    const body = $('#prefixTableBody');
    const empty = $('#prefixTableEmpty');
    body.innerHTML = '';
    empty.hidden = table.length > 0;
    table.forEach(p => {
      const tr = document.createElement('tr');
      const distText = p.conflito
        ? p.distribuicao.map(d => `${d.codigo}: ${d.pct}%`).join(', ')
        : `${p.cdCodigo}${p.cdNome && p.cdNome !== p.cdCodigo ? ' (' + p.cdNome + ')' : ''}`;
      tr.innerHTML = `
        <td class="nomen-code">${escapeHtml(p.prefix)}</td>
        <td>${p.conflito ? `<span class="status-badge status-conflito">CONFLITO</span> ${escapeHtml(distText)}` : `<span class="cd-badge">${escapeHtml(distText)}</span>`}</td>
        <td>${p.ocorrencias}</td>
        <td>${p.conflito ? '—' : p.confiancaPct + '%'}</td>`;
      body.appendChild(tr);
    });
  }

  function renderIntelSearch() {
    const term = (intelSearch.value || '').trim().toUpperCase();
    intelSearchResult.innerHTML = '';
    if (!term) return;
    const historico = state.intelHistorico || [];
    const matched = [...new Set(historico.map(h => h.rota))].filter(r => r.includes(term));
    if (matched.length === 0) {
      intelSearchResult.innerHTML = '<div class="intel-empty">Nenhuma rota encontrada no histórico para esse termo.</div>';
      return;
    }
    matched.slice(0, 15).forEach(rota => {
      intelSearchResult.appendChild(renderRotaIntelCard(rota, historico));
    });
  }

  function confidenceBadge(conf) {
    const labels = { alta: 'confiança alta', media: 'confiança média', baixa: 'confiança baixa', sem_evidencia: 'sem evidência' };
    return `<span class="intel-confidence intel-confidence-${conf}">${labels[conf] || conf}</span>`;
  }

  function renderRotaIntelCard(rota, historico) {
    const carreg = computeRotaCarregamentoStats(historico, rota);
    const retorno = computeReturnPatternStats(historico, rota);
    const div = document.createElement('div');
    div.className = 'intel-card';
    div.style.marginBottom = '12px';

    const ultimaOcorrencia = carreg.ultimaOcorrencia ? fmtDateBRFromIso(carreg.ultimaOcorrencia) : '—';
    const operacao = carreg.tipoVeiculoPredominante ? resolveOperacaoFromVehicleType(carreg.tipoVeiculoPredominante, state.intelVehicleRules || DEFAULT_VEHICLE_TYPE_RULES) : null;

    div.innerHTML = `
      <div class="intel-card-title">${escapeHtml(rota)}</div>
      <dl class="intel-grid">
        <div><dt>Tipo de veículo mais frequente</dt><dd>${escapeHtml(carreg.tipoVeiculoPredominante || '—')}${operacao ? ' (' + escapeHtml(operacao) + ')' : ''}</dd></div>
        <div><dt>Horário de carregamento predominante</dt><dd>${escapeHtml(carreg.horaPredominante || '—')} ${carreg.count ? confidenceBadge(carreg.confidence) : ''}</dd></div>
        <div><dt>Registros históricos (carregamento)</dt><dd>${carreg.count}</dd></div>
        <div><dt>Última ocorrência</dt><dd>${ultimaOcorrencia}</dd></div>
        <div><dt>Padrão de retorno ao CD</dt><dd>${retorno.hasEvidence ? (retorno.recomendaRetorno ? 'Sim' : 'Não') : 'Sem evidência'} ${retorno.hasEvidence ? confidenceBadge(retorno.confidence) : ''}</dd></div>
        <div><dt>Retorno: horário / defasagem predominante</dt><dd>${retorno.horaRetornoPredominante ? escapeHtml(retorno.horaRetornoPredominante) + ' · ' + retorno.deltaDiasPredominante + ' dia(s) após entrega' : '—'}</dd></div>
      </dl>
      ${carreg.count ? `<div class="intel-motivo">Baseado em ${carreg.count} ocorrência(s) histórica(s)${retorno.hasEvidence ? `; ${retorno.comRetorno} de ${retorno.count} apresentaram linha de retorno` : ''}.</div>` : ''}
    `;
    return div;
  }

  intelSearch.addEventListener('input', renderIntelSearch);

  function renderVehicleRulesTable(rules) {
    vehicleRulesBody.innerHTML = '';
    rules.forEach(rule => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" maxlength="10" value="${escapeHtml(rule.pattern)}" class="vehicle-pattern" /></td>
        <td><input type="text" maxlength="40" value="${escapeHtml(rule.operacao)}" class="vehicle-operacao" /></td>
        <td><button type="button" class="btn-icon remove-vehicle-row" title="Remover">&times;</button></td>`;
      tr.dataset.originalPattern = rule.pattern;
      vehicleRulesBody.appendChild(tr);
    });
  }

  $('#addVehicleRuleRow').addEventListener('click', () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" maxlength="10" value="" class="vehicle-pattern" placeholder="ex: MB" /></td>
      <td><input type="text" maxlength="40" value="" class="vehicle-operacao" placeholder="ex: Martin Brower" /></td>
      <td><button type="button" class="btn-icon remove-vehicle-row" title="Remover">&times;</button></td>`;
    vehicleRulesBody.appendChild(tr);
  });

  vehicleRulesBody.addEventListener('click', async e => {
    if (!e.target.classList.contains('remove-vehicle-row')) return;
    const tr = e.target.closest('tr');
    const original = tr.dataset.originalPattern;
    if (original) await CTDB.deleteVehicleRule(original);
    tr.remove();
  });

  vehicleRulesBody.addEventListener('change', async e => {
    if (!e.target.classList.contains('vehicle-pattern') && !e.target.classList.contains('vehicle-operacao')) return;
    const tr = e.target.closest('tr');
    const pattern = tr.querySelector('.vehicle-pattern').value.trim().toUpperCase();
    const operacao = tr.querySelector('.vehicle-operacao').value.trim();
    if (!pattern || !operacao) return;
    const original = tr.dataset.originalPattern;
    if (original && original !== pattern) await CTDB.deleteVehicleRule(original);
    await CTDB.putVehicleRule({ pattern, operacao });
    tr.dataset.originalPattern = pattern;
  });

  // Semeadura automatica: se o codigo embutir dados de backup (backupData,
  // preenchido em build/seed-data.js) e a base local ainda estiver vazia,
  // carrega-os automaticamente — nao e mais preciso reimportar o backup a
  // cada uso. So roda uma vez (na primeira abertura neste navegador); depois
  // disso a base evolui normalmente pela interface.
  (async () => {
    try {
      if (typeof backupData !== 'undefined' && backupData) {
        const seeded = await CTDB.seedIfEmpty(backupData);
        if (seeded) showToast('Base inicial carregada automaticamente a partir dos dados embutidos.', 'success');
      }
    } catch (err) {
      console.error('Erro ao semear a base automaticamente:', err);
    }
    await CTDB.ensureDefaultVehicleRulesSeeded(DEFAULT_VEHICLE_TYPE_RULES).catch(err => console.error('Erro ao inicializar regras de veiculo:', err));
    refreshBaseTable().catch(err => console.error('Erro ao carregar Base de CDs:', err));
  })();

  // pre-aquece as libs em segundo plano assim que a pagina carrega
  ensureLibsLoaded().catch(() => {});
})();
