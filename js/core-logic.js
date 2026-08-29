/* ============================================================================
 * CORE LOGIC - Control Tower / Gerador de Programacao
 * Funcoes puras, sem dependencia de Node ou de browser especificamente.
 * Reutilizavel tanto em teste (Node) quanto no index.html final.
 * Depende apenas de: pdfjsLib (global) e ExcelJS (global) quando usado no
 * browser, e de PREFIXO_CD_TRANSPORTADORA (global, definido em
 * data/prefixo_cd_transportadora.js) para o reconhecimento de origem.
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

// Aceita tanto o formato numerico "N.F" (2.F=segunda ... 6.F=sexta, e por
// extensao 1.F=domingo/7.F=sabado caso apareçam) quanto as abreviacoes
// "Sab"/"Sáb" e "Dom" usadas pelo PDF para fim de semana. Sem isso, TODAS as
// linhas de loja e blocos de carregamento cujo dia e sabado ou domingo eram
// descartados silenciosamente (falha real encontrada na amostra do PDF).
// Retorna o digito BR (1-7) ou null se o token nao for um dia reconhecido.
function parseDiaSemanaToken(token) {
  const t = String(token == null ? '' : token).trim();
  const mNum = /^([1-7])\.F$/i.exec(t);
  if (mNum) return parseInt(mNum[1], 10);
  if (/^s[aá]b\.?$/i.test(t)) return 7; // sabado
  if (/^dom\.?$/i.test(t)) return 1; // domingo
  return null;
}

// Procura o token de dia da semana de uma linha de loja dentro de
// items[startIdx..endIdx] e retorna tambem a hora de entrega. O PDF nem
// sempre separa dia e hora em dois itens de texto distintos: para os dias
// "3.F".."6.F" eles normalmente vem separados ("3.F" depois "07:00"), mas
// para "Sab"/"Dom" o gerador do PDF por vezes emite os dois JUNTOS num unico
// fragmento de texto ("Dom 08:00"). As duas formas sao aceitas aqui.
// Retorna null se nenhum token de dia reconhecido for encontrado no
// intervalo, ou se a hora correspondente nao puder ser determinada.
function parseDiaHoraToken(items, startIdx, endIdx) {
  for (let idx = startIdx; idx <= endIdx && idx < items.length; idx++) {
    const raw = String(items[idx].str || '').trim();
    const merged = /^([1-7]\.F|s[aá]b\.?|dom\.?)\s+(\d{2}:\d{2})$/i.exec(raw);
    if (merged) {
      const dow = parseDiaSemanaToken(merged[1]);
      if (dow != null) return { dow, diaStr: merged[1], hora: merged[2], dowIdx: idx, horaNoProximoItem: false };
    }
    const dow = parseDiaSemanaToken(raw);
    if (dow != null) {
      const next = items[idx + 1];
      if (next && /^\d{2}:\d{2}$/.test(String(next.str || '').trim())) {
        return { dow, diaStr: raw, hora: next.str.trim(), dowIdx: idx, horaNoProximoItem: true };
      }
    }
  }
  return null;
}

// Faixas de coordenada X (no espaco de coordenadas do PDF) de cada categoria
// de quantidade (Total/Congelado/Resfriado/Seco) numa linha de loja, com
// folga generosa entre elas. Calibradas a partir do layout fixo deste
// relatorio (colunas "CX M3 KG" repetidas 4x). Usadas para localizar os
// valores por POSICAO em vez de por contagem sequencial, porque quando uma
// categoria inteira e zero o PDF a comprime num unico valor (ver
// resolveCategoryValues) e a contagem total de itens deixa de ser fixa.
const CATEGORY_X_BOUNDS = [
  { name: 'total', min: -Infinity, max: 305 },
  { name: 'congelado', min: 305, max: 401 },
  { name: 'resfriado', min: 401, max: 496 },
  { name: 'seco', min: 496, max: Infinity }
];

function bucketNumericItemsByCategoryX(items) {
  const buckets = { total: [], congelado: [], resfriado: [], seco: [] };
  for (const it of items) {
    const band = CATEGORY_X_BOUNDS.find(b => it.x >= b.min && it.x < b.max);
    if (band) buckets[band.name].push(it.str);
  }
  return buckets;
}

// Converte os tokens encontrados numa categoria em {cx, m3, kg}. O caso
// normal traz 3 valores; quando a categoria inteira e zero, o PDF imprime um
// unico valor (tipicamente "0,0") no lugar dos 3 - nesse caso CX e KG sao
// tratados como zero e o unico valor encontrado e usado como M3.
function resolveCategoryValues(tokens) {
  if (tokens.length >= 3) return { cx: tokens[0], m3: tokens[1], kg: tokens[2] };
  if (tokens.length === 1) return { cx: '0', m3: tokens[0], kg: '0' };
  return { cx: '0', m3: '0', kg: '0' };
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

/* ============================================================================
 * RECONHECIMENTO DE ORIGEM E TRANSPORTADORA - fonte unica: tabela de
 * referencia (Prefixo -> CD -> Transportadora), fornecida pelo usuario e
 * embutida em data/prefixo_cd_transportadora.js. Substitui integralmente o
 * antigo mecanismo de "aprendizado" a partir de planilhas importadas.
 * ==========================================================================*/
const DEFAULT_ORIGEM_FALLBACK = 'CDFT';

// Carrega a tabela global de forma preguicosa (funciona tanto se o arquivo de
// dados for carregado antes ou depois deste, e tambem em testes Node onde a
// tabela pode ser atribuida a global.PREFIXO_CD_TRANSPORTADORA manualmente).
let _prefixoLookupMap = null;
function getPrefixoLookupMap() {
  if (!_prefixoLookupMap) {
    _prefixoLookupMap = new Map();
    const table = (typeof PREFIXO_CD_TRANSPORTADORA !== 'undefined' && PREFIXO_CD_TRANSPORTADORA)
      ? PREFIXO_CD_TRANSPORTADORA
      : (typeof global !== 'undefined' && global.PREFIXO_CD_TRANSPORTADORA) || [];
    table.forEach(e => _prefixoLookupMap.set(String(e.prefixo).toUpperCase(), e));
  }
  return _prefixoLookupMap;
}
// Uso exclusivo de testes: permite forcar a releitura da tabela.
function _resetPrefixoLookupMapForTests() { _prefixoLookupMap = null; }

function derivePrefixFromRota(rota) {
  const upper = String(rota || '').toUpperCase();
  const m = upper.match(/^[A-Z]+/);
  return m ? m[0] : upper.slice(0, 2);
}

// Consulta direta na tabela de referencia pelo prefixo alfabetico da rota.
// Retorna { prefixo, cd, transportadora } ou null se o prefixo nao constar.
function resolveOrigemPorPrefixo(rota) {
  const prefix = derivePrefixFromRota(rota);
  return getPrefixoLookupMap().get(prefix) || null;
}

// Resolucao definitiva de ORIGEM + TRANSPORTADORA (nao configuravel pelo
// usuario, nao depende de nenhum campo do PDF): consulta unica na tabela de
// referencia pelo prefixo da rota. Quando o prefixo nao consta na tabela,
// usa a origem padrao (fallback) e sinaliza o caso na validacao - nunca
// escolhe uma origem "no escuro".
function resolveOrigemForRota(rota, fallback) {
  const info = resolveOrigemPorPrefixo(rota);
  if (info) {
    return { origem: info.cd, transportadora: info.transportadora, fonte: 'tabela_prefixo', prefixo: info.prefixo };
  }
  return { origem: fallback, transportadora: null, fonte: 'padrao', prefixo: derivePrefixFromRota(rota) };
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

      // Linha "Carregamento: <dia> HH:MM ... Tipo de Veículo: XXX" - <dia> aceita
      // tanto "N.F" quanto "Sab"/"Dom" (ver parseDiaSemanaToken).
      const cargaMatch = line.match(/Carregamento:\s*(\S+)\s+(\d{2}:\d{2})/);
      if (cargaMatch && currentBlock) {
        const dowDigit = parseDiaSemanaToken(cargaMatch[1]);
        if (dowDigit != null) {
          currentBlock.carregDow = dowDigit;
          currentBlock.carregHour = cargaMatch[2];
        }
        const veiculoMatch = line.match(/Tipo de Ve[ií]culo:\s*(\S+)/i);
        if (veiculoMatch) currentBlock.tipoVeiculo = veiculoMatch[1];
        continue;
      }

      // Linha de loja: precisa de bloco ativo, item0 perto de x=20.
      // Estrutura variavel: [LOJA, (LADO opcional), DIA(+HORA opcionalmente
      // fundidos no mesmo item), (HORA se nao fundida), 12 valores numericos].
      // O PDF as vezes emite dia+hora como um unico fragmento de texto (ex:
      // "Dom 08:00") quando o dia e "Sab"/"Dom", em vez de dois itens
      // separados como no formato numerico ("3.F" + "07:00") - por isso a
      // busca abaixo aceita as duas formas (ver parseDiaHoraToken). Antes
      // desta correcao, isso fazia com que rotas inteiras com entrega aos
      // sabados/domingos fossem descartadas silenciosamente.
      if (currentBlock && items.length >= 8 && Math.abs(items[0].x - 20) < 6) {
        const loja = items[0].str;
        if (!/^[A-Z0-9]{2,4}$/.test(loja)) continue; // nao parece linha de loja valida

        const parsedDia = parseDiaHoraToken(items, 1, 3);
        if (!parsedDia) continue;

        const numStartIdx = parsedDia.dowIdx + (parsedDia.horaNoProximoItem ? 2 : 1);
        const numericTail = items.slice(numStartIdx);
        // Normalmente cada categoria (Total/Congelado/Resfriado/Seco) traz 3
        // valores (CX, M3, KG). Porem quando uma categoria inteira e zero, o
        // PDF a "comprime" num unico valor (ex: "0,0") em vez dos 3 -
        // por isso a leitura usa a posicao X de cada valor (coluna) em vez de
        // uma contagem sequencial fixa de 12 itens; do contrario, linhas com
        // alguma categoria zerada eram descartadas silenciosamente.
        const buckets = bucketNumericItemsByCategoryX(numericTail);
        if (buckets.total.length === 0) {
          warnings.push({ type: 'linha_incompleta', page: p, rota: currentBlock.rota, loja, detail: `Nao foi possivel localizar os valores de caixas/m3/kg (categoria Total) na linha.` });
          continue;
        }

        const totalVals = resolveCategoryValues(buckets.total);
        const congVals = resolveCategoryValues(buckets.congelado);
        const resfVals = resolveCategoryValues(buckets.resfriado);
        const secoVals = resolveCategoryValues(buckets.seco);

        currentBlock.storeCount++;

        records.push({
          rota: currentBlock.rota,
          loja,
          page: p,
          diaSemanaEntrega: parsedDia.diaStr,
          horaEntregaStr: parsedDia.hora,
          faturamentoStr: currentBlock.faturamentoStr,
          _block: currentBlock, // resolvido em pos-processamento (Carregamento aparece DEPOIS das lojas no layout)
          caixasTotal: parseBRNumber(totalVals.cx),
          m3Total: parseBRNumber(totalVals.m3),
          kgTotal: parseBRNumber(totalVals.kg),
          caixasCongelado: parseBRNumber(congVals.cx),
          caixasResfriado: parseBRNumber(resfVals.cx),
          caixasSeco: parseBRNumber(secoVals.cx),
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
    origemFallback: DEFAULT_ORIGEM_FALLBACK
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

    const dowDigit = parseDiaSemanaToken(rec.diaSemanaEntrega);
    const hEntrega = parseHourMinute(rec.horaEntregaStr);
    if (dowDigit == null) rowErrors.push(`Dia da semana de entrega invalido: "${rec.diaSemanaEntrega}"`);
    if (!hEntrega) rowErrors.push(`Hora de entrega invalida: "${rec.horaEntregaStr}"`);

    let dataFaturamento = null, dataEntrega = null, dataCarregamento = null;
    if (fat) {
      dataFaturamento = makeUTCDate(fat.year, fat.month, fat.day);
      if (dowDigit != null) {
        dataEntrega = resolveWeekdayDate(dataFaturamento, dowDigit);
      }
      if (rec.carregDow) {
        dataCarregamento = resolveWeekdayDate(dataFaturamento, rec.carregDow);
      } else {
        warnings.push({ type: 'carregamento_ausente', rota: rec.rota, loja: rec.loja, detail: 'Bloco sem linha "Carregamento: <dia> HH:MM" identificada; usando data de faturamento como fallback.' });
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

    const origemInfo = resolveOrigemForRota(rec.rota, opts.origemFallback);
    const origem = origemInfo.origem;
    const tipoOperacao = `DISTR ${origem}`;

    if (origemInfo.fonte === 'padrao') {
      warnings.push({ type: 'prefixo_nao_cadastrado', rota: rec.rota, loja: rec.loja, detail: `Prefixo "${origemInfo.prefixo}" (rota "${rec.rota}") nao consta na tabela de referencia de CD/transportadora; usando origem padrao (${origem}). Atualize a tabela em "data/prefixo_cd_transportadora.js" se este prefixo for valido.` });
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
      transportadora: origemInfo.transportadora || null,
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
// Excel - as formulas sao geradas a partir da posicao final de cada linha,
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
 * HISTORICO / PADRAO DE RETORNO - usado exclusivamente para decidir SE e a
 * QUE HORA/DEFASAGEM criar automaticamente uma linha de retorno ao CD, para
 * rotas cuja transportadora (tabela de referencia) esteja marcada como
 * elegivel (ver AUTO_RETURN_TRANSPORTADORAS). O historico e alimentado
 * automaticamente pelos proprios PDFs processados (padrao de carregamento) e
 * por uma carga inicial embutida (data/backup_data.js), sem nenhuma tela de
 * importacao dedicada.
 * ==========================================================================*/

// Peso por recencia: dados dos ultimos 30 dias pesam mais que dados antigos,
// mas nada e descartado.
function recencyWeight(isoDate) {
  if (!isoDate) return 1;
  const days = (Date.now() - new Date(isoDate).getTime()) / 86400000;
  if (days <= 30) return 2;
  if (days <= 180) return 1.5;
  return 1;
}

// Nao ha uma formula matematica exigida - apenas niveis compreensiveis.
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

// Padrao de linha de retorno aprendido para uma rota (usado para decidir SE e
// COMO criar a linha de retorno automaticamente). Quando a rota exata nunca
// apareceu no historico, cai para o "historico geral" do mesmo prefixo -
// nunca inventa, apenas generaliza a partir de rotas irmas do mesmo prefixo.
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

// Transportadoras cujas rotas sao elegiveis para criacao automatica de linha
// de retorno ao CD (consultado na tabela de referencia por prefixo - nunca
// mais a partir do "Tipo de Veiculo" ou do campo "Transportadora" do PDF).
const AUTO_RETURN_TRANSPORTADORAS = ['MARTIN BROWER'];

// Cria registros de "linha de retorno" para rotas cuja transportadora (tabela
// de referencia) seja elegivel e que possuam evidencia historica de retorno,
// e que AINDA NAO tenham uma linha de retorno no proprio PDF processado.
// Nunca inventa retorno sem evidencia historica de horario/defasagem.
function buildAutoReturnRecords(records, historico, options) {
  const opts = Object.assign({ transportadorasAlvo: AUTO_RETURN_TRANSPORTADORAS }, options || {});
  const results = [];
  const byRota = new Map();
  records.forEach(r => {
    if (!r.valido || !r.rota) return;
    if (!byRota.has(r.rota)) byRota.set(r.rota, []);
    byRota.get(r.rota).push(r);
  });

  for (const [rota, group] of byRota.entries()) {
    const jaTemRetorno = group.some(r => r.loja && r.origem && String(r.loja).toUpperCase() === String(r.origem).toUpperCase());
    if (jaTemRetorno) continue; // nunca duplicar

    const base = group[0];
    const transportadora = base.transportadora;
    if (!transportadora || !opts.transportadorasAlvo.includes(transportadora)) continue;

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
      transportadora: base.transportadora,
      dataFaturamento: base.dataFaturamento, rota, loja: base.origem,
      dataCarregamento: base.dataCarregamento, horaCarregamento: base.horaCarregamento,
      dataEntrega: dataEntregaRetorno, horaEntrega: horaObj,
      caixas: 0, m3Total: 0, kgTotal: 0,
      tipoVeiculo: base.tipoVeiculo,
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
          ? `Rota "${rota}" nunca apareceu no historico, mas seu prefixo "${stats.prefixoUsado}" possui ${stats.count} ocorrencia(s) historica(s) de outras rotas da transportadora ${transportadora}; ${stats.comRetorno} apresentaram linha de retorno ao CD (confianca ${stats.confidence}, ${confiancaPct}%). Horario de retorno predominante: ${stats.horaRetornoPredominante}, ${stats.deltaDiasPredominante} dia(s) apos a ultima entrega nesta programacao.`
          : `Rota "${rota}" (transportadora ${transportadora}) possui ${stats.count} ocorrencia(s) historica(s) analisada(s); ${stats.comRetorno} apresentaram linha de retorno ao CD (confianca ${stats.confidence}, ${confiancaPct}%). Horario de retorno predominante: ${stats.horaRetornoPredominante}, ${stats.deltaDiasPredominante} dia(s) apos a ultima entrega da rota nesta programacao.`
      }
    });
  }
  return results;
}

// Registros de historico de "carregamento" a partir de um PDF ja processado
// (o PDF nunca traz linha de retorno, entao so alimenta o padrao de
// horario/data de carregamento - o padrao de RETORNO depende da carga
// inicial embutida em data/backup_data.js).
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
    brDowToJsDow, parseBRDateShortYear, makeUTCDate, resolveWeekdayDate, parseHourMinute, parseDiaSemanaToken, parseDiaHoraToken,
    parseBRNumber, resolveOrigemForRota, resolveOrigemPorPrefixo, DEFAULT_ORIGEM_FALLBACK,
    derivePrefixFromRota, getPrefixoLookupMap, _resetPrefixoLookupMapForTests,
    bucketNumericItemsByCategoryX, resolveCategoryValues,
    extractPdfRecords, normalizeAndValidate,
    makeExcelTimeDate, shiftFormula, resolveMasterFormula, sortRecordsForExcel, buildExcelWorkbook, generateFileName,
    recencyWeight, confidenceTier, pickPredominant, computeReturnPatternStats, buildAutoReturnRecords,
    AUTO_RETURN_TRANSPORTADORAS, buildHistoricoFromPdfRecords
  };
}
