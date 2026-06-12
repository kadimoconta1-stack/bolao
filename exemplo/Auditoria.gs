/*************************************************
 * BOLÃO PLACAR EXATO V5
 * Arquivo: Auditoria.gs
 *************************************************/

function registrarAuditoria(acao, dados) {
  try {
    dados = dados || {};
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABAS.AUDITORIA);
    if (!sheet) return;
    sheet.appendRow([
      formatarData(new Date()),
      acao,
      dados.codigo || '-',
      dados.anterior || '-',
      dados.novo || '-',
      Session.getActiveUser().getEmail() || 'ADMIN',
      dados.obs || ''
    ]);
  } catch (e) {
    // não interromper fluxo por erro de auditoria
  }
}

function registrarErro(funcao, erro) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABAS.LOG_ERROS);
    if (!sheet) return;
    var msg = (erro && erro.message) ? erro.message : String(erro);
    var detalhes = (erro && erro.stack) ? erro.stack : '';
    sheet.appendRow([formatarData(new Date()), funcao, msg, detalhes]);
  } catch (e) {
    Logger.log('Erro ao registrar erro: ' + e);
  }
}