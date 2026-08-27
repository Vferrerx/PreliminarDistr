/* ============================================================================
 * CORE LOGIC - Control Tower / Gerador de Programacao
 * Funcoes puras, sem dependencia de Node ou de browser especificamente.
 * Reutilizado tanto no prototipo de teste (Node) quanto no index.html final.
 * Depende apenas de: pdfjsLib (global) e ExcelJS (global) quando usado.
 * ==========================================================================*/

/* ---------------------------- Utilitarios de data ---------------------- */

// BR: Domingo=1 ... Sabado=7   |   JS Date.getUTCDay(): Domingo=0 ... Sabado=6
function brDowToJsDow(brDow) { return brDow - 1; } // BR1(dom)->JS0 ... BR7(sab)->JS6

function parseBRDateShortYear(str) {
  // "22/08/26" -> {day:22, month:8, year:2026}
  const m = String(str).trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  year = year < 70 ? 2000 + year : 1900 + year;
  return { day, month, year };
}

function makeUTCDate(y, m, d, h = 0, mi = 0) {
  return new Date(Date.UTC(y, m - 1, d, h, mi, 0));
}

// Retorna a data (UTC, 00:00) da proxima ocorrencia (>= anchorDate) do dia da semana informado (codigo BR 1-7)
function resolveWeekdayDate(anchorDate, brDowDigit) {
  const anchorJsDow = anchorDate.getUTCDay();
  const targetJsDow = brDowToJsDow(brDowDigit);
  const diff = (targetJsDow - anchorJsDow + 7) % 7;
  const result = new Date(anchorDate.getTime());
  result.setUTCDate(result.getUTCDate() + diff);
  return result;
}

function parseHourMinute(str) {
  const m = String(str).trim().match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return { h: parseInt(m[1], 10), m: parseInt(m[2], 10) };
}

/* --------------------------- Utilitarios numericos ---------------------- */

function parseBRNumber(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (s === '' || s === '-') return null;
  // formato BR: milhar com "." e decimal com ","
  const normalized = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(normalized);
  return isNaN(n) ? null : n;
}

/* ------------------- Reconhecimento de CD por prefixo da rota ------------ */
// Regra definitiva: o prefixo NAO e cadastrado manualmente. Ele e derivado
// dinamicamente da propria nomenclatura (a "corrida inicial" de letras antes
// do primeiro digito — cobre exemplos como ON, SP, CP, JND, ABC) e a relacao
// prefixo -> CD e aprendida a partir da Base de CDs (nomenclaturas ja
// associadas a um CD), nunca fixada no codigo.
const DEFAULT_ORIGEM_FALLBACK = 'CDFT';

function derivePrefixFromRota(rota) {
  const upper = String(rota || '').toUpperCase();
  const m = upper.match(/^[A-Z]+/);
  return m ? m[0] : upper.slice(0, 2);
}

// Candidatos de prefixo do mais especifico (rota inteira sem os digitos) ao
// mais genérico (1 letra) — usados para permitir um "historico geral" quando
// o prefixo completo ainda nao tem evidencia suficiente.
function candidatePrefixesForRota(rota) {
  const full = derivePrefixFromRota(rota);
  const candidates = [];
  for (let len = full.length; len >= 1; len--) candidates.push(full.slice(0, len));
  return candidates;
}

// Agrega, a partir da Base de nomenclaturas (Map ou array de
// {nomenclatura, cdCodigo, cdNome, status}), quantas ocorrencias cada prefixo
// tem por CD, com percentual de confianca e deteccao de conflito (quando nao
// ha uma maioria clara — nunca escolhido silenciosamente).
function buildPrefixLookup(nomenclaturas) {
  const list = nomenclaturas instanceof Map
    ? [...nomenclaturas.entries()].map(([nomenclatura, v]) => Object.assign({ nomenclatura }, v))
    : (nomenclaturas || []);

  const groups = new Map(); // prefix -> Map(cdCodigo -> {count, cdNome})
  list.forEach(n => {
    if (!n.cdCodigo || n.status === 'conflito') return;
    candidatePrefixesForRota(n.nomenclatura).forEach(prefix => {
      if (!groups.has(prefix)) groups.set(prefix, new Map());
      const cdMap = groups.get(prefix);
      const cur = cdMap.get(n.cdCodigo) || { count: 0, cdNome: n.cdNome };
      cur.count++;
      cdMap.set(n.cdCodigo, cur);
    });
  });

  const lookup = new Map();
  for (const [prefix, cdMap] of groups.entries()) {
    const entries = [...cdMap.entries()].map(([codigo, v]) => ({ codigo, count: v.count, cdNome: v.cdNome }));
    entries.sort((a, b) => b.count - a.count);
    const total = entries.reduce((s, e) => s + e.count, 0);
    const top = entries[0];
    const pct = total > 0 ? top.count / total : 0;
    const conflito = entries.length > 1 && pct < 0.66;
    lookup.set(prefix, {
      prefix, cdCodigo: top.codigo, cdNome: top.cdNome, ocorrencias: total,
      confiancaPct: Math.round(pct * 100), conflito,
      distribuicao: entries.map(e => ({ codigo: e.codigo, count: e.count, pct: Math.round((e.count / total) * 100) }))
    });
  }
  return lookup;
}

// Tabela de exibicao (secao 12 do pedido): apenas o prefixo "natural" (corrida
// alfabetica completa) de cada nomenclatura, para nao poluir a interface com
// os prefixos parciais usados internamente como fallback.
function buildPrefixDisplayTable(nomenclaturas) {
  const list = nomenclaturas instanceof Map
    ? [...nomenclaturas.entries()].map(([nomenclatura, v]) => Object.assign({ nomenclatura }, v))
    : (nomenclaturas || []);
  const naturalOnly = new Map();
  list.forEach(n => {
    if (!n.cdCodigo || n.status === 'conflito') return;
    const prefix = derivePrefixFromRota(n.nomenclatura);
    if (!naturalOnly.has(prefix)) naturalOnly.set(prefix, []);
    naturalOnly.get(prefix).push(n);
  });
  const fullLookup = buildPrefixLookup(list);
  return [...naturalOnly.keys()].map(prefix => fullLookup.get(prefix)).filter(Boolean)
    .sort((a, b) => b.ocorrencias - a.ocorrencias);
}

// Resolucao de ORIGEM com prioridade definitiva (nao configuravel):
//   1) Regra especifica da rota inteira (Base de CDs, correspondencia exata)
//   2) Prefixo da rota aprendido (do mais especifico ao mais generico)
//   3) Conflito de prefixo detectado -> sinalizado, nunca escolhido em silencio
//   4) Origem padrao (fallback) -> sinalizado como sem evidencia
// nomenclatureMap: Map<string, {cdCodigo, cdNome, status}> vindo da Base de CDs.
// prefixLookup: Map vindo de buildPrefixLookup(nomenclaturas), ja calculado.
function resolveOrigemForRota(rota, nomenclatureMap, prefixLookup, fallback) {
  const key = String(rota || '').trim().toUpperCase();
  const fromBase = nomenclatureMap ? nomenclatureMap.get(key) : null;
  if (fromBase && fromBase.status === 'ok' && fromBase.cdCodigo) {
    return { origem: fromBase.cdCodigo, fonte: 'rota_exata', cdNome: fromBase.cdNome || null };
  }

  if (prefixLookup) {
    const candidates = candidatePrefixesForRota(key);
    for (let i = 0; i < candidates.length; i++) {
      const info = prefixLookup.get(candidates[i]);
      if (!info) continue;
      if (info.conflito) {
        return {
          origem: fallback, fonte: 'conflito_prefixo', cdNome: null,
          prefixo: candidates[i], distribuicao: info.distribuicao, ocorrencias: info.ocorrencias
        };
      }
      return {
        origem: info.cdCodigo, fonte: i === 0 ? 'prefixo' : 'prefixo_geral', cdNome: info.cdNome,
        prefixo: candidates[i], confiancaPct: info.confiancaPct, ocorrencias: info.ocorrencias
      };
    }
  }

  if (fromBase && fromBase.status === 'conflito') {
    return { origem: fallback, fonte: 'conflito', cdNome: null };
  }
  return { origem: fallback, fonte: 'padrao', cdNome: null };
}

/* ------------------- Classificacao de operacao por Tipo de Veiculo -------- */
// Regra inferida da amostra real: todos os 27 blocos de rota do PDF de teste
// trazem "Tipo de Veiculo: MBR-..." (ex: MBR-CAR-FT, MBR-TRU-JD, MBR-3/4-FT),
// coerente com a nomenclatura Martin Brower citada pelo usuario (MB-3/4-FT).
// Fica como tabela editavel (igual ao mapeamento de ORIGEM) — o sistema NAO
// deve depender de um valor fixo, pois outros tipos de veiculo/operacoes
// podem aparecer em PDFs futuros que nao fizeram parte da amostra analisada.
const DEFAULT_VEHICLE_TYPE_RULES = [
  { pattern: 'MB', operacao: 'Martin Brower' }
];

function resolveOperacaoFromVehicleType(tipoVeiculo, rules) {
  if (!tipoVeiculo) return null;
  const upper = String(tipoVeiculo).toUpperCase();
  const list = rules && rules.length ? rules : DEFAULT_VEHICLE_TYPE_RULES;
  for (const rule of list) {
    if (rule.pattern && upper.startsWith(String(rule.pattern).toUpperCase())) return rule.operacao;
  }
  return null;
}

/* ============================================================================
 * EXTRACAO DO PDF
 * ==========================================================================*/

async function extractPdfRecords(pdfDoc, options, onProgress) {
  const opts = Object.assign({
    cdFaturamentoDefault: 'FT'
  }, options || {});

  const records = [];
  const warnings = [];
  const blocksInfo = [];
  let currentBlock = null; // {rota, carregDow, carregHour, faturamentoStr}
  let faturamentoStr = null;
  let cdFaturamento = opts.cdFaturamentoDefault;

  const numPages = pdfDoc.numPages;

  for (let p = 1; p <= numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const content = await page.getTextContent();

    const rowsMap = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] * 10) / 10;
      if (!rowsMap.has(y)) rowsMap.set(y, []);
      rowsMap.get(y).push({ x: item.transform[4], str: item.str.trim() });
    }
    const ys = [...rowsMap.keys()].sort((a, b) => b - a);

    for (const y of ys) {
      const items = rowsMap.get(y).sort((a, b) => a.x - b.x);
      const line = items.map(i => i.str).join(' ');

      // Faturamento (nivel documento)
      const fatMatch = line.match(/Faturamento:\s*(\d{2}\/\d{2}\/\d{2})/);
      if (fatMatch) faturamentoStr = fatMatch[1];

      // CD faturamento (ex: "CD: FT")
      const cdMatch = line.match(/CD:\s*([A-Z0-9]{2,5})/);
      if (cdMatch) cdFaturamento = cdMatch[1];

      // Cabecalho de bloco de rota: primeiro item perto de x=29 e linha contem Total/Congelado
      if (items.length >= 2 && Math.abs(items[0].x - 29) < 6 &&
          line.includes('Total') && line.includes('Congelado') && line.includes('Resfriado')) {
        currentBlock = {
          rota: items[0].str,
          page: p,
          faturamentoStr,
          carregDow: null,
          carregHour: null,
          tipoVeiculo: null,
          storeCount: 0
        };
        blocksInfo.push(currentBlock);
        continue;
      }

      // Linha "Carregamento: N.F HH:MM ... Tipo de Veículo: XXX"
      const cargaMatch = line.match(/Carregamento:\s*([1-7])\.F\s+(\d{2}:\d{2})/);
      if (cargaMatch && currentBlock) {
        currentBlock.carregDow = parseInt(cargaMatch[1], 10);
        currentBlock.carregHour = cargaMatch[2];
        const veiculoMatch = line.match(/Tipo de Ve[ií]culo:\s*(\S+)/i);
        if (veiculoMatch) currentBlock.tipoVeiculo = veiculoMatch[1];
        continue;
      }

      // Linha de loja: precisa de bloco ativo, item0 perto de x=20, e no minimo 16 tokens
      // [LOJA, LADO, DIA(N.F), HORA, CX,M3,KG (total), CX,M3,KG (cong), CX,M3,KG (resf), CX,M3,KG (seco)]
      if (currentBlock && items.length >= 15 && Math.abs(items[0].x - 20) < 6) {
        const loja = items[0].str;
        const dowItem = items.find((it, idx) => idx >= 1 && idx <= 3 && /^[1-7]\.F$/.test(it.str));
        if (!/^[A-Z0-9]{2,4}$/.test(loja) || !dowItem) continue; // nao parece linha de loja valida

        const dowIdx = items.indexOf(dowItem);
        const horaItem = items[dowIdx + 1];
        if (!horaItem || !/^\d{2}:\d{2}$/.test(horaItem.str)) continue;

        const numericItems = items.slice(dowIdx + 2).map(it => it.str);
        if (numericItems.length < 12) {
          warnings.push({ type: 'linha_incompleta', page: p, rota: currentBlock.rota, loja, detail: `Esperados 12 valores numericos, encontrados ${numericItems.length}` });
          continue;
        }

        const [totalCX, totalM3, totalKG,
               congCX, congM3, congKG,
               resfCX, resfM3, resfKG,
               secoCX, secoM3, secoKG] = numericItems;

        currentBlock.storeCount++;

        records.push({
          rota: currentBlock.rota,
          loja,
          page: p,
          diaSemanaEntrega: dowItem.str,
          horaEntregaStr: horaItem.str,
          faturamentoStr: currentBlock.faturamentoStr,
          _block: currentBlock, // resolvido em pos-processamento (Carregamento aparece DEPOIS das lojas no layout)
          caixasTotal: parseBRNumber(totalCX),
          m3Total: parseBRNumber(totalM3),
          kgTotal: parseBRNumber(totalKG),
          caixasCongelado: parseBRNumber(congCX),
          caixasResfriado: parseBRNumber(resfCX),
          caixasSeco: parseBRNumber(secoCX),
          cdFaturamento
        });
      }
    }
    if (onProgress) onProgress({ page: p, totalPages: numPages, recordsSoFar: records.length });
  }

  // pos-processamento: resolve carregDow/carregHour (a linha "Carregamento:" aparece
  // apos as lojas dentro do bloco, entao so pode ser lida ao final de cada bloco)
  for (const rec of records) {
    rec.carregDow = rec._block.carregDow;
    rec.carregHour = rec._block.carregHour;
    rec.tipoVeiculo = rec._block.tipoVeiculo;
    delete rec._block;
  }

  return { records, warnings, blocksInfo };
}

/* ============================================================================
 * NORMALIZACAO / VALIDACAO
 * ==========================================================================*/

function normalizeAndValidate(rawResult, options) {
  const opts = Object.assign({
    origemFallback: DEFAULT_ORIGEM_FALLBACK,
    nomenclatureMap: null, // Map<rota, {cdCodigo, cdNome, status}> vindo da Base de CDs (opcional)
    prefixLookup: null, // Map vindo de buildPrefixLookup(nomenclaturas) — aprendido, nao configuravel
    vehicleTypeRules: DEFAULT_VEHICLE_TYPE_RULES // regras editaveis de classificacao de operacao
  }, options || {});

  const normalized = [];
  const errors = [];
  const warnings = [...rawResult.warnings];
  const seenKeys = new Map();

  for (const rec of rawResult.records) {
    const rowErrors = [];

    if (!rec.rota) rowErrors.push('ROTA ausente');
    if (!rec.loja) rowErrors.push('LOJA ausente');
    if (rec.caixasTotal == null) rowErrors.push('Quantidade de caixas ausente/invalida');

    const fat = parseBRDateShortYear(rec.faturamentoStr);
    if (!fat) rowErrors.push(`Data de faturamento invalida: "${rec.faturamentoStr}"`);

    const dowMatch = /^([1-7])\.F$/.exec(rec.diaSemanaEntrega || '');
    const hEntrega = parseHourMinute(rec.horaEntregaStr);
    if (!dowMatch) rowErrors.push(`Dia da semana de entrega invalido: "${rec.diaSemanaEntrega}"`);
    if (!hEntrega) rowErrors.push(`Hora de entrega invalida: "${rec.horaEntregaStr}"`);

    let dataFaturamento = null, dataEntrega = null, dataCarregamento = null;
    if (fat) {
      dataFaturamento = makeUTCDate(fat.year, fat.month, fat.day);
      if (dowMatch) {
        dataEntrega = resolveWeekdayDate(dataFaturamento, parseInt(dowMatch[1], 10));
      }
      if (rec.carregDow) {
        dataCarregamento = resolveWeekdayDate(dataFaturamento, rec.carregDow);
      } else {
        warnings.push({ type: 'carregamento_ausente', rota: rec.rota, loja: rec.loja, detail: 'Bloco sem linha "Carregamento: N.F HH:MM" identificada; usando data de faturamento como fallback.' });
        dataCarregamento = dataFaturamento;
      }
    }

    const hCarreg = rec.carregHour ? parseHourMinute(rec.carregHour) : null;

    // consistencia: total = congelado + resfriado + seco (tolerancia de 1 unidade por arredondamento)
    if (rec.caixasTotal != null && rec.caixasCongelado != null && rec.caixasResfriado != null && rec.caixasSeco != null) {
      const soma = rec.caixasCongelado + rec.caixasResfriado + rec.caixasSeco;
      if (Math.abs(soma - rec.caixasTotal) > 1) {
        warnings.push({ type: 'inconsistencia_caixas', rota: rec.rota, loja: rec.loja, detail: `Total informado (${rec.caixasTotal}) difere da soma das categorias (${soma}).` });
      }
    }

    const origemInfo = resolveOrigemForRota(rec.rota, opts.nomenclatureMap, opts.prefixLookup, opts.origemFallback);
    const origem = origemInfo.origem;
    const tipoOperacao = `DISTR ${origem}`;

    if (origemInfo.fonte === 'conflito') {
      warnings.push({ type: 'origem_em_conflito', rota: rec.rota, loja: rec.loja, detail: `A rota "${rec.rota}" esta marcada como conflito na Base de CDs; usando origem padrao (${origem}) como alternativa. Resolva o conflito na Base de CDs.` });
    } else if (origemInfo.fonte === 'conflito_prefixo') {
      const dist = (origemInfo.distribuicao || []).map(d => `${d.codigo}: ${d.pct}%`).join(', ');
      warnings.push({ type: 'conflito_prefixo', rota: rec.rota, loja: rec.loja, detail: `Prefixo "${origemInfo.prefixo}" possui historico ambiguo (${dist}) — nao foi possivel determinar o CD com confianca; usando origem padrao (${origem}). Verifique o cadastro na Base de CDs.` });
    } else if (origemInfo.fonte === 'padrao') {
      warnings.push({ type: 'origem_nao_cadastrada', rota: rec.rota, loja: rec.loja, detail: `Rota "${rec.rota}" nao encontrada na Base de CDs (nem por correspondencia exata, nem por prefixo aprendido); usando origem padrao (${origem}). Importe a programacao do CD correto para ensinar o sistema.` });
    }

    const key = `${rec.rota}|${rec.loja}|${rec.faturamentoStr}`;
    if (seenKeys.has(key)) {
      warnings.push({ type: 'duplicado', rota: rec.rota, loja: rec.loja, detail: `Registro duplicado (rota+loja+faturamento) encontrado.` });
    }
    seenKeys.set(key, true);

    const record = {
      valido: rowErrors.length === 0,
      erros: rowErrors,
      tipoOperacao,
      cdFaturamento: rec.cdFaturamento,
      origem,
      origemFonte: origemInfo.fonte,
      origemPrefixo: origemInfo.prefixo || null,
      origemConfiancaPct: origemInfo.confiancaPct != null ? origemInfo.confiancaPct : null,
      origemOcorrencias: origemInfo.ocorrencias != null ? origemInfo.ocorrencias : null,
      dataFaturamento,
      rota: rec.rota,
      loja: rec.loja,
      dataCarregamento,
      horaCarregamento: hCarreg,
      dataEntrega,
      horaEntrega: hEntrega,
      caixas: rec.caixasTotal != null ? Math.round(rec.caixasTotal) : null,
      m3Total: rec.m3Total,
      kgTotal: rec.kgTotal,
      tipoVeiculo: rec.tipoVeiculo || null,
      operacao: resolveOperacaoFromVehicleType(rec.tipoVeiculo, opts.vehicleTypeRules),
      _raw: rec
    };

    if (rowErrors.length > 0) {
      errors.push({ rota: rec.rota, loja: rec.loja, page: rec.page, motivos: rowErrors });
    }
    normalized.push(record);
  }

  return { records: normalized, errors, warnings };
}

/* ============================================================================
 * GERACAO DO EXCEL FINAL (preserva estrutura, estilos e formulas do modelo)
 * ==========================================================================*/

// Excel serial-date base para valores "somente hora" (meia-noite de 1899-12-30)
function makeExcelTimeDate(h, m) {
  return new Date(Date.UTC(1899, 11, 30, h, m, 0));
}

// Cabecalhos esperados -> como preencher a celula para cada registro.
// Colunas nao listadas aqui e que nao sejam formula recebem o valor "padrao"
// (o mesmo valor ja presente na linha-modelo, ex: "-", "NÃO", 0, vazio).
function buildDataGetters() {
  return {
    'TIPO OPERACAO': rec => rec.tipoOperacao,
    'CD FATURAMENTO': rec => rec.cdFaturamento,
    'ORIGEM': rec => rec.origem,
    'DATA FATURAMENTO': rec => rec.dataFaturamento,
    'ROTA': rec => rec.rota,
    'LOJA': rec => rec.loja,
    'DATA CARREGAMENTO': rec => rec.dataCarregamento,
    'HORA CARREGAMENTO': rec => rec.horaCarregamento ? makeExcelTimeDate(rec.horaCarregamento.h, rec.horaCarregamento.m) : null,
    'DATA ENTREGA LOJA': rec => rec.dataEntrega,
    'HORA ENTREGA LOJA': rec => rec.horaEntrega ? makeExcelTimeDate(rec.horaEntrega.h, rec.horaEntrega.m) : null,
    'CAIXAS': rec => rec.caixas
  };
}

// Desloca referencias de celula relativas de uma formula em rowDelta linhas,
// preservando referencias absolutas ($lin) e ignorando trechos entre aspas
// (para nao alterar literais de texto como "dd/mm/aaaa").
function shiftFormula(formula, rowDelta) {
  if (!formula) return formula;
  const parts = formula.split('"');
  for (let i = 0; i < parts.length; i += 2) { // indices pares = fora de aspas
    parts[i] = parts[i].replace(/(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g, (whole, colDollar, col, rowDollar, row) => {
      if (rowDollar === '$') return whole; // referencia de linha absoluta: nao desloca
      const newRow = parseInt(row, 10) + rowDelta;
      return `${colDollar}${col}${rowDollar}${newRow}`;
    });
  }
  return parts.join('"');
}

function resolveMasterFormula(ws, cell) {
  if (!cell.value || typeof cell.value !== 'object') return null;
  if (cell.value.formula) return cell.value.formula;
  if (cell.value.sharedFormula) {
    const master = ws.getCell(cell.value.sharedFormula);
    return master.value && master.value.formula ? master.value.formula : null;
  }
  return null;
}

function cloneStyle(cell) {
  return {
    font: cell.font ? JSON.parse(JSON.stringify(cell.font)) : undefined,
    fill: cell.fill ? JSON.parse(JSON.stringify(cell.fill)) : undefined,
    alignment: cell.alignment ? JSON.parse(JSON.stringify(cell.alignment)) : undefined,
    border: cell.border ? JSON.parse(JSON.stringify(cell.border)) : undefined,
    numFmt: cell.numFmt
  };
}

function applyStyle(cell, style) {
  if (style.font) cell.font = style.font;
  if (style.fill) cell.fill = style.fill;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.border) cell.border = style.border;
  if (style.numFmt) cell.numFmt = style.numFmt;
}

/**
 * Constroi o workbook final a partir do modelo (buffer/arraybuffer) e dos
 * registros normalizados. Retorna { workbook, sheetName, headerMap, lastRow, analysis }.
 */
// Ordenacao definitiva e obrigatoria do Excel final (nao configuravel pelo
// usuario): 1) Data de Faturamento asc  2) Rota asc (numerico-aware)  3) Data
// de Entrega asc. Aplicada sempre sobre os registros ANTES de escrever no
// Excel — as formulas sao geradas a partir da posicao final de cada linha,
// entao a ordenacao nunca deixa uma formula "presa" na posicao antiga.
function sortRecordsForExcel(records) {
  return records.slice().sort((a, b) => {
    const fa = a.dataFaturamento ? a.dataFaturamento.getTime() : -Infinity;
    const fb = b.dataFaturamento ? b.dataFaturamento.getTime() : -Infinity;
    if (fa !== fb) return fa - fb;

    const ra = String(a.rota || '');
    const rb = String(b.rota || '');
    const cmpRota = ra.localeCompare(rb, undefined, { numeric: true, sensitivity: 'base' });
    if (cmpRota !== 0) return cmpRota;

    const ea = a.dataEntrega ? a.dataEntrega.getTime() : -Infinity;
    const eb = b.dataEntrega ? b.dataEntrega.getTime() : -Infinity;
    return ea - eb;
  });
}

async function buildExcelWorkbook(modelArrayBuffer, records, options) {
  const opts = Object.assign({ sheetName: null, templateRow: 2 }, options || {});
  records = sortRecordsForExcel(records); // ordenacao definitiva - sempre aplicada, nao e opcional

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(modelArrayBuffer);

  const ws = opts.sheetName ? wb.getWorksheet(opts.sheetName) : wb.worksheets[0];
  if (!ws) throw new Error('Nao foi possivel localizar a planilha de dados no arquivo-modelo.');

  const headerRowNum = 1;
  const templateRow = opts.templateRow; // linha usada como referencia de estilo/formula (linha 2 por padrao)
  const totalCols = ws.columnCount;

  // Mapa: nome do cabecalho (normalizado) -> indice da coluna
  const headerMap = {};
  const headerRow = ws.getRow(headerRowNum);
  for (let c = 1; c <= totalCols; c++) {
    const v = headerRow.getCell(c).value;
    if (v != null && String(v).trim() !== '') {
      headerMap[String(v).trim().toUpperCase()] = c;
    }
  }

  const dataGetters = buildDataGetters();
  const normalizedGetters = {};
  for (const [k, fn] of Object.entries(dataGetters)) normalizedGetters[k.toUpperCase()] = fn;

  // Classifica cada coluna: 'data' | 'formula' | 'default'
  const columnPlan = [];
  for (let c = 1; c <= totalCols; c++) {
    const headerText = Object.keys(headerMap).find(k => headerMap[k] === c) || null;
    const templateCell = ws.getRow(templateRow).getCell(c);
    const masterFormula = resolveMasterFormula(ws, templateCell);
    const style = cloneStyle(templateCell);

    if (masterFormula) {
      columnPlan.push({ col: c, kind: 'formula', header: headerText, masterFormula, style });
    } else if (headerText && normalizedGetters[headerText]) {
      columnPlan.push({ col: c, kind: 'data', header: headerText, getter: normalizedGetters[headerText], style });
    } else {
      columnPlan.push({ col: c, kind: 'default', header: headerText, defaultValue: templateCell.value, style });
    }
  }

  // Detecta ate onde a planilha ja tinha dados/formulas preenchidos anteriormente,
  // para podermos limpar sobras caso o novo PDF gere menos linhas que o arquivo tinha.
  let previousLastRow = headerRowNum;
  ws.eachRow((row, rn) => {
    if (rn === headerRowNum) return;
    let hasAny = false;
    for (let c = 1; c <= totalCols; c++) {
      if (row.getCell(c).value != null) { hasAny = true; break; }
    }
    if (hasAny) previousLastRow = rn;
  });

  const firstDataRow = headerRowNum + 1;
  const lastDataRow = firstDataRow + records.length - 1;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const r = firstDataRow + i;
    const row = ws.getRow(r);
    const rowDelta = r - templateRow;

    for (const plan of columnPlan) {
      const cell = row.getCell(plan.col);
      if (plan.kind === 'data') {
        cell.value = plan.getter(rec);
      } else if (plan.kind === 'formula') {
        cell.value = { formula: shiftFormula(plan.masterFormula, rowDelta) };
      } else {
        cell.value = plan.defaultValue != null && typeof plan.defaultValue === 'object' ? null : plan.defaultValue;
      }
      // garante formatacao mesmo em linhas alem do alcance original do modelo
      if (r > previousLastRow) applyStyle(cell, plan.style);
    }
    row.commit && row.commit();
  }

  // Limpa sobras de linhas antigas (caso o novo PDF tenha menos registros que o arquivo-modelo)
  for (let r = lastDataRow + 1; r <= previousLastRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= totalCols; c++) {
      row.getCell(c).value = null;
    }
  }

  // Atualiza intervalo do AutoFilter para cobrir exatamente os dados gerados
  if (ws.autoFilter) {
    const lastColLetter = ws.getColumn(totalCols).letter;
    ws.autoFilter = `A1:${lastColLetter}${Math.max(lastDataRow, firstDataRow)}`;
  }

  // Forca o Excel a recalcular todas as formulas na abertura do arquivo
  wb.calcProperties = wb.calcProperties || {};
  wb.calcProperties.fullCalcOnLoad = true;

  return {
    workbook: wb,
    sheetName: ws.name,
    headerMap,
    columnPlan,
    firstDataRow,
    lastDataRow,
    previousLastRow
  };
}

function generateFileName(records) {
  const pad = n => String(n).padStart(2, '0');
  let refDate = null;
  for (const r of records) {
    if (r.dataFaturamento) { refDate = r.dataFaturamento; break; }
  }
  const d = refDate || new Date();
  const dd = pad(d.getUTCDate ? d.getUTCDate() : d.getDate());
  const mm = pad((d.getUTCMonth ? d.getUTCMonth() : d.getMonth()) + 1);
  const yyyy = d.getUTCFullYear ? d.getUTCFullYear() : d.getFullYear();
  return `Programacao_Control_Tower_${dd}-${mm}-${yyyy}.xlsx`;
}

/* ============================================================================
 * BASE DE CDs E NOMENCLATURAS - deteccao de coluna e extracao de rotas
 * a partir de planilhas de programacao de outros CDs (importadas pelo usuario).
 * Funcoes puras (recebem uma worksheet ExcelJS ja carregada).
 * ==========================================================================*/

const ROUTE_CODE_REGEX = /^[A-Z]{2,4}\d{2,4}[A-Z]?$/;
const HEADER_HINT_REGEX = /nomenclatura|nomencl|^rota$|rota da|route|c[oó]d(igo)?\s*(da)?\s*rota/i;

function normalizeHeaderText(v) {
  return v == null ? '' : String(v).trim();
}

// Varre as primeiras linhas em busca da linha de cabecalho (a que tiver mais
// celulas de texto preenchidas, com preferencia para uma que contenha um
// termo como "rota"/"nomenclatura"/"route").
function detectHeaderRow(ws, maxScanRows) {
  const limit = Math.min(maxScanRows || 8, ws.rowCount || 8);
  let bestRow = 1, bestScore = -1, hintRow = null;
  for (let r = 1; r <= limit; r++) {
    const row = ws.getRow(r);
    let textCount = 0, hasHint = false;
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = normalizeHeaderText(row.getCell(c).value);
      if (v !== '') textCount++;
      if (HEADER_HINT_REGEX.test(v)) hasHint = true;
    }
    if (hasHint && hintRow == null) hintRow = r;
    if (textCount > bestScore) { bestScore = textCount; bestRow = r; }
  }
  return hintRow != null ? hintRow : bestRow;
}

// Analisa a worksheet e retorna a melhor estimativa de qual coluna contem a
// nomenclatura da rota, junto com os candidatos alternativos (para o usuario
// escolher manualmente quando a confianca for baixa).
function detectNomenclatureColumn(ws) {
  const headerRow = detectHeaderRow(ws);
  const lastDataRow = Math.min(ws.rowCount || headerRow, headerRow + 500);
  const totalCols = ws.columnCount || 1;

  const candidates = [];
  for (let c = 1; c <= totalCols; c++) {
    const headerText = normalizeHeaderText(ws.getRow(headerRow).getCell(c).value);
    let matched = 0, total = 0;
    for (let r = headerRow + 1; r <= lastDataRow; r++) {
      const raw = ws.getRow(r).getCell(c).value;
      const v = raw == null ? '' : String(raw).trim();
      if (v === '') continue;
      total++;
      if (ROUTE_CODE_REGEX.test(v.toUpperCase())) matched++;
    }
    const contentScore = total > 0 ? matched / total : 0;
    const headerMatches = HEADER_HINT_REGEX.test(headerText);
    candidates.push({ col: c, headerText, contentScore, headerMatches, sampleCount: total });
  }

  candidates.sort((a, b) => {
    if (a.headerMatches !== b.headerMatches) return a.headerMatches ? -1 : 1;
    return b.contentScore - a.contentScore;
  });

  const top = candidates[0];
  const second = candidates[1];
  let confidence = 'baixa';
  if (top) {
    if (top.headerMatches && top.contentScore >= 0.3) confidence = 'alta';
    else if (!top.headerMatches && top.contentScore >= 0.6 && (!second || top.contentScore - second.contentScore >= 0.25)) confidence = 'alta';
    else if (top.contentScore >= 0.3 || top.headerMatches) confidence = 'media';
  }

  return {
    headerRow,
    suggestedColumn: top ? top.col : null,
    confidence,
    candidates: candidates.slice(0, 8)
  };
}

// Extrai valores unicos (limpos) de uma coluna, a partir da linha seguinte ao cabecalho.
function extractUniqueColumnValues(ws, columnIndex, headerRow) {
  const lastRow = ws.rowCount || headerRow;
  const seen = new Set();
  const values = [];
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const raw = ws.getRow(r).getCell(columnIndex).value;
    let v = raw == null ? '' : String(raw).trim();
    if (v === '' || v === '-') continue;
    v = v.toUpperCase();
    if (seen.has(v)) continue;
    seen.add(v);
    values.push(v);
  }
  return values;
}

// Assinatura estavel da estrutura de cabecalho de um arquivo, usada para
// memorizar a escolha manual de coluna em importacoes futuras do mesmo layout.
function computeHeaderSignature(ws, headerRow) {
  const parts = [];
  for (let c = 1; c <= ws.columnCount; c++) {
    parts.push(normalizeHeaderText(ws.getRow(headerRow).getCell(c).value).toUpperCase());
  }
  return parts.join('|');
}

/* ============================================================================
 * INTELIGENCIA HISTORICA - deteccao de planilhas "ricas" (mesmo vocabulario de
 * cabecalhos do Excel-modelo oficial) e extracao de registros historicos,
 * incluindo o padrao de linha de retorno (LOJA === ORIGEM).
 * ==========================================================================*/

// Variantes de cabecalho aceitas por campo (todas em maiusculo, sem acento nao é necessário
// pois o Excel-modelo real ja usa esses nomes exatos; variantes cobrem pequenas divergencias).
const RICH_FIELD_HEADERS = {
  rota: ['ROTA'],
  loja: ['LOJA'],
  origem: ['ORIGEM'],
  dataCarregamento: ['DATA CARREGAMENTO'],
  horaCarregamento: ['HORA CARREGAMENTO'],
  dataEntrega: ['DATA ENTREGA LOJA', 'DATA ENTREGA'],
  horaEntrega: ['HORA ENTREGA LOJA', 'HORA ENTREGA'],
  caixas: ['CAIXAS'],
  tipoVeiculo: ['TIPO DE VEICULO', 'TIPO VEICULO', 'TIPO DE VEÍCULO'],
  dataFaturamento: ['DATA FATURAMENTO'],
  tipoOperacao: ['TIPO OPERACAO', 'TIPO OPERAÇÃO'],
  cdFaturamento: ['CD FATURAMENTO']
};
const RICH_REQUIRED_FIELDS = ['rota', 'loja', 'origem', 'dataCarregamento', 'horaCarregamento', 'caixas'];
const RICH_MIN_REQUIRED_MATCHES = 5; // de 6 campos essenciais

const COMBINING_DIACRITICS_REGEX = new RegExp('[\\u0300-\\u036f]', 'g');
function stripAccentsUpper(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(COMBINING_DIACRITICS_REGEX, '').toUpperCase().trim();
}

// Analisa os cabecalhos da worksheet e verifica se ela segue o mesmo vocabulario
// do Excel-modelo oficial (o suficiente para ser tratada como fonte historica rica,
// com padroes de carregamento e de retorno) — ou se e apenas uma planilha simples
// (nesse caso so a nomenclatura de rota e aproveitada, como ja acontecia antes).
function detectHistoricalColumns(ws) {
  const headerRow = detectHeaderRow(ws);
  const totalCols = ws.columnCount || 1;
  const headerRowObj = ws.getRow(headerRow);
  const colByHeader = new Map();
  for (let c = 1; c <= totalCols; c++) {
    const text = stripAccentsUpper(headerRowObj.getCell(c).value);
    if (text) colByHeader.set(text, c);
  }

  const fieldCols = {};
  for (const [field, variants] of Object.entries(RICH_FIELD_HEADERS)) {
    for (const variant of variants) {
      if (colByHeader.has(variant)) { fieldCols[field] = colByHeader.get(variant); break; }
    }
  }

  const matchedRequired = RICH_REQUIRED_FIELDS.filter(f => fieldCols[f] != null).length;
  const isRich = matchedRequired >= RICH_MIN_REQUIRED_MATCHES;

  return { headerRow, fieldCols, matchedRequired, isRich };
}

function excelTimeToHHMM(v) {
  if (v instanceof Date) return String(v.getUTCHours()).padStart(2, '0') + ':' + String(v.getUTCMinutes()).padStart(2, '0');
  if (typeof v === 'string' && /^\d{2}:\d{2}/.test(v)) return v.slice(0, 5);
  return null;
}
function excelDateToISO(v) {
  if (v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())).toISOString();
  return null;
}

// Extrai linhas "cruas" (uma por linha da planilha) usando as colunas detectadas por detectHistoricalColumns.
function extractRichRows(ws, detection) {
  const { headerRow, fieldCols } = detection;
  const lastRow = ws.rowCount || headerRow;
  const rows = [];
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const get = f => (fieldCols[f] != null ? row.getCell(fieldCols[f]).value : null);
    const rota = get('rota');
    if (rota == null || String(rota).trim() === '') continue;
    const loja = get('loja');
    const origem = get('origem');
    rows.push({
      rota: String(rota).trim().toUpperCase(),
      loja: loja != null ? String(loja).trim().toUpperCase() : null,
      origem: origem != null ? String(origem).trim().toUpperCase() : null,
      dataCarregamento: excelDateToISO(get('dataCarregamento')),
      horaCarregamento: excelTimeToHHMM(get('horaCarregamento')),
      dataEntrega: excelDateToISO(get('dataEntrega')),
      horaEntrega: excelTimeToHHMM(get('horaEntrega')),
      caixas: typeof get('caixas') === 'number' ? get('caixas') : null,
      tipoVeiculo: get('tipoVeiculo') != null ? String(get('tipoVeiculo')).trim() : null,
      dataFaturamento: excelDateToISO(get('dataFaturamento')),
      isReturnRow: !!(loja && origem && String(loja).trim().toUpperCase() === String(origem).trim().toUpperCase())
    });
  }
  return rows;
}

// Agrupa as linhas cruas por rota e produz registros de historico prontos para
// o IndexedDB: uma ocorrencia de "carregamento" e, quando ha evidencia (positiva
// OU negativa) de linha de retorno, uma ocorrencia de "retorno" por rota/arquivo.
function buildHistoricoRecordsFromRows(rows, meta) {
  const m = Object.assign({ origemArquivo: null, origemRegistro: 'excel_importado' }, meta || {});
  const now = new Date().toISOString();
  const byRota = new Map();
  rows.forEach(r => {
    if (!byRota.has(r.rota)) byRota.set(r.rota, []);
    byRota.get(r.rota).push(r);
  });

  const historico = [];
  for (const [rota, group] of byRota.entries()) {
    const reais = group.filter(r => !r.isReturnRow);
    const retornos = group.filter(r => r.isReturnRow);
    const base = reais[0] || group[0];

    if (reais.length > 0 && base.dataCarregamento) {
      historico.push({
        rota, cdCodigo: base.origem, tipoVeiculo: base.tipoVeiculo,
        kind: 'carregamento',
        dataCarregamento: base.dataCarregamento, horaCarregamento: base.horaCarregamento,
        origemArquivo: m.origemArquivo, origemRegistro: m.origemRegistro, criadoEm: now
      });
    }

    if (reais.length > 0) {
      if (retornos.length > 0) {
        const maxEntregaReal = reais.reduce((max, r) => {
          if (!r.dataEntrega) return max;
          return (!max || r.dataEntrega > max) ? r.dataEntrega : max;
        }, null);
        const retorno = retornos[0];
        let deltaDias = null;
        if (maxEntregaReal && retorno.dataEntrega) {
          deltaDias = Math.round((new Date(retorno.dataEntrega).getTime() - new Date(maxEntregaReal).getTime()) / 86400000);
        }
        historico.push({
          rota, cdCodigo: base.origem, tipoVeiculo: base.tipoVeiculo,
          kind: 'retorno', temRetorno: true,
          deltaDiasRetorno: deltaDias, horaRetorno: retorno.horaEntrega, caixasRetorno: retorno.caixas,
          origemArquivo: m.origemArquivo, origemRegistro: m.origemRegistro, criadoEm: now
        });
      } else {
        historico.push({
          rota, cdCodigo: base.origem, tipoVeiculo: base.tipoVeiculo,
          kind: 'retorno', temRetorno: false,
          deltaDiasRetorno: null, horaRetorno: null, caixasRetorno: null,
          origemArquivo: m.origemArquivo, origemRegistro: m.origemRegistro, criadoEm: now
        });
      }
    }
  }
  return historico;
}

/* ============================================================================
 * ESTATISTICAS COM CONFIANCA + CRIACAO AUTOMATICA DE LINHA DE RETORNO
 * ==========================================================================*/

// Peso por recencia: dados dos ultimos 30 dias pesam mais que dados antigos,
// mas nada e descartado (secao 22 do pedido do usuario).
function recencyWeight(isoDate) {
  if (!isoDate) return 1;
  const days = (Date.now() - new Date(isoDate).getTime()) / 86400000;
  if (days <= 30) return 2;
  if (days <= 180) return 1.5;
  return 1;
}

// Nao ha uma formula matematica exigida (secao 9) — apenas niveis compreensiveis.
function confidenceTier(count, predominantPct) {
  if (!count) return 'sem_evidencia';
  if (count >= 10 && predominantPct >= 0.7) return 'alta';
  if (count >= 4 && predominantPct >= 0.5) return 'media';
  return 'baixa';
}

function pickPredominant(items) {
  // items: [{value, weight}]
  const totals = new Map();
  for (const it of items) {
    if (it.value == null) continue;
    totals.set(it.value, (totals.get(it.value) || 0) + it.weight);
  }
  let best = null, bestW = -1;
  for (const [v, w] of totals.entries()) { if (w > bestW) { best = v; bestW = w; } }
  const totalW = [...totals.values()].reduce((a, b) => a + b, 0);
  return { value: best, weight: bestW, pct: totalW > 0 ? bestW / totalW : 0, totalWeight: totalW };
}

// Padrao de horario/dia de carregamento aprendido para uma rota (nivel 3 da
// hierarquia de confianca — usado apenas como fallback quando o PDF nao trouxer
// a informacao explicitamente). Quando a rota exata nunca apareceu no
// historico, cai para o "historico geral" do mesmo prefixo (secao 11/16 do
// pedido do usuario) — nunca inventa, apenas generaliza a partir de rotas
// irmãs do mesmo prefixo aprendido.
function computeRotaCarregamentoStats(historico, rota) {
  let occs = historico.filter(h => h.kind === 'carregamento' && h.rota === rota && h.horaCarregamento);
  let viaPrefix = false, prefixoUsado = null;

  if (occs.length === 0) {
    const prefix = derivePrefixFromRota(rota);
    occs = historico.filter(h => h.kind === 'carregamento' && h.horaCarregamento && derivePrefixFromRota(h.rota) === prefix);
    if (occs.length > 0) { viaPrefix = true; prefixoUsado = prefix; }
  }
  if (occs.length === 0) return { rota, count: 0, confidence: 'sem_evidencia' };

  const horaPick = pickPredominant(occs.map(o => ({ value: o.horaCarregamento, weight: recencyWeight(o.criadoEm) })));
  const veiculoPick = pickPredominant(occs.map(o => ({ value: o.tipoVeiculo, weight: recencyWeight(o.criadoEm) })));
  const ultimaOcorrencia = occs.reduce((max, o) => (!max || (o.dataCarregamento && o.dataCarregamento > max)) ? o.dataCarregamento : max, null);

  return {
    rota,
    count: occs.length,
    horaPredominante: horaPick.value,
    horaPredominantePct: horaPick.pct,
    tipoVeiculoPredominante: veiculoPick.value,
    ultimaOcorrencia,
    confidence: confidenceTier(occs.length, horaPick.pct),
    viaPrefix, prefixoUsado,
    ocorrencias: occs
  };
}

// Padrao de linha de retorno aprendido para uma rota (usado para decidir SE e
// COMO criar a linha de retorno automaticamente). Mesmo fallback por prefixo
// descrito acima — permite reconhecer o padrao de retorno de uma rota nunca
// vista antes, desde que o prefixo ja tenha evidencia (secao 16 do pedido).
function computeReturnPatternStats(historico, rota) {
  let occs = historico.filter(h => h.kind === 'retorno' && h.rota === rota);
  let viaPrefix = false, prefixoUsado = null;

  if (occs.length === 0) {
    const prefix = derivePrefixFromRota(rota);
    occs = historico.filter(h => h.kind === 'retorno' && derivePrefixFromRota(h.rota) === prefix);
    if (occs.length > 0) { viaPrefix = true; prefixoUsado = prefix; }
  }
  if (occs.length === 0) {
    return { rota, count: 0, hasEvidence: false, confidence: 'sem_evidencia', recomendaRetorno: false };
  }
  const comRetorno = occs.filter(o => o.temRetorno);
  const semRetorno = occs.filter(o => !o.temRetorno);
  const pctComRetorno = comRetorno.length / occs.length;

  const deltaPick = pickPredominant(comRetorno.map(o => ({ value: o.deltaDiasRetorno, weight: recencyWeight(o.criadoEm) })));
  const horaPick = pickPredominant(comRetorno.map(o => ({ value: o.horaRetorno, weight: recencyWeight(o.criadoEm) })));

  return {
    rota,
    count: occs.length,
    comRetorno: comRetorno.length,
    semRetorno: semRetorno.length,
    pctComRetorno,
    hasEvidence: true,
    recomendaRetorno: comRetorno.length > semRetorno.length,
    deltaDiasPredominante: deltaPick.value,
    horaRetornoPredominante: horaPick.value,
    confidence: confidenceTier(occs.length, pctComRetorno),
    viaPrefix, prefixoUsado
  };
}

// Cria registros de "linha de retorno" para rotas classificadas como operacao
// Martin Brower (ou outra operacao mapeada) que possuam evidencia historica de
// retorno e que AINDA NAO tenham uma linha de retorno no proprio PDF processado.
// Nunca inventa retorno sem evidencia (secao 8/12/28 do pedido do usuario).
function buildAutoReturnRecords(records, historico, options) {
  const opts = Object.assign({ operacoesAlvo: ['Martin Brower'] }, options || {});
  const results = [];
  const byRota = new Map();
  records.forEach(r => {
    if (!r.valido || !r.rota) return;
    if (!byRota.has(r.rota)) byRota.set(r.rota, []);
    byRota.get(r.rota).push(r);
  });

  for (const [rota, group] of byRota.entries()) {
    const jaTemRetorno = group.some(r => r.loja && r.origem && String(r.loja).toUpperCase() === String(r.origem).toUpperCase());
    if (jaTemRetorno) continue; // secao 15: nunca duplicar

    const base = group[0];
    if (!base.operacao || !opts.operacoesAlvo.includes(base.operacao)) continue;

    const stats = computeReturnPatternStats(historico, rota);
    if (!stats.hasEvidence || !stats.recomendaRetorno) continue;
    if (stats.deltaDiasPredominante == null || !stats.horaRetornoPredominante) continue;

    const maxEntrega = group.reduce((max, r) => (!max || (r.dataEntrega && r.dataEntrega.getTime() > max.getTime())) ? r.dataEntrega : max, null);
    if (!maxEntrega) continue;

    const dataEntregaRetorno = new Date(maxEntrega.getTime() + stats.deltaDiasPredominante * 86400000);
    const horaMatch = /^(\d{2}):(\d{2})$/.exec(stats.horaRetornoPredominante);
    const horaObj = horaMatch ? { h: parseInt(horaMatch[1], 10), m: parseInt(horaMatch[2], 10) } : null;
    if (!horaObj) continue;

    const confiancaPct = Math.round(stats.pctComRetorno * 100);
    results.push({
      valido: true, erros: [],
      tipoOperacao: base.tipoOperacao, cdFaturamento: base.cdFaturamento, origem: base.origem, origemFonte: base.origemFonte,
      dataFaturamento: base.dataFaturamento, rota, loja: base.origem,
      dataCarregamento: base.dataCarregamento, horaCarregamento: base.horaCarregamento,
      dataEntrega: dataEntregaRetorno, horaEntrega: horaObj,
      caixas: 0, m3Total: 0, kgTotal: 0,
      tipoVeiculo: base.tipoVeiculo, operacao: base.operacao,
      _auto: {
        tipo: 'retorno_automatico',
        confianca: stats.confidence,
        confiancaPct,
        baseOcorrencias: stats.count,
        comRetorno: stats.comRetorno,
        semRetorno: stats.semRetorno,
        deltaDias: stats.deltaDiasPredominante,
        horaRetorno: stats.horaRetornoPredominante,
        viaPrefix: stats.viaPrefix, prefixoUsado: stats.prefixoUsado,
        motivo: stats.viaPrefix
          ? `Rota "${rota}" nunca apareceu no historico, mas seu prefixo "${stats.prefixoUsado}" possui ${stats.count} ocorrencia(s) historica(s) de outras rotas (${base.operacao}); ${stats.comRetorno} apresentaram linha de retorno ao CD (confianca ${stats.confidence}, ${confiancaPct}%). Horario de retorno predominante: ${stats.horaRetornoPredominante}, ${stats.deltaDiasPredominante} dia(s) apos a ultima entrega nesta programacao.`
          : `Rota "${rota}" (${base.operacao}) possui ${stats.count} ocorrencia(s) historica(s) analisada(s); ${stats.comRetorno} apresentaram linha de retorno ao CD (confianca ${stats.confidence}, ${confiancaPct}%). Horario de retorno predominante: ${stats.horaRetornoPredominante}, ${stats.deltaDiasPredominante} dia(s) apos a ultima entrega da rota nesta programacao.`
      }
    });
  }
  return results;
}

// Registros de historico de "carregamento" a partir de um PDF ja processado
// (o PDF nunca traz linha de retorno — ver secao "linha de retorno" da analise
// do modelo — entao so alimenta o padrao de horario/data de carregamento).
function buildHistoricoFromPdfRecords(records, meta) {
  const m = Object.assign({ origemArquivo: null, origemRegistro: 'pdf' }, meta || {});
  const now = new Date().toISOString();
  const byRota = new Map();
  records.forEach(r => {
    if (!r.valido || !r.rota || byRota.has(r.rota)) return;
    byRota.set(r.rota, r);
  });
  const out = [];
  for (const [rota, r] of byRota.entries()) {
    if (!r.dataCarregamento || !r.horaCarregamento) continue;
    const horaStr = String(r.horaCarregamento.h).padStart(2, '0') + ':' + String(r.horaCarregamento.m).padStart(2, '0');
    out.push({
      rota, cdCodigo: r.origem, tipoVeiculo: r.tipoVeiculo,
      kind: 'carregamento',
      dataCarregamento: r.dataCarregamento.toISOString(), horaCarregamento: horaStr,
      origemArquivo: m.origemArquivo, origemRegistro: m.origemRegistro, criadoEm: now
    });
  }
  return out;
}

if (typeof module !== 'undefined') {
  module.exports = {
    brDowToJsDow, parseBRDateShortYear, makeUTCDate, resolveWeekdayDate, parseHourMinute,
    parseBRNumber, resolveOrigemForRota, DEFAULT_ORIGEM_FALLBACK,
    derivePrefixFromRota, candidatePrefixesForRota, buildPrefixLookup, buildPrefixDisplayTable,
    resolveOperacaoFromVehicleType, DEFAULT_VEHICLE_TYPE_RULES,
    extractPdfRecords, normalizeAndValidate,
    makeExcelTimeDate, shiftFormula, resolveMasterFormula, sortRecordsForExcel, buildExcelWorkbook, generateFileName,
    ROUTE_CODE_REGEX, detectHeaderRow, detectNomenclatureColumn, extractUniqueColumnValues, computeHeaderSignature,
    detectHistoricalColumns, extractRichRows, buildHistoricoRecordsFromRows, RICH_FIELD_HEADERS,
    recencyWeight, confidenceTier, pickPredominant, computeRotaCarregamentoStats, computeReturnPatternStats, buildAutoReturnRecords,
    buildHistoricoFromPdfRecords
  };
}
