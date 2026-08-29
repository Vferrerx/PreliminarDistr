/* ============================================================================
 * DB.JS - Persistencia local (IndexedDB)
 * ----------------------------------------------------------------------------
 * Versao simplificada: a Base de CDs e o Tipo de Veiculo->Operacao deixaram de
 * existir como telas (o reconhecimento de origem/transportadora agora vem
 * exclusivamente da tabela embutida em data/prefixo_cd_transportadora.js).
 * O unico dado que ainda precisa persistir entre sessoes e o HISTORICO de
 * carregamento/retorno, usado apenas para estimar automaticamente quando uma
 * rota elegivel deve ganhar uma linha de retorno ao CD (ver
 * AUTO_RETURN_TRANSPORTADORAS em core-logic.js).
 *
 * IMPORTANTE sobre versionamento: este banco usa o MESMO nome
 * ("control_tower_db") de versoes anteriores do sistema (que tinham tambem as
 * stores "cds", "nomenclaturas", "meta" e "vehicleTypeRules", hoje
 * descontinuadas). Por isso a abertura abaixo NAO fixa um numero de versao -
 * ela abre o banco na versao que ja existir no navegador (criando a v1 do
 * zero se for a primeira vez). Pedir uma versao fixa (ex: 1) quebra com
 * "VersionError: The requested version (1) is less than the existing version
 * (N)" em qualquer navegador que ja tenha rodado uma versao anterior do site
 * com um numero de versao maior - foi exatamente o erro relatado.
 * ==========================================================================*/

const CTDB = (function () {
  const DB_NAME = 'control_tower_db';
  const STORE_HISTORICO = 'historico';

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME); // sem versao fixa - ver nota acima
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE_HISTORICO)) {
          const store = db.createObjectStore(STORE_HISTORICO, { keyPath: 'id', autoIncrement: true });
          store.createIndex('rota', 'rota', { unique: false });
          store.createIndex('cdCodigo', 'cdCodigo', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Banco de dados local bloqueado (outra aba do Control Tower aberta?). Feche as outras abas e tente novamente.'));
    });
    return dbPromise;
  }

  async function tx(storeName, mode) {
    const db = await openDB();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  async function getAllHistorico() {
    const store = await tx(STORE_HISTORICO, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function addHistoricoBulk(records) {
    if (!records || !records.length) return;
    const store = await tx(STORE_HISTORICO, 'readwrite');
    return new Promise((resolve, reject) => {
      records.forEach(r => store.add(r));
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  }

  async function countHistorico() {
    const store = await tx(STORE_HISTORICO, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }

  // Carga inicial: roda uma unica vez (quando o historico local ainda esta
  // vazio) a partir dos dados embutidos em data/backup_data.js. Isso preserva
  // o conhecimento historico de padroes de retorno ja coletado anteriormente,
  // sem exigir nenhuma tela de importacao.
  async function seedHistoricoIfEmpty(seedHistoricoArray) {
    if (!seedHistoricoArray || !seedHistoricoArray.length) return { seeded: false, count: 0 };
    const existing = await countHistorico();
    if (existing > 0) return { seeded: false, count: existing };
    const cleaned = seedHistoricoArray.map(r => {
      const copy = Object.assign({}, r);
      delete copy.id; // deixa o autoIncrement gerar novos ids locais
      return copy;
    });
    await addHistoricoBulk(cleaned);
    return { seeded: true, count: cleaned.length };
  }

  return {
    getAllHistorico,
    addHistoricoBulk,
    countHistorico,
    seedHistoricoIfEmpty
  };
})();

if (typeof module !== 'undefined') {
  module.exports = { CTDB };
}
