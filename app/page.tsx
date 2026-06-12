"use client";

import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

interface Pool {
  id: string;
  name: string;
  home_team: string;
  away_team: string;
  home_team_image_url: string | null;
  away_team_image_url: string | null;
  bet_amount: number;
  prize_percent: number;
  deadline: string;
  status: "OPEN" | "CLOSED" | "FINISHED";
  allow_repeated_score: boolean;
  max_bets_per_phone: number;
  pix_key: string;
  pix_receiver_name: string;
  organizer_whatsapp: string;
  theme: string;
}

interface LocalBet {
  codigo: string;
  placar: string;
  status: string;
  nome: string;
  timeCasa?: string;
  timeVisitante?: string;
  valor?: string;
}

export default function Home() {
  const [pool, setPool] = useState<Pool | null>(null);
  const [stats, setStats] = useState({ totalPaid: 0, estimatedPrize: 0 });
  const [loading, setLoading] = useState(true);
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [golsCasa, setGolsCasa] = useState("0");
  const [golsVis, setGolsVis] = useState("0");
  const [captchaQuestion, setCaptchaQuestion] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successData, setSuccessData] = useState<any>(null);
  const [pendingData, setPendingData] = useState<any>(null);
  const [localBets, setLocalBets] = useState<LocalBet[]>([]);
  const [result, setResult] = useState<any>(null);

  const LS_KEY = "bpe5_meus_palpites";

  useEffect(() => {
    fetchData();
    loadLocalBets();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setErrorMsg("");

      // Fetch active pool configurations
      const { data: pools, error: poolError } = await supabase
        .from("pools")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);

      if (poolError) throw poolError;

      if (!pools || pools.length === 0) {
        setPool(null);
        setLoading(false);
        return;
      }

      const activePool = pools[0] as Pool;
      setPool(activePool);

      // Fetch public pool summary (paid counts and prizes)
      const { data: summary, error: summaryError } = await supabase
        .from("public_pool_summary")
        .select("*")
        .eq("pool_id", activePool.id)
        .single();

      if (!summaryError && summary) {
        setStats({
          totalPaid: Number(summary.total_paid_bets || 0),
          estimatedPrize: Number(summary.estimated_prize || 0),
        });
      }

      // Fetch captcha
      await loadCaptcha();

      // Fetch result if FINISHED
      if (activePool.status === "FINISHED") {
        const { data: res, error: resError } = await supabase
          .from("results")
          .select("*")
          .eq("pool_id", activePool.id)
          .single();

        if (!resError && res) {
          // Fetch winner codes
          const { data: winners } = await supabase
            .from("public_paid_bets")
            .select("public_code, score_key")
            .eq("is_winner", true);

          setResult({
            ...res,
            winners: winners || [],
          });
        }
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg("Erro ao carregar dados do bolão.");
    } finally {
      setLoading(false);
    }
  };

  const loadCaptcha = async () => {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
      
      const res = await fetch(`${supabaseUrl}/functions/v1/get-captcha`, {
        method: "GET",
        headers: {
          "apikey": supabaseAnonKey,
          "Authorization": `Bearer ${supabaseAnonKey}`,
        },
      });

      const json = await res.json();
      if (json.ok) {
        setCaptchaQuestion(json.data.question);
        setCaptchaToken(json.data.token);
        setCaptchaAnswer("");
      }
    } catch (err) {
      console.error("Failed to load captcha", err);
    }
  };

  const loadLocalBets = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setLocalBets(JSON.parse(raw));
    } catch (e) {
      console.error(e);
    }
  };

  const saveLocalBet = (bet: LocalBet) => {
    try {
      const current = [...localBets];
      if (!current.some((b) => b.codigo === bet.codigo)) {
        current.unshift(bet);
        setLocalBets(current);
        localStorage.setItem(LS_KEY, JSON.stringify(current));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const updateLocalBetsStatus = async () => {
    if (localBets.length === 0) return;
    try {
      const updated = [...localBets];
      for (let i = 0; i < updated.length; i++) {
        const { data, error } = await supabase
          .from("bets")
          .select("status")
          .eq("public_code", updated[i].codigo)
          .limit(1);

        if (!error && data && data.length > 0) {
          updated[i].status = data[0].status;
        }
      }
      setLocalBets(updated);
      localStorage.setItem(LS_KEY, JSON.stringify(updated));
      alert("Status dos palpites atualizado!");
    } catch (e) {
      console.error(e);
    }
  };

  const clearLocalBets = () => {
    if (
      confirm(
        "Remover a lista de palpites salva neste aparelho? (Os palpites continuam válidos no sistema, apenas não aparecerão neste resumo local)."
      )
    ) {
      localStorage.removeItem(LS_KEY);
      setLocalBets([]);
    }
  };

  const handleRegisterBet = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setPendingData(null);

    if (submitting) return;

    if (!formName.trim() || formName.trim().length < 2) {
      setErrorMsg("Informe seu nome (mínimo 2 caracteres).");
      return;
    }

    const cleanPhone = formPhone.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      setErrorMsg("Telefone inválido. Deve conter pelo menos o DDD e o número.");
      return;
    }

    if (!captchaAnswer.trim()) {
      setErrorMsg("Por favor, responda a pergunta de segurança.");
      return;
    }

    try {
      setSubmitting(true);

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

      const res = await fetch(`${supabaseUrl}/functions/v1/register-bet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseAnonKey,
          "Authorization": `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          nome: formName.trim(),
          whatsapp: formPhone.trim(),
          golsCasa: golsCasa,
          golsVisitante: golsVis,
          captchaToken: captchaToken,
          captchaResposta: captchaAnswer.trim(),
        }),
      });

      const json = await res.json();
      
      // Reload captcha regardless of success or failure
      await loadCaptcha();

      if (json.ok) {
        // Success
        setSuccessData(json.data);
        saveLocalBet({
          codigo: json.data.codigo,
          placar: json.data.placar,
          status: json.data.status,
          nome: formName.trim(),
          timeCasa: json.data.timeCasa,
          timeVisitante: json.data.timeVisitante,
          valor: json.data.valor,
        });
        
        // Reset form inputs except name/phone for convenience
        setGolsCasa("0");
        setGolsVis("0");
        
        // Refresh public statistics
        const { data: summary } = await supabase
          .from("public_pool_summary")
          .select("*")
          .eq("pool_id", pool?.id)
          .single();

        if (summary) {
          setStats({
            totalPaid: Number(summary.total_paid_bets || 0),
            estimatedPrize: Number(summary.estimated_prize || 0),
          });
        }
      } else {
        if (json.errorCode === "TEM_PENDENTE") {
          setPendingData(json.data);
        } else {
          setErrorMsg(json.message || "Erro desconhecido ao processar palpite.");
        }
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Falha na comunicação com o servidor. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyPixKey = (key: string) => {
    navigator.clipboard.writeText(key).then(() => {
      alert("Chave PIX copiada com sucesso!");
    });
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val);
  };

  const getThemeClass = () => {
    if (!pool) return "theme-verde";
    return `theme-${pool.theme}`;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white">
        <div className="spinner border-t-emerald-500 mb-4"></div>
        <p className="font-semibold text-lg animate-pulse">Carregando bolão...</p>
      </div>
    );
  }

  if (!pool) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-slate-300 p-6 text-center">
        <div className="text-6xl mb-4">⚽</div>
        <h1 className="text-2xl font-bold mb-2">Bolão de Placar Exato</h1>
        <p className="text-slate-400 max-w-md">Não há nenhum bolão ativo no momento. Volte em breve para participar!</p>
      </div>
    );
  }

  const isClosed = pool.status === "CLOSED" || new Date(pool.deadline) <= new Date();
  const isFinished = pool.status === "FINISHED";

  return (
    <div className={`${getThemeClass()} min-h-screen py-8 px-4 sm:px-6 lg:px-8`}>
      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* HEADER SECTION */}
        <header className="glass-card p-6 text-center flex flex-col items-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>
          
          <span className="text-xs uppercase tracking-widest font-semibold text-[var(--primary)] bg-[var(--primary-glow)] px-3 py-1 rounded-full mb-3">
            {pool.name}
          </span>
          
          {/* Match Versus Display */}
          <div className="flex items-center justify-center gap-6 my-4 w-full max-w-md">
            <div className="flex flex-col items-center flex-1 text-center">
              <img
                src={pool.home_team_image_url || `https://via.placeholder.com/56/16a34a/ffffff?text=${pool.home_team[0]}`}
                alt={pool.home_team}
                className="w-16 h-16 object-contain rounded-full shadow-sm bg-white p-1"
              />
              <span className="font-bold text-lg mt-2 text-slate-800 dark:text-slate-200 line-clamp-1">{pool.home_team}</span>
            </div>
            
            <div className="flex flex-col items-center">
              <span className="text-xs font-bold text-slate-400 tracking-wider">VS</span>
            </div>
            
            <div className="flex flex-col items-center flex-1 text-center">
              <img
                src={pool.away_team_image_url || `https://via.placeholder.com/56/15803d/ffffff?text=${pool.away_team[0]}`}
                alt={pool.away_team}
                className="w-16 h-16 object-contain rounded-full shadow-sm bg-white p-1"
              />
              <span className="font-bold text-lg mt-2 text-slate-800 dark:text-slate-200 line-clamp-1">{pool.away_team}</span>
            </div>
          </div>

          <div className="mt-4">
            {isFinished ? (
              <span className="status-badge badge-finished">FINALIZADO</span>
            ) : isClosed ? (
              <span className="status-badge badge-closed">FECHADO</span>
            ) : (
              <span className="status-badge badge-open animate-pulse">ABERTO</span>
            )}
          </div>
        </header>

        {/* METRICS CARDS */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="glass-card p-4 text-center">
            <span className="text-2xl font-bold text-emerald-600 block">{stats.totalPaid}</span>
            <span className="text-xs text-slate-400 font-medium uppercase">Confirmados</span>
          </div>
          <div className="glass-card p-4 text-center border-amber-500/20 bg-amber-500/[0.02]">
            <span className="text-2xl font-bold text-amber-500 block">{formatCurrency(stats.estimatedPrize)}</span>
            <span className="text-xs text-slate-400 font-medium uppercase">Prêmio Estimado</span>
          </div>
          <div className="glass-card p-4 text-center">
            <span className="text-2xl font-bold text-slate-700 dark:text-slate-300 block">{formatCurrency(pool.bet_amount)}</span>
            <span className="text-xs text-slate-400 font-medium uppercase">Custo / Palpite</span>
          </div>
          <div className="glass-card p-4 text-center col-span-2 md:col-span-1 flex flex-col justify-center">
            <span className="text-sm font-semibold text-rose-500 block">
              {new Date(pool.deadline).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="text-xs text-slate-400 font-medium uppercase">Prazo Limite</span>
          </div>
        </section>

        {/* MATCH RESULT (IF FINALIZED) */}
        {isFinished && result && (
          <section className="glass-card p-6 border-emerald-500 bg-emerald-500/[0.03] text-center space-y-4">
            <h2 className="text-xl font-bold text-emerald-700 dark:text-emerald-400 flex items-center justify-center gap-2">
              🏆 Resultado Oficial
            </h2>
            <div className="text-2xl font-extrabold tracking-wide my-2">
              {pool.home_team} {result.home_score} x {result.away_score} {pool.away_team}
            </div>
            
            <div className="grid grid-cols-3 gap-4 max-w-md mx-auto pt-4 border-t border-slate-200 dark:border-slate-800">
              <div>
                <span className="text-lg font-bold text-slate-800 dark:text-slate-200">{result.total_winners}</span>
                <p className="text-xs text-slate-400">Ganhadores</p>
              </div>
              <div>
                <span className="text-lg font-bold text-slate-800 dark:text-slate-200">{formatCurrency(result.total_prize)}</span>
                <p className="text-xs text-slate-400">Prêmio Total</p>
              </div>
              <div>
                <span className="text-lg font-bold text-emerald-600">{formatCurrency(result.prize_per_winner)}</span>
                <p className="text-xs text-slate-400">Por Ganhador</p>
              </div>
            </div>

            {result.total_winners > 0 && result.winners.length > 0 && (
              <div className="mt-4 p-4 bg-white dark:bg-slate-900/50 rounded-xl border border-dashed border-emerald-400/50">
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 block mb-2">🏅 Palpites Vencedores:</span>
                <div className="flex flex-wrap gap-2 justify-center">
                  {result.winners.map((win: any) => (
                    <span key={win.public_code} className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold px-3 py-1 rounded-lg text-sm border border-emerald-300/30">
                      {win.public_code}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-3">Se você possui um dos códigos vencedores acima, entre em contato imediatamente com o organizador.</p>
              </div>
            )}

            {result.total_winners === 0 && (
              <p className="text-sm text-slate-500 italic mt-3">Não houve acertadores do placar exato.</p>
            )}
          </section>
        )}

        {/* LOCAL SESSIONS PANEL ("MY BETS") */}
        {localBets.length > 0 && (
          <section className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                📋 Meus Palpites neste aparelho
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={updateLocalBetsStatus}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  🔄 Atualizar Status
                </button>
              </div>
            </div>
            
            <div className="space-y-3">
              {localBets.map((b) => (
                <div
                  key={b.codigo}
                  className="p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between flex-wrap gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold tracking-widest text-[var(--primary)] text-lg">{b.codigo}</span>
                      <span className="text-sm font-semibold">({b.placar})</span>
                    </div>
                    <p className="text-xs text-slate-400">Nome: {b.nome}</p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span
                      className={`status-badge text-xs ${
                        b.status === "PAID"
                          ? "badge-open"
                          : b.status === "REJECTED"
                          ? "badge-finished"
                          : "badge-closed bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300"
                      }`}
                    >
                      {b.status === "PAID" ? "Pago" : b.status === "REJECTED" ? "Recusado" : "Pendente"}
                    </span>

                    {b.status === "PENDING" && (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => copyPixKey(pool.pix_key)}
                          className="px-2 py-1 text-xs bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg cursor-pointer"
                          title="Copiar Chave PIX"
                        >
                          📋 Pix
                        </button>
                        <a
                          href={`https://wa.me/${pool.organizer_whatsapp}?text=${encodeURIComponent(
                            `Olá! Fiz um palpite no bolão.\n\nCódigo: ${b.codigo}\nNome: ${b.nome}\nPlacar: ${b.timeCasa || pool.home_team} ${b.placar} ${b.timeVisitante || pool.away_team}\n\nSegue o comprovante do pagamento.`
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg"
                        >
                          📲 Comprovante
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={clearLocalBets}
                className="text-xs text-rose-500 font-semibold hover:underline bg-transparent border-none p-0 cursor-pointer"
              >
                🗑️ Limpar histórico deste aparelho
              </button>
            </div>
          </section>
        )}

        {/* BET FORM */}
        {!isClosed && !isFinished && !successData && (
          <section className="glass-card p-6 space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              ⚽ Faça seu Palpite
            </h2>

            {errorMsg && (
              <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-300/40 text-rose-600 dark:text-rose-400 rounded-xl text-sm font-semibold">
                ⚠️ {errorMsg}
              </div>
            )}

            {/* Warning pending bet */}
            {pendingData && (
              <div className="p-5 bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-500 rounded-xl space-y-4 text-center">
                <div className="text-3xl">⚠️</div>
                <h3 className="font-bold text-amber-700 dark:text-amber-400">Você já possui um palpite pendente!</h3>
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg max-w-xs mx-auto text-sm space-y-1">
                  <p><b>Código:</b> <span className="font-mono font-bold tracking-widest">{pendingData.codigoPendente}</span></p>
                  <p><b>Placar:</b> {pendingData.placarPendente}</p>
                </div>
                <p className="text-xs text-slate-500">
                  Para registrar um novo palpite, você deve efetuar o pagamento do pendente ou pedir cancelamento via WhatsApp.
                </p>
                <div className="flex flex-col gap-2 max-w-xs mx-auto">
                  <a
                    href={`https://wa.me/${pool.organizer_whatsapp}?text=${encodeURIComponent(
                      `Olá! Gostaria de solicitar o cancelamento do meu palpite pendente código: ${pendingData.codigoPendente} (${pendingData.placarPendente}). Quero fazer uma nova aposta.`
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-primary bg-rose-600 hover:bg-rose-700 text-xs no-underline block"
                  >
                    📲 Solicitar cancelamento no WhatsApp
                  </a>
                  <button
                    onClick={() => setPendingData(null)}
                    className="btn-secondary text-xs"
                  >
                    Fechar aviso
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleRegisterBet} className="space-y-4">
              
              <div className="flex flex-col space-y-1">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Seu Nome Completo</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: João Silva"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  maxLength={60}
                  className="custom-input"
                />
              </div>

              <div className="flex flex-col space-y-1">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300">WhatsApp (com DDD)</label>
                <input
                  type="tel"
                  required
                  placeholder="Ex: 11999999999"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  maxLength={20}
                  className="custom-input"
                />
                <span className="text-[10px] text-slate-400">Insira somente os números com DDD.</span>
              </div>

              <div className="flex flex-col space-y-2">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-300 text-center block mb-2">Seu Palpite de Placar</label>
                
                <div className="flex items-center justify-center gap-4 bg-slate-50 dark:bg-slate-900/30 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="flex flex-col items-center flex-1 text-center">
                    <span className="font-bold text-sm text-slate-700 dark:text-slate-300 line-clamp-1">{pool.home_team}</span>
                  </div>

                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={golsCasa}
                    onChange={(e) => setGolsCasa(e.target.value)}
                    className="w-16 text-center text-xl font-bold custom-input"
                  />
                  
                  <span className="text-slate-400 font-bold">×</span>

                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={golsVis}
                    onChange={(e) => setGolsVis(e.target.value)}
                    className="w-16 text-center text-xl font-bold custom-input"
                  />

                  <div className="flex flex-col items-center flex-1 text-center">
                    <span className="font-bold text-sm text-slate-700 dark:text-slate-300 line-clamp-1">{pool.away_team}</span>
                  </div>
                </div>
              </div>

              {/* SECURITY CAPTCHA BLOCK */}
              {captchaQuestion && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                  <label className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    🔐 Verificação de segurança
                  </label>
                  <p className="text-xs text-slate-500 font-medium">{captchaQuestion}</p>
                  <input
                    type="number"
                    required
                    placeholder="Sua resposta"
                    value={captchaAnswer}
                    onChange={(e) => setCaptchaAnswer(e.target.value)}
                    className="custom-input w-full max-w-[200px]"
                  />
                </div>
              )}

              {/* SUBMIT BUTTON WITH PROTECTION */}
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="spinner"></span>
                    <span>Enviando palpite...</span>
                  </>
                ) : (
                  <span>🎯 Enviar Palpite</span>
                )}
              </button>
            </form>
          </section>
        )}

        {/* REGISTRATION SUCCESS DIALOG */}
        {successData && (
          <section className="glass-card p-6 text-center space-y-6 animate-[fadeIn_0.3s_ease]">
            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center text-2xl mx-auto">
              ✅
            </div>
            
            <div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200">Palpite pré-registrado!</h2>
              <p className="text-xs text-slate-400 mt-1">
                Efetue o pagamento PIX abaixo para validar sua participação.
              </p>
            </div>

            <div className="py-4 px-5 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-800 max-w-sm mx-auto space-y-3">
              <div>
                <span className="text-xs font-semibold text-slate-400 block uppercase">Código do Palpite</span>
                <span className="text-2xl font-extrabold tracking-widest text-[var(--primary)]">{successData.codigo}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-left text-xs text-slate-500 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div><b>Placar:</b> {successData.placar}</div>
                <div><b>Valor:</b> {successData.valor}</div>
                <div className="col-span-2"><b>Chave PIX:</b> <span className="font-mono text-[10px] break-all select-all font-bold">{successData.chavePix}</span></div>
                <div className="col-span-2"><b>Nome Recebedor:</b> {successData.nomeRecebedor}</div>
              </div>
            </div>

            <div className="flex flex-col gap-2 max-w-sm mx-auto">
              <button
                onClick={() => copyPixKey(successData.chavePix)}
                className="btn-primary flex items-center justify-center gap-2"
              >
                📋 Copiar Chave PIX
              </button>
              
              <a
                href={`https://wa.me/${successData.whatsappOrg}?text=${encodeURIComponent(
                  `Olá! Fiz um palpite no bolão.\n\nCódigo: ${successData.codigo}\nNome: ${successData.nome}\nTelefone: ${formPhone}\nPalpite: ${successData.timeCasa} ${successData.placar} ${successData.timeVisitante}\nValor: ${successData.valor}\n\nSegue o comprovante do pagamento via PIX.`
                )}`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary no-underline flex items-center justify-center gap-2 border-2 border-emerald-500 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
              >
                📲 Enviar comprovante no WhatsApp
              </a>

              <button
                onClick={() => setSuccessData(null)}
                className="text-xs text-slate-400 hover:underline cursor-pointer bg-transparent border-none mt-2"
              >
                Fazer outro palpite
              </button>
            </div>
          </section>
        )}

        {/* CLOSED ALERT */}
        {isClosed && !isFinished && (
          <section className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-300/40 text-rose-600 dark:text-rose-400 rounded-xl text-center font-bold">
            🔒 Bolão encerrado. Não é mais possível registrar novos palpites.
          </section>
        )}

        {/* NAVIGATION QUICK BAR */}
        <section className="flex justify-center gap-4 text-sm font-semibold">
          <a href="/consulta" className="text-[var(--primary)] hover:underline">🔍 Consultar Palpites</a>
          <span className="text-slate-300">•</span>
          <a href="/transparencia" className="text-[var(--primary)] hover:underline">📊 Transparência</a>
        </section>

        {/* RULES */}
        <section className="glass-card p-6 space-y-4">
          <h2 className="text-lg font-bold">📜 Regras do Bolão</h2>
          <ol className="list-decimal pl-5 text-sm text-slate-600 dark:text-slate-400 space-y-2.5">
            <li>Cada palpite possui o valor definido pelo organizador (<b>{formatCurrency(pool.bet_amount)}</b>).</li>
            <li>O participante deve informar o placar exato da partida.</li>
            <li>O palpite só será validado após a confirmação do pagamento pelo organizador.</li>
            <li>Palpites pendentes não concorrem. Se você tem um palpite pendente, pague-o ou solicite cancelamento.</li>
            <li>O prêmio estimado corresponde a <b>{pool.prize_percent}%</b> do valor arrecadado com palpites pagos.</li>
            <li>Os <b>{100 - pool.prize_percent}%</b> restantes são destinados à taxa administrativa/organização do bolão.</li>
            <li>Se houver mais de um ganhador, o prêmio será dividido igualmente.</li>
            <li>Após a data limite (<b>{new Date(pool.deadline).toLocaleString("pt-BR")}</b>), novos palpites não serão aceitos.</li>
            <li>Ao lançar o resultado oficial, o bolão é fechado automaticamente e os ganhadores são calculados.</li>
          </ol>
        </section>

        {/* FOOTER */}
        <footer className="text-center text-xs text-slate-400 pt-4">
          ⚽ Bolão Placar Exato • Desenvolvido com Next.js + Supabase
        </footer>

      </div>
    </div>
  );
}
