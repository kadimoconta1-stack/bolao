/*************************************************
 * BOLÃO PLACAR EXATO V5
 * Arquivo: Palpites.gs
 *************************************************/

function registrarPalpite(dados) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    return { ok: false, message: 'Sistema ocupado. Tente novamente.', errorCode: 'LOCK_TIMEOUT' };
  }

  try {
    dados = dados || {};
    var cfg = getConfig();

    if (isBolaoEncerrado(cfg)) {
      return { ok: false, message: 'Bolão encerrado. Não é mais possível registrar palpites.', errorCode: 'ENCERRADO' };
    }

    var nome = String(dados.nome || '').trim();
    var whatsapp = normalizarWhatsApp(String(dados.whatsapp || ''));
    var golsCasa = parseInt(dados.golsCasa, 10);
    var golsVisitante = parseInt(dados.golsVisitante, 10);

    if (nome.length < 2) return { ok: false, message: 'Informe um nome válido.', errorCode: 'NOME_INVALIDO' };
    if (whatsapp.length < 10) return { ok: false, message: 'WhatsApp inválido.', errorCode: 'WHATSAPP_INVALIDO' };
    if (isNaN(golsCasa) || isNaN(golsVisitante)) return { ok: false, message: 'Informe os gols corretamente.', errorCode: 'GOLS_INVALIDOS' };
    if (golsCasa < 0 || golsVisitante < 0 || golsCasa > 20 || golsVisitante > 20) {
      return { ok: false, message: 'Gols devem estar entre 0 e 20.', errorCode: 'GOLS_RANGE' };
    }

    if (cfg.usarCaptcha) {
      if (!validarCaptchaMatematico(dados.captchaToken, dados.captchaResposta)) {
        return { ok: false, message: 'Verificação de segurança incorreta ou expirada.', errorCode: 'CAPTCHA_INVALIDO' };
      }
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(ABAS.PALPITES);
    var valores = sheet.getDataRange().getValues();

    var placar = golsCasa + ' x ' + golsVisitante;
    var chaveUnica = whatsapp + '|' + placar;
    var tokenEnvio = String(dados.tokenEnvio || '');

    var countWhats = 0;
    var palpitePendente = null;

    for (var i = 1; i < valores.length; i++) {
      var rWhats = String(valores[i][4]);
      var rPlacar = String(valores[i][9]);
      var rStatus = String(valores[i][11]);
      var rChave = String(valores[i][14]);
      var rToken = String(valores[i][16]);
      var rCodigo = String(valores[i][1]);

      // Proteção contra clique duplo (mesmo token de envio)
      if (tokenEnvio && rToken === tokenEnvio) {
        return { ok: true, message: 'Este palpite já foi registrado.', data: { codigo: rCodigo, placar: rPlacar, status: rStatus } };
      }

      // Mesmo whats + mesmo placar (não recusado) -> retorna existente
      if (rChave === chaveUnica && rStatus !== 'RECUSADO') {
        return { ok: true, message: 'Você já fez este palpite. Aguarde a confirmação do pagamento.', data: { codigo: rCodigo, placar: rPlacar, status: rStatus } };
      }

      // Analisa os palpites do mesmo WhatsApp
      if (rWhats === whatsapp && rStatus !== 'RECUSADO') {
        countWhats++;
        if (rStatus === 'PENDENTE') {
          palpitePendente = { codigo: rCodigo, placar: rPlacar };
        }
      }

      // Placar repetido bloqueado (se config = NÃO)
      if (cfg.permitirPlacarRepetido === 'NÃO' || cfg.permitirPlacarRepetido === 'NAO') {
        if (rPlacar === placar && (rStatus === 'PENDENTE' || rStatus === 'PAGO')) {
          return { ok: false, message: 'Este placar já foi escolhido por outro participante.', errorCode: 'PLACAR_OCUPADO' };
        }
      }
    }

    // REGRA: se tem palpite PENDENTE, não pode fazer outro
    if (palpitePendente) {
      return {
        ok: false,
        message: 'Você já tem um palpite pendente (código ' + palpitePendente.codigo + ', placar ' + palpitePendente.placar + '). ' +
                 'Efetue o pagamento dele ou solicite o cancelamento ao organizador antes de fazer um novo palpite.',
        errorCode: 'TEM_PENDENTE',
        data: { codigoPendente: palpitePendente.codigo, placarPendente: palpitePendente.placar }
      };
    }

    // Limite por whatsapp
    if (countWhats >= cfg.maxPalpitesWhatsapp) {
      return { ok: false, message: 'Limite de ' + cfg.maxPalpitesWhatsapp + ' palpites por WhatsApp atingido.', errorCode: 'LIMITE_WHATSAPP' };
    }

    var codigo = gerarCodigoUnico(valores);
    var idInterno = Utilities.getUuid();
    var agora = new Date();

    sheet.appendRow([
      idInterno, codigo, formatarData(agora), nome, whatsapp,
      cfg.timeCasa, cfg.timeVisitante, golsCasa, golsVisitante,
      placar, cfg.valorPalpite, 'PENDENTE', '', '',
      chaveUnica, 'WEB', tokenEnvio || gerarToken()
    ]);

    return {
      ok: true,
      message: 'Palpite registrado com sucesso!',
      data: {
        codigo: codigo, placar: placar, status: 'PENDENTE', nome: nome,
        timeCasa: cfg.timeCasa, timeVisitante: cfg.timeVisitante,
        whatsappOrg: cfg.whatsappOrg, chavePix: cfg.chavePix,
        nomeRecebedor: cfg.nomeRecebedor, valor: formatarMoeda(cfg.valorPalpite)
      }
    };

  } catch (err) {
    registrarErro('registrarPalpite', err);
    return { ok: false, message: 'Erro ao registrar palpite.', errorCode: 'ERRO_REGISTRO' };
  } finally {
    lock.releaseLock();
  }
}

function consultarPalpite(codigo) {
  try {
    codigo = String(codigo || '').trim().toUpperCase();
    if (!codigo) return { ok: false, message: 'Informe o código.', errorCode: 'SEM_CODIGO' };

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABAS.PALPITES);
    var valores = sheet.getDataRange().getValues();
    for (var i = 1; i < valores.length; i++) {
      if (String(valores[i][1]).toUpperCase() === codigo) {
        return {
          ok: true,
          data: {
            codigo: valores[i][1], placar: valores[i][9],
            status: valores[i][11], dataCadastro: valores[i][2]
          }
        };
      }
    }
    return { ok: false, message: 'Palpite não encontrado.', errorCode: 'NAO_ENCONTRADO' };
  } catch (err) {
    registrarErro('consultarPalpite', err);
    return { ok: false, message: 'Erro ao consultar.', errorCode: 'ERRO_CONSULTA' };
  }
}

function getResumoPublico() {
  try {
    var cfg = getConfig();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABAS.PALPITES);
    var valores = sheet.getDataRange().getValues();

    var pagos = 0;
    for (var i = 1; i < valores.length; i++) {
      if (String(valores[i][11]) === 'PAGO') pagos++;
    }

    var arrecadado = pagos * cfg.valorPalpite;
    var premio = arrecadado * (cfg.percentualPremio / 100);

    return {
      ok: true,
      data: {
        palpitesPagos: pagos,
        premioEstimado: premio,
        premioEstimadoFmt: formatarMoeda(premio),
        valorPalpiteFmt: formatarMoeda(cfg.valorPalpite),
        statusBolao: cfg.statusBolao,
        bolaoEncerrado: isBolaoEncerrado(cfg)
      }
    };
  } catch (err) {
    registrarErro('getResumoPublico', err);
    return { ok: false, message: 'Erro ao carregar resumo.', errorCode: 'ERRO_RESUMO' };
  }
}

/**
 * TRANSPARÊNCIA OPÇÃO C - só quantidade (placares em sigilo)
 */
function listarTransparenciaPublica() {
  try {
    var cfg = getConfig();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABAS.PALPITES);
    var valores = sheet.getDataRange().getValues();

    var pagos = 0;
    for (var i = 1; i < valores.length; i++) {
      if (String(valores[i][11]) === 'PAGO') pagos++;
    }

    var arrecadado = pagos * cfg.valorPalpite;
    var premio = arrecadado * (cfg.percentualPremio / 100);

    return {
      ok: true,
      data: {
        modoSigilo: true,
        totalPagos: pagos,
        premioEstimadoFmt: formatarMoeda(premio),
        resultadoLancado: resultadoJaLancado()
      }
    };
  } catch (err) {
    registrarErro('listarTransparenciaPublica', err);
    return { ok: false, message: 'Erro ao carregar transparência.', errorCode: 'ERRO_TRANSP' };
  }
}