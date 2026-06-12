function getResultadoPublico() {
  try {
    if (!resultadoJaLancado()) return { ok: true, data: { lancado: false } };
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABAS.RESULTADO);
    var v = sheet.getDataRange().getValues()[1];
    var placarFinal = String(v[4]);
    var qtd = Number(v[7] || 0);

    // Recalcula para pegar os códigos vencedores (transparência)
    var calc = calcularGanhadores(placarFinal);
    var codigosVencedores = calc.ganhadores.map(function (g) {
      return { codigo: g.codigo, placar: g.placar };
    });

    return {
      ok: true,
      data: {
        lancado: true,
        timeCasa: v[0], golsCasa: v[1], timeVisitante: v[2], golsVisitante: v[3],
        placarFinal: placarFinal,
        qtdGanhadores: calc.qtdGanhadores,
        premioTotalFmt: formatarMoeda(v[8]),
        premioPorGanhadorFmt: formatarMoeda(v[9]),
        temGanhador: calc.qtdGanhadores > 0,
        codigosVencedores: codigosVencedores
      }
    };
  } catch (err) {
    registrarErro('getResultadoPublico', err);
    return { ok: false, message: 'Erro ao carregar resultado.', errorCode: 'ERRO_RESULT_PUB' };
  }
}