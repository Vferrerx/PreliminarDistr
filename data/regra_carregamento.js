/* ============================================================================
 * REGRAS DE DEFINICAO DA DTHCARREG (Data/Hora de Carregamento)
 * ----------------------------------------------------------------------------
 * Determina a regra de carregamento conforme CD FATURAMENTO (campo "CD: XX" do
 * PDF, ex: "FT", "JC", "NE", "PR") e a NOMENCLATURA da rota (prefixo alfabetico,
 * ex: "BA460M" -> "BA"; ou um padrao com curinga "*" quando a regra depende de
 * um trecho especifico do codigo da rota, ex: "GO*96F").
 *
 * Quando uma rota casa com uma regra abaixo (mesmo CD FATURAMENTO + mesma
 * nomenclatura), a DTHCARREG e recalculada a partir da DATA DE ENTREGA da
 * propria rota (dataEntrega - diasAntesEntrega, no horario "hora" informado),
 * SUBSTITUINDO a data/hora de carregamento lida do PDF (a "preliminar").
 *
 * Quando a rota NAO casa com nenhuma regra (CD FATURAMENTO nao consta aqui, ou
 * consta mas a nomenclatura da rota nao esta listada, ou a regra e marcada
 * "seguePreliminar: true"), o sistema mantem a DTHCARREG exatamente como veio
 * do PDF (linha "Carregamento: <dia> HH:MM") - nao altera nada.
 *
 * Caso especial FAT. FT: a regra nao depende da nomenclatura da rota, e sim da
 * ORIGEM ja resolvida pela tabela Prefixo x CD x Transportadora (ver
 * data/prefixo_cd_transportadora.js) - por isso usa "origemCondicional" em vez
 * de "nomenclaturas".
 *
 * Para atualizar: edite o array abaixo. Nao e editavel pela tela.
 * ==========================================================================*/
const REGRAS_CARREGAMENTO = [

  /* ---------------------------- FAT. JC ---------------------------- */
  { cdFat: 'JC', nomenclaturas: ['BA'], diasAntesEntrega: 1, hora: '23:00' },
  { cdFat: 'JC', nomenclaturas: ['DF'], diasAntesEntrega: 1, hora: '23:00' },
  { cdFat: 'JC', nomenclaturas: ['TO'], diasAntesEntrega: 1, hora: '23:00' },
  { cdFat: 'JC', nomenclaturas: ['ES'], diasAntesEntrega: 1, hora: '23:00' },
  { cdFat: 'JC', nomenclaturas: ['GO'], diasAntesEntrega: 1, hora: '23:00' },
  // GO*96F / GO*96M sao mais especificos que o "GO" generico acima e tem prioridade sobre ele.
  { cdFat: 'JC', nomenclaturas: ['GO*96F', 'GO*96M'], diasAntesEntrega: 3, hora: '23:00' },
  { cdFat: 'JC', nomenclaturas: ['LT', 'SP', 'VP', 'ZL'], seguePreliminar: true },
  { cdFat: 'JC', nomenclaturas: ['NO', 'RP', 'SJ'], diasAntesEntrega: 1, hora: '13:00' },
  { cdFat: 'JC', nomenclaturas: ['CP', 'PC', 'SO'], diasAntesEntrega: 1, hora: '23:00' },
  { cdFat: 'JC', nomenclaturas: ['MC', 'CS','SM'], diasAntesEntrega: 1, hora: '23:00' },
  { cdFat: 'JC', nomenclaturas: ['TM'], diasAntesEntrega: 1, hora: '11:00' },
  { cdFat: 'JC', nomenclaturas: ['BS'], diasAntesEntrega: 2, hora: '23:00' },
  { cdFat: 'JC', nomenclaturas: ['MG', 'IG'], diasAntesEntrega: 1, hora: '23:00' },
  { cdFat: 'JC', nomenclaturas: ['ML'], diasAntesEntrega: 1, hora: '23:00' },
  { cdFat: 'JC', nomenclaturas: ['MT'], diasAntesEntrega: 1, hora: '23:00' },
  { cdFat: 'JC', nomenclaturas: ['RJ'], diasAntesEntrega: 1, hora: '23:00' },
  { cdFat: 'JC', nomenclaturas: ['NF', 'SF', 'SR', 'RL', 'JF'], diasAntesEntrega: 1, hora: '21:00' },
  { cdFat: 'JC', nomenclaturas: ['RO'], diasAntesEntrega: 3, hora: '23:00' },

  /* ---------------------------- FAT. NE ---------------------------- */
  { cdFat: 'NE', nomenclaturas: ['CE'], diasAntesEntrega: 1, hora: '23:00' },
  { cdFat: 'NE', nomenclaturas: ['PI'], diasAntesEntrega: 1, hora: '23:00' },
  { cdFat: 'NE', nomenclaturas: ['MA', 'PA', 'AP', 'ST'], diasAntesEntrega: 2, hora: '23:00' },
  { cdFat: 'NE', nomenclaturas: ['SE'], diasAntesEntrega: 1, hora: '23:00' },

  /* ---------------------------- FAT. PR ---------------------------- */
  { cdFat: 'PR', nomenclaturas: ['RS'], diasAntesEntrega: 1, hora: '23:00' },
  { cdFat: 'PR', nomenclaturas: ['NP', 'SC', 'PN'], diasAntesEntrega: 1, hora: '21:00' },

  /* ---------------------------- FAT. FT ----------------------------
   * Regra condicional pela ORIGEM resolvida (nao pela nomenclatura da rota):
   * origem = "CDJD" -> aplica a regra; qualquer outra origem -> segue preliminar. */
  { cdFat: 'FT', origemCondicional: 'CDJD', diasAntesEntrega: 1, hora: '23:00' },

];

if (typeof module !== 'undefined') {
  module.exports = { REGRAS_CARREGAMENTO };
}
