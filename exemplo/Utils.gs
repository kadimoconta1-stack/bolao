/*************************************************
 * BOLÃO PLACAR EXATO V5
 * Arquivo: Utils.gs
 *************************************************/

/**
 * Gera token aleatório seguro
 */
function gerarToken() {
  return Utilities.getUuid().replace(/-/g, '') + Date.now().toString(36);
}

/**
 * Gera código público curto único (ex: AB82KQ)
 */
function gerarCodigoUnico(valoresExistentes) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem caracteres ambíguos
  var existentes = {};
  if (valoresExistentes) {
    for (var i = 1; i < valoresExistentes.length; i++) {
      existentes[String(valoresExistentes[i][1])] = true;
    }
  }

  var codigo;
  var tentativas = 0;
  do {
    codigo = '';
    for (var j = 0; j < 6; j++) {
      codigo += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    tentativas++;
  } while (existentes[codigo] && tentativas < 50);

  return codigo;
}

/**
 * Normaliza WhatsApp (apenas dígitos)
 */
function normalizarWhatsApp(num) {
  if (!num) return '';
  var limpo = String(num).replace(/\D/g, '');
  return limpo;
}

/**
 * Formata valor como moeda BRL
 */
function formatarMoeda(valor) {
  var n = Number(valor || 0);
  return 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Formata data como dd/MM/yyyy HH:mm:ss
 */
function formatarData(data) {
  if (!data) data = new Date();
  return Utilities.formatDate(data, Session.getScriptTimeZone() || 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss');
}