/* ============================================================================
 * DB - camada de persistencia (IndexedDB) da Base de CDs e Nomenclaturas.
 * Modulo isolado, so usado pelo app.js (nunca pelo core-logic.js, que precisa
 * continuar testavel em Node sem depender de browser).
 * ==========================================================================*/

const CTDB = (function () {
  'use strict';

  const DB_NAME = 'control_tower_db';
  const DB_VERSION = 2;
  const STORE_CDS = 'cds';
  const STORE_NOMENCLATURAS = 'nomenclaturas';
  const STORE_META = 'meta';
  const STORE_HISTORICO = 'historico';
  const STORE_VEHICLE_RULES = 'vehicleTypeRules';

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CDS)) {
          const cdsStore = db.createObjectStore(STORE_CDS, { keyPath: 'id', autoIncrement: true });
          cdsStore.createIndex('codigo', 'codigo', { unique: true });
        }
        if (!db.objectStoreNames.contains(STORE_NOMENCLATURAS)) {
          const nStore = db.createObjectStore(STORE_NOMENCLATURAS, { keyPath: 'nomenclatura' });
          nStore.createIndex('cdCodigo', 'cdCodigo', { unique: false });
          nStore.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_HISTORICO)) {
          const hStore = db.createObjectStore(STORE_HISTORICO, { keyPath: 'id', autoIncrement: true });
          hStore.createIndex('rota', 'rota', { unique: false });
          hStore.createIndex('cdCodigo', 'cdCodigo', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_VEHICLE_RULES)) {
          db.createObjectStore(STORE_VEHICLE_RULES, { keyPath: 'pattern' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Abertura do banco local bloqueada (outra aba aberta?).'));
    });
    return dbPromise;
  }

  function tx(storeNames, mode) {
    return openDb().then(db => db.transaction(storeNames, mode));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /* ------------------------------ CDs ------------------------------- */

  async function getAllCDs() {
    const t = await tx([STORE_CDS], 'readonly');
    return reqToPromise(t.objectStore(STORE_CDS).getAll());
  }

  async function getCDByCodigo(codigo) {
    const cds = await getAllCDs();
    return cds.find(c => c.codigo === codigo) || null;
  }

  async function putCD(cd) {
    const now = new Date().toISOString();
    const existing = cd.id ? null : await getCDByCodigo(cd.codigo);
    const record = existing
      ? Object.assign({}, existing, cd, { ultimaAtualizacao: now })
      : Object.assign({ dataCadastro: now, ultimaAtualizacao: now }, cd);
    const t = await tx([STORE_CDS], 'readwrite');
    const id = await reqToPromise(t.objectStore(STORE_CDS).put(record));
    return Object.assign({}, record, { id });
  }

  async function deleteCD(id) {
    const t = await tx([STORE_CDS], 'readwrite');
    await reqToPromise(t.objectStore(STORE_CDS).delete(id));
  }

  /* -------------------------- Nomenclaturas -------------------------- */

  async function getAllNomenclaturas() {
    const t = await tx([STORE_NOMENCLATURAS], 'readonly');
    return reqToPromise(t.objectStore(STORE_NOMENCLATURAS).getAll());
  }

  async function getNomenclatura(nomenclatura) {
    const t = await tx([STORE_NOMENCLATURAS], 'readonly');
    return reqToPromise(t.objectStore(STORE_NOMENCLATURAS).get(nomenclatura));
  }

  async function putNomenclatura(rec) {
    const t = await tx([STORE_NOMENCLATURAS], 'readwrite');
    await reqToPromise(t.objectStore(STORE_NOMENCLATURAS).put(rec));
    return rec;
  }

  async function putNomenclaturasBulk(records) {
    const t = await tx([STORE_NOMENCLATURAS], 'readwrite');
    const store = t.objectStore(STORE_NOMENCLATURAS);
    await Promise.all(records.map(r => reqToPromise(store.put(r))));
  }

  async function deleteNomenclatura(nomenclatura) {
    const t = await tx([STORE_NOMENCLATURAS], 'readwrite');
    await reqToPromise(t.objectStore(STORE_NOMENCLATURAS).delete(nomenclatura));
  }

  async function deleteNomenclaturasBulk(nomenclaturas) {
    const t = await tx([STORE_NOMENCLATURAS], 'readwrite');
    const store = t.objectStore(STORE_NOMENCLATURAS);
    await Promise.all(nomenclaturas.map(n => reqToPromise(store.delete(n))));
  }

  /* ------------------------------- Meta ------------------------------- */

  async function getMeta(key) {
    const t = await tx([STORE_META], 'readonly');
    const rec = await reqToPromise(t.objectStore(STORE_META).get(key));
    return rec ? rec.value : undefined;
  }

  async function setMeta(key, value) {
    const t = await tx([STORE_META], 'readwrite');
    await reqToPromise(t.objectStore(STORE_META).put({ key, value }));
  }

  async function getAllMeta() {
    const t = await tx([STORE_META], 'readonly');
    return reqToPromise(t.objectStore(STORE_META).getAll());
  }

  /* ---------------------- Historico (inteligencia) --------------------- */

  async function getAllHistorico() {
    const t = await tx([STORE_HISTORICO], 'readonly');
    return reqToPromise(t.objectStore(STORE_HISTORICO).getAll());
  }

  async function getHistoricoByRota(rota) {
    const t = await tx([STORE_HISTORICO], 'readonly');
    return reqToPromise(t.objectStore(STORE_HISTORICO).index('rota').getAll(rota));
  }

  async function addHistoricoBulk(records) {
    if (!records || records.length === 0) return;
    const t = await tx([STORE_HISTORICO], 'readwrite');
    const store = t.objectStore(STORE_HISTORICO);
    await Promise.all(records.map(r => reqToPromise(store.add(r))));
  }

  async function clearHistorico() {
    const t = await tx([STORE_HISTORICO], 'readwrite');
    await reqToPromise(t.objectStore(STORE_HISTORICO).clear());
  }

  /* ------------------------- Padroes de veiculo ------------------------- */

  async function getAllVehicleRules() {
    const t = await tx([STORE_VEHICLE_RULES], 'readonly');
    return reqToPromise(t.objectStore(STORE_VEHICLE_RULES).getAll());
  }

  async function putVehicleRule(rule) {
    const t = await tx([STORE_VEHICLE_RULES], 'readwrite');
    await reqToPromise(t.objectStore(STORE_VEHICLE_RULES).put(rule));
  }

  async function deleteVehicleRule(pattern) {
    const t = await tx([STORE_VEHICLE_RULES], 'readwrite');
    await reqToPromise(t.objectStore(STORE_VEHICLE_RULES).delete(pattern));
  }

  // garante que ao menos a regra-padrao inferida do arquivo de teste exista na base
  // (fica editavel pelo usuario dali em diante; nao eh reaplicada se ja houver regras)
  async function ensureDefaultVehicleRulesSeeded(defaults) {
    const existing = await getAllVehicleRules();
    if (existing.length > 0) return existing;
    const t = await tx([STORE_VEHICLE_RULES], 'readwrite');
    const store = t.objectStore(STORE_VEHICLE_RULES);
    await Promise.all(defaults.map(r => reqToPromise(store.put(r))));
    return defaults;
  }

  /* ------------------------- Export / Import completo ------------------ */

  async function exportAll() {
    const [cds, nomenclaturas, meta, historico, vehicleTypeRules] = await Promise.all([
      getAllCDs(), getAllNomenclaturas(), getAllMeta(), getAllHistorico(), getAllVehicleRules()
    ]);
    return {
      formato: 'control_tower_backup',
      versao: 2,
      exportadoEm: new Date().toISOString(),
      cds,
      nomenclaturas,
      meta,
      historico,
      vehicleTypeRules
    };
  }

  // mode: 'merge' (padrao, mescla e resolve conflitos preservando o mais recente)
  //       'replace' (apaga tudo e substitui pelo conteudo do backup)
  async function importAll(data, mode) {
    if (!data || !Array.isArray(data.cds) || !Array.isArray(data.nomenclaturas)) {
      throw new Error('Arquivo de backup invalido: estrutura inesperada.');
    }
    const historico = Array.isArray(data.historico) ? data.historico : [];
    const vehicleTypeRules = Array.isArray(data.vehicleTypeRules) ? data.vehicleTypeRules : [];
    const stores = [STORE_CDS, STORE_NOMENCLATURAS, STORE_META, STORE_HISTORICO, STORE_VEHICLE_RULES];
    const db = await openDb();

    if (mode === 'replace') {
      const t = db.transaction(stores, 'readwrite');
      await Promise.all(stores.map(s => reqToPromise(t.objectStore(s).clear())));
    }

    const t2 = db.transaction(stores, 'readwrite');
    const cdStore = t2.objectStore(STORE_CDS);
    const nStore = t2.objectStore(STORE_NOMENCLATURAS);
    const mStore = t2.objectStore(STORE_META);
    const hStore = t2.objectStore(STORE_HISTORICO);
    const vStore = t2.objectStore(STORE_VEHICLE_RULES);

    // reconstroi mapeamento de ids de CD (o id autoincrement pode nao bater entre bases diferentes)
    const codigoToExistingId = new Map();
    if (mode !== 'replace') {
      const existingCds = await getAllCDs();
      existingCds.forEach(c => codigoToExistingId.set(c.codigo, c.id));
    }

    // CDs primeiro e em sequencia: nomenclaturas dependem do id final de cada CD
    // (o id numerico pode nao ser o mesmo entre bases diferentes - o codigo do
    // CD e que e a chave estavel).
    for (const cd of data.cds) {
      const clone = Object.assign({}, cd);
      if (codigoToExistingId.has(clone.codigo)) {
        clone.id = codigoToExistingId.get(clone.codigo);
      } else {
        delete clone.id; // deixa o autoIncrement gerar um novo id
      }
      const newId = await reqToPromise(cdStore.put(clone));
      codigoToExistingId.set(clone.codigo, newId);
    }

    // nomenclaturas/historico/meta/regras nao dependem umas das outras -> em paralelo
    const puts = [];
    for (const n of data.nomenclaturas) {
      const clone = Object.assign({}, n);
      if (clone.cdCodigo && codigoToExistingId.has(clone.cdCodigo)) {
        clone.cdId = codigoToExistingId.get(clone.cdCodigo); // remapeia para o id local correto
      }
      puts.push(reqToPromise(nStore.put(clone)));
    }
    for (const m of (data.meta || [])) {
      puts.push(reqToPromise(mStore.put(m)));
    }
    for (const h of historico) {
      const clone = Object.assign({}, h);
      delete clone.id; // evita colisao de chave autoincrement entre bases diferentes
      puts.push(reqToPromise(hStore.add(clone)));
    }
    for (const v of vehicleTypeRules) {
      puts.push(reqToPromise(vStore.put(v)));
    }
    await Promise.all(puts);

    await new Promise((resolve, reject) => {
      t2.oncomplete = resolve;
      t2.onerror = () => reject(t2.error);
    });
  }

  /* ------------------------ Semeadura automatica (seed) ------------------- */

  async function isEmpty() {
    const [cds, nomenclaturas] = await Promise.all([getAllCDs(), getAllNomenclaturas()]);
    return cds.length === 0 && nomenclaturas.length === 0;
  }

  // Carrega os dados embutidos no proprio codigo (nao mais um backup manual) na
  // PRIMEIRA vez que o sistema roda neste navegador — ou seja, somente quando a
  // base local ainda esta vazia. Nunca sobrescreve dados que o usuario ja tenha
  // criado/importado depois, para nao apagar trabalho feito na interface.
  async function seedIfEmpty(data) {
    if (!data) return false;
    const empty = await isEmpty();
    if (!empty) return false;
    await importAll(data, 'replace');
    return true;
  }

  /* --------------------- Mapa de nomenclatura -> CD (memoria) --------------- */

  async function buildNomenclatureLookup() {
    const [nomenclaturas, cds] = await Promise.all([getAllNomenclaturas(), getAllCDs()]);
    const cdById = new Map(cds.map(c => [c.id, c]));
    const map = new Map();
    for (const n of nomenclaturas) {
      const cd = cdById.get(n.cdId);
      map.set(n.nomenclatura, {
        cdCodigo: n.cdCodigo || (cd ? cd.codigo : null),
        cdNome: n.cdNome || (cd ? cd.nome : null),
        status: n.status || 'ok'
      });
    }
    return map;
  }

  return {
    STORE_CDS, STORE_NOMENCLATURAS, STORE_META, STORE_HISTORICO, STORE_VEHICLE_RULES,
    openDb,
    getAllCDs, getCDByCodigo, putCD, deleteCD,
    getAllNomenclaturas, getNomenclatura, putNomenclatura, putNomenclaturasBulk, deleteNomenclatura, deleteNomenclaturasBulk,
    getMeta, setMeta, getAllMeta,
    getAllHistorico, getHistoricoByRota, addHistoricoBulk, clearHistorico,
    getAllVehicleRules, putVehicleRule, deleteVehicleRule, ensureDefaultVehicleRulesSeeded,
    exportAll, importAll, isEmpty, seedIfEmpty,
    buildNomenclatureLookup
  };
})();
