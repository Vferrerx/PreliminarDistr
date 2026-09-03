/* ============================================================================
 * TABELA DE REFERENCIA - Prefixo de rota -> CD de origem -> Transportadora -> Planilha
 * ----------------------------------------------------------------------------
 * Fonte: planilha fornecida pelo usuario (rota x CD de origem x transportadora x
 * nome de planilha). Esta tabela e a UNICA fonte usada para:
 *   1) Determinar o CD de ORIGEM de uma rota (a partir do prefixo alfabetico,
 *      ex: "BA460M" -> prefixo "BA");
 *   2) Determinar a Transportadora responsavel pela rota, usada apenas para
 *      decidir se uma linha de retorno ao CD deve ser criada automaticamente
 *      (ver AUTO_RETURN_TRANSPORTADORAS em core-logic.js);
 *   3) Determinar em qual planilha (arquivo Excel) de saida a rota deve entrar -
 *      varios prefixos podem compartilhar o mesmo nome de planilha (ver campo
 *      "planilha"; o numero da semana e adicionado ao final pelo core-logic.js).
 * O sistema NAO le mais o campo "Transportadora:" nem infere o CD de origem
 * a partir do PDF - tudo isso vem exclusivamente desta tabela.
 * Para atualizar: edite o array abaixo (ou substitua o arquivo inteiro a partir
 * de uma nova planilha com as mesmas 4 colunas: Prefixo, CD, Transportadora, Planilha).
 * ==========================================================================*/
const PREFIXO_CD_TRANSPORTADORA = [
  { prefixo: "ON", cd: "CDFT", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_FT_OnePallet_Sem" },
  { prefixo: "RJ", cd: "CDRJ", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_ES_RJ_Sem" },
  { prefixo: "ZL", cd: "CDJC", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_JC_Sem" },
  { prefixo: "SP", cd: "CDFT", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_FT_Sem" },
  { prefixo: "CP", cd: "CDJD", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_FT_Sem" },
  { prefixo: "RS", cd: "CDRS", transportadora: "PRODELOG", planilha: "Tbl_DistrMCD_RS_Sem" },
  { prefixo: "DF", cd: "CDDF", transportadora: "SGT", planilha: "Tbl_DistrMCD_DF_GO_MT_TO_Sem" },
  { prefixo: "MG", cd: "CDMG", transportadora: "PRODELOG", planilha: "Tbl_DistrMCD_BA_BS_MG_Sem" },
  { prefixo: "PE", cd: "CDNE", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_NE_Sem" },
  { prefixo: "BA", cd: "CDBA", transportadora: "PRODELOG", planilha: "Tbl_DistrMCD_BA_BS_MG_Sem" },
  { prefixo: "VP", cd: "CDJC", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_JC_Sem" },
  { prefixo: "RP", cd: "CDFT", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_FT_Sem" },
  { prefixo: "CE", cd: "CDCE", transportadora: "PRODELOG", planilha: "Tbl_DistrMCD_NE_Sem" },
  { prefixo: "NO", cd: "CDFT", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_FT_Sem" },
  { prefixo: "ES", cd: "CDES", transportadora: "LOGMAM", planilha: "Tbl_DistrMCD_ES_RJ_Sem" },
  { prefixo: "GO", cd: "CDGO", transportadora: "SGT", planilha: "Tbl_DistrMCD_DF_GO_MT_TO_Sem" },
  { prefixo: "PN", cd: "CDPR", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_PR_Sem" },
  { prefixo: "TM", cd: "CDJC", transportadora: "SGT", planilha: "Tbl_DistrMCD_DIRETAS_Sem" },
  { prefixo: "NF", cd: "CDRJ", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_ES_RJ_Sem" },
  { prefixo: "RL", cd: "CDRJ", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_ES_RJ_Sem" },
  { prefixo: "SF", cd: "CDRJ", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_ES_RJ_Sem" },
  { prefixo: "SR", cd: "CDRJ", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_ES_RJ_Sem" },
  { prefixo: "AB", cd: "CDJC", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_JC_Sem" },
  { prefixo: "BS", cd: "CDMG", transportadora: "PRODELOG", planilha: "Tbl_DistrMCD_BA_BS_MG_Sem" },
  { prefixo: "LT", cd: "CDFT", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_FT_Sem" },
  { prefixo: "MT", cd: "CDMT", transportadora: "SGT", planilha: "Tbl_DistrMCD_DF_GO_MT_TO_Sem" },
  { prefixo: "NT", cd: "CDJD", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_FT_Sem" },
  { prefixo: "RN", cd: "CDNE", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_NE_Sem" },
  { prefixo: "PB", cd: "CDNE", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_NE_Sem" },
  { prefixo: "PI", cd: "CDPI", transportadora: "PRODELOG", planilha: "Tbl_DistrMCD_NE_Sem" },
  { prefixo: "AL", cd: "CDNE", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_NE_Sem" },
  { prefixo: "JF", cd: "CDRJ", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_ES_RJ_Sem" },
  { prefixo: "LN", cd: "CDJC", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_JC_Sem" },
  { prefixo: "MA", cd: "CDPI", transportadora: "PRODELOG", planilha: "Tbl_DistrMCD_NE_Sem" },
  { prefixo: "PA", cd: "CDPI", transportadora: "PRODELOG", planilha: "Tbl_DistrMCD_NE_Sem" },
  { prefixo: "SC", cd: "CDPR", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_PR_Sem" },
  { prefixo: "SE", cd: "CDNE", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_NE_Sem" },
  { prefixo: "SJ", cd: "CDFT", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_FT_Sem" },
  { prefixo: "SO", cd: "CDFT", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_FT_Sem" },
  { prefixo: "TO", cd: "CDDF", transportadora: "SGT", planilha: "Tbl_DistrMCD_DF_GO_MT_TO_Sem" },
  { prefixo: "CR", cd: "CDNE", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_NE_Sem" },
  { prefixo: "CS", cd: "CDMG", transportadora: "PRODELOG", planilha: "Tbl_DistrMCD_BA_BS_MG_Sem" },
  { prefixo: "MS", cd: "CDJC", transportadora: "SGT", planilha: "Tbl_DistrMCD_DIRETAS_Sem" },
  { prefixo: "GS", cd: "CDJC", transportadora: "SGT", planilha: "Tbl_DistrMCD_DIRETAS_Sem" },
  { prefixo: "IG", cd: "CDMG", transportadora: "PRODELOG", planilha: "Tbl_DistrMCD_BA_BS_MG_Sem" },
  { prefixo: "MC", cd: "CDMG", transportadora: "PRODELOG", planilha: "Tbl_DistrMCD_BA_BS_MG_Sem" },
  { prefixo: "MD", cd: "CDJC", transportadora: "SGT", planilha: "Tbl_DistrMCD_DIRETAS_Sem" },
  { prefixo: "ML", cd: "CDMT", transportadora: "SGT", planilha: "Tbl_DistrMCD_DF_GO_MT_TO_Sem" },
  { prefixo: "NP", cd: "CDPR", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_PR_Sem" },
  { prefixo: "SM", cd: "CDJC", transportadora: "PRODELOG", planilha: "Tbl_DistrMCD_DIRETAS_Sem" },
  { prefixo: "RO", cd: "CDJC", transportadora: "PRODELOG", planilha: "Tbl_DistrMCD_DIRETAS_Sem" },
  { prefixo: "ST", cd: "CDNE", transportadora: "MARTIN BROWER", planilha: "Tbl_DistrMCD_NE_Sem" },
];

if (typeof module !== 'undefined') {
  module.exports = { PREFIXO_CD_TRANSPORTADORA };
}
