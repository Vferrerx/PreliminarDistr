/* ============================================================================
 * TABELA DE REFERENCIA - Prefixo de rota -> CD de origem -> Transportadora
 * ----------------------------------------------------------------------------
 * Fonte: planilha fornecida pelo usuario (rota x CD de origem x transportadora).
 * Esta tabela e a UNICA fonte usada para:
 *   1) Determinar o CD de ORIGEM de uma rota (a partir do prefixo alfabetico,
 *      ex: "BA460M" -> prefixo "BA");
 *   2) Determinar a Transportadora responsavel pela rota, usada apenas para
 *      decidir se uma linha de retorno ao CD deve ser criada automaticamente
 *      (ver AUTO_RETURN_TRANSPORTADORAS em core-logic.js).
 * O sistema NAO le mais o campo "Transportadora:" nem infere o CD de origem
 * a partir do PDF - ambos vem exclusivamente desta tabela.
 * Para atualizar: edite o array abaixo (ou substitua o arquivo inteiro a partir
 * de uma nova planilha com as mesmas 3 colunas: Prefixo, CD, Transportadora).
 * ==========================================================================*/
const PREFIXO_CD_TRANSPORTADORA = [
  { prefixo: "ON", cd: "CDFT", transportadora: "MARTIN BROWER" },
  { prefixo: "RJ", cd: "CDRJ", transportadora: "MARTIN BROWER" },
  { prefixo: "ZL", cd: "CDJC", transportadora: "MARTIN BROWER" },
  { prefixo: "SP", cd: "CDFT", transportadora: "MARTIN BROWER" },
  { prefixo: "CP", cd: "CDJD", transportadora: "MARTIN BROWER" },
  { prefixo: "RS", cd: "CDRS", transportadora: "PRODELOG" },
  { prefixo: "DF", cd: "CDDF", transportadora: "SGT" },
  { prefixo: "MG", cd: "CDMG", transportadora: "PRODELOG" },
  { prefixo: "PE", cd: "CDNE", transportadora: "MARTIN BROWER" },
  { prefixo: "BA", cd: "CDBA", transportadora: "PRODELOG" },
  { prefixo: "VP", cd: "CDJC", transportadora: "MARTIN BROWER" },
  { prefixo: "RP", cd: "CDFT", transportadora: "MARTIN BROWER" },
  { prefixo: "CE", cd: "CDCE", transportadora: "PRODELOG" },
  { prefixo: "NO", cd: "CDFT", transportadora: "MARTIN BROWER" },
  { prefixo: "ES", cd: "CDES", transportadora: "LOGMAM" },
  { prefixo: "GO", cd: "CDGO", transportadora: "SGT" },
  { prefixo: "PN", cd: "CDPR", transportadora: "MARTIN BROWER" },
  { prefixo: "TM", cd: "CDJC", transportadora: "SGT" },
  { prefixo: "NF", cd: "CDRJ", transportadora: "MARTIN BROWER" },
  { prefixo: "RL", cd: "CDRJ", transportadora: "MARTIN BROWER" },
  { prefixo: "SF", cd: "CDRJ", transportadora: "MARTIN BROWER" },
  { prefixo: "SR", cd: "CDRJ", transportadora: "MARTIN BROWER" },
  { prefixo: "AB", cd: "CDJC", transportadora: "MARTIN BROWER" },
  { prefixo: "BS", cd: "CDMG", transportadora: "PRODELOG" },
  { prefixo: "LT", cd: "CDFT", transportadora: "MARTIN BROWER" },
  { prefixo: "MT", cd: "CDMT", transportadora: "SGT" },
  { prefixo: "NT", cd: "CDJD", transportadora: "MARTIN BROWER" },
  { prefixo: "RN", cd: "CDNE", transportadora: "MARTIN BROWER" },
  { prefixo: "PB", cd: "CDNE", transportadora: "MARTIN BROWER" },
  { prefixo: "PI", cd: "CDPI", transportadora: "PRODELOG" },
  { prefixo: "AL", cd: "CDNE", transportadora: "MARTIN BROWER" },
  { prefixo: "JF", cd: "CDRJ", transportadora: "MARTIN BROWER" },
  { prefixo: "LN", cd: "CDJC", transportadora: "MARTIN BROWER" },
  { prefixo: "MA", cd: "CDPI", transportadora: "PRODELOG" },
  { prefixo: "PA", cd: "CDPI", transportadora: "PRODELOG" },
  { prefixo: "SC", cd: "CDPR", transportadora: "MARTIN BROWER" },
  { prefixo: "SE", cd: "CDNE", transportadora: "MARTIN BROWER" },
  { prefixo: "SJ", cd: "CDFT", transportadora: "MARTIN BROWER" },
  { prefixo: "SO", cd: "CDFT", transportadora: "MARTIN BROWER" },
  { prefixo: "TO", cd: "CDDF", transportadora: "SGT" },
  { prefixo: "CR", cd: "CDNE", transportadora: "MARTIN BROWER" },
  { prefixo: "CS", cd: "CDMG", transportadora: "PRODELOG" },
  { prefixo: "MS", cd: "CDJC", transportadora: "SGT" },
  { prefixo: "GS", cd: "CDJC", transportadora: "SGT" },
  { prefixo: "IG", cd: "CDMG", transportadora: "PRODELOG" },
  { prefixo: "MC", cd: "CDMG", transportadora: "PRODELOG" },
  { prefixo: "MD", cd: "CDJC", transportadora: "SGT" },
  { prefixo: "ML", cd: "CDMT", transportadora: "SGT" },
  { prefixo: "NP", cd: "CDPR", transportadora: "MARTIN BROWER" },
  { prefixo: "SM", cd: "CDJC", transportadora: "PRODELOG" },
  { prefixo: "RO", cd: "CDJC", transportadora: "PRODELOG" },
  { prefixo: "ST", cd: "CDNE", transportadora: "MARTIN BROWER" },
];

if (typeof module !== 'undefined') {
  module.exports = { PREFIXO_CD_TRANSPORTADORA };
}
