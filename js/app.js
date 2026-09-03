/* ============================================================================
 * APP.JS - Interface e orquestracao
 * ----------------------------------------------------------------------------
 * Versao simplificada (2 paginas): "Processar PDF" e "Configuracoes".
 * As antigas paginas "Base de CDs" e "Inteligencia / Historico" foram
 * removidas - o reconhecimento de origem e transportadora agora vem de uma
 * tabela estatica embutida (data/prefixo_cd_transportadora.js), sem qualquer
 * tela de cadastro/importacao manual.
 * ==========================================================================*/

const $ = (sel, root) => (root || document).querySelector(sel);
const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const state = {
  pdfjsLib: null,
  pdfFile: null,
  modelFile: null, // ArrayBuffer custom, se o usuario enviar um modelo proprio
  origemFallback: 'NLOC',
  records: [],
  warnings: [],
  errors: [],
  autoReturns: [],
  workbookResult: null,
  excelFiles: [] // [{ fileName, blob }] - um por planilha de saida (ver buildPlanilhaFileGroups)
};

/* ---------------------------------- Toasts ------------------------------- */
function showToast(message, type) {
  const container = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type ? 'toast-' + type : ''}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 4200);
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------------------------------- pdf.js -------------------------------- */
function ensureLibsLoaded() {
  if (state.pdfjsLib) return Promise.resolve(state.pdfjsLib);
  return (async () => {
    // O especificador do import() e relativo a ESTE arquivo (js/app.js).
    const pdfjsLib = await import('../vendor/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';
    state.pdfjsLib = pdfjsLib;
    return pdfjsLib;
  })();
}

/* ============================================================================
 * NAVEGACAO: Processar PDF <-> Configuracoes (botao de engrenagem)
 * ==========================================================================*/
function initTabs() {
  const pageProcessar = $('#pageProcessar');
  const pageConfig = $('#pageConfig');
  const btnSettings = $('#btnSettings');

  btnSettings.addEventListener('click', () => {
    const abrirConfig = pageConfig.hidden;
    pageConfig.hidden = !abrirConfig;
    pageProcessar.hidden = abrirConfig;
    btnSettings.classList.toggle('active', abrirConfig);
    btnSettings.title = abrirConfig ? 'Voltar para Processar PDF' : 'Configurações';
  });
}

/* ============================================================================
 * DROPZONE / ARQUIVO PDF
 * ==========================================================================*/
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function setPdfFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    showToast('Selecione um arquivo PDF.', 'error');
    return;
  }
  state.pdfFile = file;
  $('#fileName').textContent = file.name;
  $('#fileSize').textContent = formatBytes(file.size);
  $('#fileInfo').hidden = false;
  $('#btnProcessar').disabled = false;
  resetProcessingUI();
}

function resetProcessingUI() {
  $('#summarySection').hidden = true;
  $('#issuesSection').hidden = true;
  $('#autoReturnSection').hidden = true;
  $('#genSection').hidden = true;
  $('#progressSection').hidden = true;
  $('#downloadSection').hidden = true;
  $('#genStatus').hidden = true;
  $('#btnGerar').disabled = true;
  state.records = []; state.warnings = []; state.errors = []; state.autoReturns = [];
  state.excelFiles = [];
}

function initDropzone() {
  const zone = $('#dropZone');
  const input = $('#pdfInput');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { if (input.files[0]) setPdfFile(input.files[0]); });

  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, (ev) => { ev.preventDefault(); zone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (ev) => { ev.preventDefault(); zone.classList.remove('dragover'); }));
  zone.addEventListener('drop', (ev) => { const f = ev.dataTransfer.files[0]; if (f) setPdfFile(f); });

  $('#removeFileBtn').addEventListener('click', (ev) => {
    ev.stopPropagation();
    state.pdfFile = null;
    input.value = '';
    $('#fileInfo').hidden = true;
    $('#btnProcessar').disabled = true;
    resetProcessingUI();
  });
}

/* ============================================================================
 * RENDER: RESUMO / VALIDACAO / RETORNOS AUTOMATICOS
 * ==========================================================================*/
function renderSummary(norm, warnings, autoReturns, pagesCount) {
  const valid = norm.records.filter(r => r.valido).length;
  const invalid = norm.records.length - valid;
  $('#sumPages').textContent = pagesCount;
  $('#sumRecords').textContent = norm.records.length;
  $('#sumValid').textContent = valid;
  $('#sumInvalid').textContent = invalid;
  $('#sumWarnings').textContent = warnings.length;
  $('#sumAutoReturns').textContent = autoReturns.length;
  $('#summarySection').hidden = false;
}

const WARNING_LABELS = {
  prefixo_nao_cadastrado: { badge: 'ORIGEM', cls: 'issue-warning' },
  carregamento_ausente: { badge: 'CARREGAMENTO', cls: 'issue-info' },
  inconsistencia_caixas: { badge: 'CAIXAS', cls: 'issue-info' },
  duplicado: { badge: 'DUPLICADO', cls: 'issue-warning' },
  linha_incompleta: { badge: 'LINHA', cls: 'issue-warning' }
};

function renderIssues(errors, warnings) {
  const list = $('#issuesList');
  list.innerHTML = '';
  const items = [];

  errors.forEach(e => {
    items.push({ cls: 'issue-error', badge: 'ERRO', html: `Rota <strong>${escapeHtml(e.rota)}</strong> / Loja <strong>${escapeHtml(e.loja)}</strong> (pág. ${e.page}): ${escapeHtml(e.motivos.join('; '))}` });
  });
  warnings.forEach(w => {
    const label = WARNING_LABELS[w.type] || { badge: 'AVISO', cls: 'issue-warning' };
    const loc = w.rota ? `Rota <strong>${escapeHtml(w.rota)}</strong>${w.loja ? ` / Loja <strong>${escapeHtml(w.loja)}</strong>` : ''}: ` : '';
    items.push({ cls: label.cls, badge: label.badge, html: `${loc}${escapeHtml(w.detail)}` });
  });

  if (items.length === 0) {
    $('#issuesSection').hidden = true;
    return;
  }
  items.forEach(it => {
    const div = document.createElement('div');
    div.className = `issue ${it.cls}`;
    div.innerHTML = `<span class="issue-badge">${it.badge}</span><span>${it.html}</span>`;
    list.appendChild(div);
  });
  $('#issuesSection').hidden = false;
}

function renderAutoReturns(autoReturns) {
  const list = $('#autoReturnList');
  list.innerHTML = '';
  if (!autoReturns.length) { $('#autoReturnSection').hidden = true; return; }
  autoReturns.forEach(r => {
    const div = document.createElement('div');
    div.className = 'issue issue-info';
    div.innerHTML = `<span class="issue-badge">RETORNO</span><span>Rota <strong>${escapeHtml(r.rota)}</strong> → <strong>${escapeHtml(r.loja)}</strong>: ${escapeHtml(r._auto.motivo)}</span>`;
    list.appendChild(div);
  });
  $('#autoReturnSection').hidden = false;
}

/* ============================================================================
 * PIPELINE PRINCIPAL: PROCESSAR PDF
 * ==========================================================================*/
async function processarPdf() {
  if (!state.pdfFile) return;
  resetProcessingUI();
  $('#progressSection').hidden = false;
  $('#progressStatus').textContent = 'Carregando bibliotecas...';
  $('#progressBar').style.width = '2%';
  $('#progressBar').classList.remove('error');
  $('#btnProcessar').disabled = true;

  try {
    const pdfjsLib = await ensureLibsLoaded();
    $('#progressStatus').textContent = 'Lendo arquivo...';
    const buf = await state.pdfFile.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

    $('#progressStatus').textContent = 'Extraindo dados do PDF...';
    const raw = await extractPdfRecords(pdfDoc, {}, ({ page, totalPages, recordsSoFar }) => {
      const pct = 5 + Math.round((page / totalPages) * 55);
      $('#progressBar').style.width = pct + '%';
      $('#progressDetail').textContent = `Página ${page} de ${totalPages} — ${recordsSoFar} registro(s) encontrados`;
    });

    $('#progressStatus').textContent = 'Validando registros...';
    $('#progressBar').style.width = '65%';
    const norm = normalizeAndValidate(raw, { origemFallback: state.origemFallback });

    $('#progressStatus').textContent = 'Consultando histórico de retornos...';
    $('#progressBar').style.width = '78%';
    const historico = await CTDB.getAllHistorico();
    const autoReturns = buildAutoReturnRecords(norm.records, historico, {});

    // aprendizado silencioso: alimenta o historico de carregamento com este PDF
    const novoHistorico = buildHistoricoFromPdfRecords(norm.records, { origemArquivo: state.pdfFile.name, origemRegistro: 'pdf' });
    await CTDB.addHistoricoBulk(novoHistorico);

    state.records = norm.records;
    state.warnings = norm.warnings;
    state.errors = norm.errors;
    state.autoReturns = autoReturns;

    $('#progressBar').style.width = '100%';
    $('#progressStatus').textContent = 'Concluído.';
    $('#progressDetail').textContent = `${norm.records.length} registro(s) — ${autoReturns.length} retorno(s) automático(s)`;

    renderSummary(norm, norm.warnings, autoReturns, pdfDoc.numPages);
    renderIssues(norm.errors, norm.warnings);
    renderAutoReturns(autoReturns);

    $('#genSection').hidden = false;
    $('#btnGerar').disabled = norm.records.filter(r => r.valido).length === 0;

    showToast('PDF processado com sucesso.', 'success');
  } catch (err) {
    console.error(err);
    $('#progressBar').classList.add('error');
    $('#progressStatus').textContent = 'Erro ao processar o PDF.';
    $('#progressDetail').textContent = err.message || String(err);
    showToast('Erro ao processar o PDF: ' + (err.message || err), 'error');
  } finally {
    $('#btnProcessar').disabled = false;
  }
}

/* ============================================================================
 * GERACAO DO EXCEL (uma planilha por grupo - ver buildPlanilhaFileGroups)
 * ==========================================================================*/
async function gerarExcel() {
  const validRecords = state.records.filter(r => r.valido);
  if (!validRecords.length) return;
  const allRecords = validRecords.concat(state.autoReturns);

  $('#btnGerar').disabled = true;
  const statusEl = $('#genStatus');
  statusEl.hidden = false;
  statusEl.className = 'gen-status';
  statusEl.textContent = 'Gerando arquivo(s)...';
  state.excelFiles = [];

  try {
    let modelBuffer = state.modelFile;
    if (!modelBuffer) {
      const resp = await fetch('./data/modelo-excel.xlsx');
      if (!resp.ok) throw new Error('Não foi possível carregar o modelo padrão (data/modelo-excel.xlsx). Sirva os arquivos por http(s) e verifique se a pasta "data" foi enviada.');
      modelBuffer = await resp.arrayBuffer();
    }

    const grupos = buildPlanilhaFileGroups(allRecords);
    for (const grupo of grupos) {
      const result = await buildExcelWorkbook(modelBuffer, grupo.records, {});
      const outBuffer = await result.workbook.xlsx.writeBuffer();
      const blob = new Blob([outBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      state.excelFiles.push({ fileName: grupo.fileName, blob, count: grupo.records.length });
    }

    statusEl.classList.add('ok');
    statusEl.textContent = grupos.length === 1
      ? `Excel gerado com sucesso (${allRecords.length} linha(s)).`
      : `${grupos.length} planilhas geradas com sucesso (${allRecords.length} linha(s) no total, semana ${grupos[0].semana}).`;

    renderDownloadList(state.excelFiles);
    $('#downloadSection').hidden = false;
    showToast(grupos.length === 1 ? 'Excel gerado com sucesso.' : `${grupos.length} planilhas geradas com sucesso.`, 'success');
  } catch (err) {
    console.error(err);
    statusEl.classList.add('error');
    statusEl.textContent = 'Erro ao gerar o Excel: ' + (err.message || err);
    showToast('Erro ao gerar o Excel.', 'error');
  } finally {
    $('#btnGerar').disabled = false;
  }
}

function renderDownloadList(files) {
  const list = $('#downloadList');
  list.innerHTML = '';
  files.forEach((f, idx) => {
    const row = document.createElement('div');
    row.className = 'download-item';
    row.innerHTML = `<div class="download-filename">${escapeHtml(f.fileName)} <span class="download-count">(${f.count} linha${f.count === 1 ? '' : 's'})</span></div>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-success';
    btn.textContent = 'Baixar';
    btn.addEventListener('click', () => baixarExcelPorIndice(idx));
    row.appendChild(btn);
    list.appendChild(row);
  });
}

function baixarExcelPorIndice(idx) {
  const f = state.excelFiles[idx];
  if (!f) return;
  const url = URL.createObjectURL(f.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function baixarTodosExcel() {
  state.excelFiles.forEach((_, idx) => baixarExcelPorIndice(idx));
}

/* ============================================================================
 * CONFIGURACOES: modelo Excel, origem fallback, tabela de referencia
 * ==========================================================================*/
function initConfigPage() {
  $('#modelInput').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      state.modelFile = await file.arrayBuffer();
      $('#modelFileName').textContent = file.name;
      const statusEl = $('#modelStatus');
      statusEl.className = 'model-status ok';
      statusEl.textContent = 'Modelo customizado carregado — será usado na próxima geração.';
      showToast('Modelo de Excel customizado carregado.', 'success');
    } catch (err) {
      showToast('Erro ao ler o arquivo de modelo.', 'error');
    }
  });

  $('#resetModelBtn').addEventListener('click', () => {
    state.modelFile = null;
    $('#modelInput').value = '';
    $('#modelFileName').textContent = 'Nenhum (usando modelo padrão embutido)';
    $('#modelStatus').className = 'model-status';
    $('#modelStatus').textContent = '';
  });

  const fallbackInput = $('#origemFallback');
  let savedFallback = null;
  try { savedFallback = localStorage.getItem('ct_origem_fallback'); } catch (e) {}
  if (savedFallback) { state.origemFallback = savedFallback; fallbackInput.value = savedFallback; }
  fallbackInput.addEventListener('change', () => {
    const v = fallbackInput.value.trim().toUpperCase() || 'NLOC';
    fallbackInput.value = v;
    state.origemFallback = v;
    try { localStorage.setItem('ct_origem_fallback', v); } catch (e) {}
  });

  renderPrefixRefTable();
  $('#prefixTableSearch').addEventListener('input', (ev) => renderPrefixRefTable(ev.target.value));

  renderRegraCarregamentoTable();
  $('#regraCarregTableSearch').addEventListener('input', (ev) => renderRegraCarregamentoTable(ev.target.value));
}

function renderPrefixRefTable(filter) {
  const tbody = $('#prefixRefTableBody');
  const f = (filter || '').trim().toUpperCase();
  const rows = PREFIXO_CD_TRANSPORTADORA
    .filter(e => !f || e.prefixo.includes(f) || e.cd.includes(f) || e.transportadora.includes(f) || e.planilha.toUpperCase().includes(f))
    .sort((a, b) => a.prefixo.localeCompare(b.prefixo));

  tbody.innerHTML = rows.map(e => `<tr><td>${escapeHtml(e.prefixo)}</td><td>${escapeHtml(e.cd)}</td><td>${escapeHtml(e.transportadora)}</td><td>${escapeHtml(e.planilha)}</td></tr>`).join('')
    || `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);">Nenhum resultado.</td></tr>`;
}

// Descreve, em texto legivel, a regra de DTHCARREG de uma entrada de
// REGRAS_CARREGAMENTO (ver data/regra_carregamento.js).
function describeRegraCarregamento(r) {
  if (r.origemCondicional) {
    return `Se origem = ${r.origemCondicional}: ${r.diasAntesEntrega} dia(s) antes da entrega, ${r.hora}. Caso contrário: segue preliminar do PDF.`;
  }
  if (r.seguePreliminar) return 'Segue preliminar do PDF (sem alteração)';
  return `${r.diasAntesEntrega} dia${r.diasAntesEntrega === 1 ? '' : 's'} antes da entrega, ${r.hora}`;
}

function renderRegraCarregamentoTable(filter) {
  const tbody = $('#regraCarregTableBody');
  const f = (filter || '').trim().toUpperCase();

  const rows = REGRAS_CARREGAMENTO.map(r => ({
    fat: r.cdFat,
    nomenclatura: r.origemCondicional ? `Qualquer (origem = ${r.origemCondicional})` : r.nomenclaturas.join(' / '),
    regra: describeRegraCarregamento(r)
  })).filter(row => !f || row.fat.toUpperCase().includes(f) || row.nomenclatura.toUpperCase().includes(f) || row.regra.toUpperCase().includes(f));

  tbody.innerHTML = rows.map(row => `<tr><td>FAT. ${escapeHtml(row.fat)}</td><td>${escapeHtml(row.nomenclatura)}</td><td>${escapeHtml(row.regra)}</td></tr>`).join('')
    || `<tr><td colspan="3" style="text-align:center;color:var(--text-dim);">Nenhum resultado.</td></tr>`;
}

/* ============================================================================
 * INICIALIZACAO
 * ==========================================================================*/
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initDropzone();
  initConfigPage();

  $('#btnProcessar').addEventListener('click', processarPdf);
  $('#btnGerar').addEventListener('click', gerarExcel);
  $('#downloadAllBtn').addEventListener('click', baixarTodosExcel);

  // carga inicial do historico (uma unica vez) a partir de data/backup_data.js
  if (typeof backupData !== 'undefined' && backupData && backupData.historico) {
    CTDB.seedHistoricoIfEmpty(backupData.historico).catch(err => console.error('Erro ao semear historico:', err));
  }

  // pre-aquece o pdf.js em segundo plano assim que a pagina carrega
  ensureLibsLoaded().catch(() => {});
});
