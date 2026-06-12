/*************************************************
 * BOLÃO PLACAR EXATO V5
 * Arquivo: AdminFuncoes
 * Funções administrativas
 *************************************************/

var COL = {
  ID: 0, CODIGO: 1, DATA: 2, NOME: 3, WHATSAPP: 4,
  TIME_CASA: 5, TIME_VIS: 6, GOLS_CASA: 7, GOLS_VIS: 8,
  PLACAR: 9, VALOR: 10, STATUS: 11, DATA_APROV: 12,
  OBS: 13, CHAVE: 14, ORIGEM: 15, TOKEN: 16
};

function getDashboardAdmin(token) {
  try {
    exigirSessao(token);
    var cfg = getConfig();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABAS.PALPITES);
    var valores = sheet.getDataRange().getValues();

    var total = 0, pagos = 0, pendentes = 0, recusados = 0;
    for (var i = 1; i < valores.length; i++) {
      total++;
      var st = String(valores[i][COL.STATUS]);
      if (st === 'PAGO') pagos++;
      else if (st === 'PENDENTE') pendentes++;
      else if (st === 'RECUSADO') recusados++;
    }

    var arrecadado = pagos * cfg.valorPalpite;
    var premio = arrecadado * (cfg.percentualPremio / 100);

    return {
      ok: true,
      data: {
        total: total,
        pagos: pagos,
        pendentes: pendentes,
        recusados: recusados,
        arrecadado: arrecadado,
        arrecadadoFmt: formatarMoeda(arrecadado),
        premio: premio,
        premioFmt: formatarMoeda(premio),
        statusBolao: cfg.statusBolao,
        bolaoEncerrado: isBolaoEncerrado(cfg),
        timeCasa: cfg.timeCasa,
        timeVisitante: cfg.timeVisitante,
        resultadoLancado: resultadoJaLancado()
      }
    };
  } catch (err) {
    if (isErroSessao(err)) return { ok: false, message: 'Sessão expirada. Faça login novamente.', errorCode: 'SESSAO_INVALIDA' };
    registrarErro('getDashboardAdmin', err);
    return { ok: false, message: 'Erro no dashboard.', errorCode: 'ERRO_DASH' };
  }
}

function listarPalpitesAdmin(token) {
  try {
    exigirSessao(token);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABAS.PALPITES);
    var valores = sheet.getDataRange().getValues();
    var lista = [];
    for (var i = 1; i < valores.length; i++) {
      lista.push({
        data: String(valores[i][COL.DATA]),
        codigo: String(valores[i][COL.CODIGO]),
        nome: String(valores[i][COL.NOME]),
        whatsapp: String(valores[i][COL.WHATSAPP]),
        placar: String(valores[i][COL.PLACAR]),
        valor: formatarMoeda(valores[i][COL.VALOR]),
        status: String(valores[i][COL.STATUS]),
        obs: String(valores[i][COL.OBS] || '')
      });
    }
    lista.reverse();
    return { ok: true, data: lista };
  } catch (err) {
    if (isErroSessao(err)) return { ok: false, message: 'Sessão expirada. Faça login novamente.', errorCode: 'SESSAO_INVALIDA' };
    registrarErro('listarPalpitesAdmin', err);
    return { ok: false, message: 'Erro ao listar palpites.', errorCode: 'ERRO_LISTA' };
  }
}

function alterarStatusPalpite(token, codigo, novoStatus, observacao) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    exigirSessao(token);

    codigo = String(codigo || '').trim().toUpperCase();
    novoStatus = String(novoStatus || '').trim().toUpperCase();
    observacao = String(observacao || '');

    if (['PAGO', 'PENDENTE', 'RECUSADO'].indexOf(novoStatus) === -1) {
      return { ok: false, message: 'Status inválido.', errorCode: 'STATUS_INVALIDO' };
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABAS.PALPITES);
    var valores = sheet.getDataRange().getValues();

    for (var i = 1; i < valores.length; i++) {
      if (String(valores[i][COL.CODIGO]).toUpperCase() === codigo) {
        var statusAnterior = String(valores[i][COL.STATUS]);
        var linha = i + 1;
        sheet.getRange(linha, COL.STATUS + 1).setValue(novoStatus);
        if (observacao) sheet.getRange(linha, COL.OBS + 1).setValue(observacao);
        if (novoStatus === 'PAGO') {
          sheet.getRange(linha, COL.DATA_APROV + 1).setValue(formatarData(new Date()));
        }

        var acaoMap = { 'PAGO': 'MARCAR_PAGO', 'PENDENTE': 'MARCAR_PENDENTE', 'RECUSADO': 'RECUSAR_PALPITE' };
        registrarAuditoria(acaoMap[novoStatus], {
          codigo: codigo, anterior: statusAnterior, novo: novoStatus, obs: observacao
        });

        return { ok: true, message: 'Status atualizado para ' + novoStatus + '.' };
      }
    }
    return { ok: false, message: 'Palpite não encontrado.', errorCode: 'NAO_ENCONTRADO' };
  } catch (err) {
    if (isErroSessao(err)) return { ok: false, message: 'Sessão expirada. Faça login novamente.', errorCode: 'SESSAO_INVALIDA' };
    registrarErro('alterarStatusPalpite', err);
    return { ok: false, message: 'Erro ao alterar status.', errorCode: 'ERRO_STATUS' };
  } finally {
    lock.releaseLock();
  }
}

function marcarPago(token, codigo) {
  return alterarStatusPalpite(token, codigo, 'PAGO', '');
}

function marcarPendente(token, codigo) {
  return alterarStatusPalpite(token, codigo, 'PENDENTE', '');
}

function recusarPalpite(token, codigo, observacao) {
  return alterarStatusPalpite(token, codigo, 'RECUSADO', observacao || 'Recusado pelo admin');
}

function adicionarObservacao(token, codigo, observacao) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    exigirSessao(token);
    codigo = String(codigo || '').trim().toUpperCase();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABAS.PALPITES);
    var valores = sheet.getDataRange().getValues();
    for (var i = 1; i < valores.length; i++) {
      if (String(valores[i][COL.CODIGO]).toUpperCase() === codigo) {
        sheet.getRange(i + 1, COL.OBS + 1).setValue(String(observacao || ''));
        registrarAuditoria('ALTERAR_CONFIG', { codigo: codigo, anterior: '-', novo: '-', obs: 'Observação: ' + observacao });
        return { ok: true, message: 'Observação salva.' };
      }
    }
    return { ok: false, message: 'Palpite não encontrado.', errorCode: 'NAO_ENCONTRADO' };
  } catch (err) {
    if (isErroSessao(err)) return { ok: false, message: 'Sessão expirada. Faça login novamente.', errorCode: 'SESSAO_INVALIDA' };
    registrarErro('adicionarObservacao', err);
    return { ok: false, message: 'Erro ao salvar observação.', errorCode: 'ERRO_OBS' };
  } finally {
    lock.releaseLock();
  }
}

function fecharBolao(token) {
  return setarStatusBolao(token, 'FECHADO', 'FECHAR_BOLAO');
}
function reabrirBolao(token) {
  return setarStatusBolao(token, 'ABERTO', 'REABRIR_BOLAO');
}

function setarStatusBolao(token, status, acao) {
  try {
    exigirSessao(token);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(ABAS.CONFIG);
    var dados = sheet.getDataRange().getValues();
    for (var i = 1; i < dados.length; i++) {
      if (String(dados[i][0]).trim() === 'STATUS_BOLAO') {
        sheet.getRange(i + 1, 2).setValue(status);
        registrarAuditoria(acao, { codigo: '-', anterior: '-', novo: status, obs: 'Status do bolão alterado' });
        return { ok: true, message: 'Bolão agora está ' + status + '.' };
      }
    }
    return { ok: false, message: 'Config não encontrada.', errorCode: 'CONFIG_ERRO' };
  } catch (err) {
    if (isErroSessao(err)) return { ok: false, message: 'Sessão expirada. Faça login novamente.', errorCode: 'SESSAO_INVALIDA' };
    registrarErro('setarStatusBolao', err);
    return { ok: false, message: 'Erro ao alterar status do bolão.', errorCode: 'ERRO_BOLAO' };
  }
}

function listarAuditoria(token) {
  try {
    exigirSessao(token);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABAS.AUDITORIA);
    var valores = sheet.getDataRange().getValues();
    var lista = [];
    for (var i = 1; i < valores.length; i++) {
      lista.push({
        data: String(valores[i][0]), acao: String(valores[i][1]), codigo: String(valores[i][2]),
        anterior: String(valores[i][3]), novo: String(valores[i][4]), admin: String(valores[i][5]), obs: String(valores[i][6] || '')
      });
    }
    lista.reverse();
    return { ok: true, data: lista.slice(0, 200) };
  } catch (err) {
    if (isErroSessao(err)) return { ok: false, message: 'Sessão expirada. Faça login novamente.', errorCode: 'SESSAO_INVALIDA' };
    registrarErro('listarAuditoria', err);
    return { ok: false, message: 'Erro ao carregar auditoria.', errorCode: 'ERRO_AUDIT' };
  }
}