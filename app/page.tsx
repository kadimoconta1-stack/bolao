"use client";

import { useEffect, useState, useCallback } from "react";
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

// ─── Modal: Consulta ────────────────────────────────────────────────────────
function ConsultaModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const { data, error: err } = await supabase
        .from("public_bets_consultation")
        .select("*")
        .ilike("public_code", query.trim())
        .single();
      if (err || !data) {
        setError("Palpite não encontrado. Verifique o código e tente novamente.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Erro ao buscar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-black">🔍 Consultar Palpite</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl font-bold cursor-pointer bg-transparent border-none">✕</button>
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            placeholder="Ex: ABC1234"
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            className="custom-input flex-1 text-sm"
          />
          <button type="submit" disabled={loading} className="btn-primary px-4 py-2 text-sm">
            {loading ? <span className="spinner" /> : "Buscar"}
          </button>
        </form>
        {error && <p className="text-rose-500 text-sm mt-3 font-semibold">{error}</p>}
        {result && (
          <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-extrabold tracking-widest text-[var(--primary)] text-xl">{result.public_code}</span>
              <span className={`status-badge text-xs ${result.status === "PAID" ? "badge-open" : result.status === "REJECTED" ? "badge-finished" : "badge-closed bg-yellow-100 text-yellow-800"}`}>
                {result.status === "PAID" ? "✅ Pago" : result.status === "REJECTED" ? "❌ Recusado" : "⏳ Pendente"}
              </span>
            </div>
            <p><b>Nome:</b> {result.participant_name}</p>
            {result.status === "PAID" && <p><b>Palpite:</b> {result.home_score} × {result.away_score}</p>}
            <p className="text-xs text-slate-400">Registrado em: {new Date(result.created_at).toLocaleString("pt-BR")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal: Transparência ───────────────────────────────────────────────────
function TransparenciaModal({ poolId, onClose }: { poolId: string; onClose: () => void }) {
  const [bets, setBets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("public_paid_bets")
      .select("*")
      .eq("pool_id", poolId)
      .order("payment_confirmed_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setBets(data || []);
        setLoading(false);
      });
  }, [poolId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-black">📊 Palpites Confirmados</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl font-bold cursor-pointer bg-transparent border-none">✕</button>
        </div>
        {loading ? (
          <div className="text-center py-8"><span className="spinner border-t-[var(--primary)]" /></div>
        ) : bets.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-8">Nenhum palpite confirmado ainda.</p>
        ) : (
          <div className="overflow-y-auto max-h-96 space-y-2">
            {bets.map((b) => (
              <div key={b.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-800 text-sm">
                <div>
                  <span className="font-extrabold tracking-wider text-[var(--primary)]">{b.public_code}</span>
                  <p className="text-xs text-slate-400">{b.participant_name}</p>
                </div>
                <span className="status-badge badge-open text-xs">Pago ✅</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function Home() {
  const [pool, setPool] = useState<Pool | null>(null);
  const [totalBets, setTotalBets] = useState(0);
  const [totalPaid, setTotalPaid] = useState(0);
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
  const [showConsulta, setShowConsulta] = useState(false);
  const [showTransparencia, setShowTransparencia] = useState(false);
  const [pixCopied, setPixCopied] = useState(false);
  // Auto-close state (driven by client-side timer — zero Supabase quota)
  const [deadlinePassed, setDeadlinePassed] = useState(false);

  const LS_KEY = "bpe5_meus_palpites";

  // ── Fetch pool & stats ───────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const { data: pools, error: poolError } = await supabase
        .from("pools")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);

      if (poolError) throw poolError;
      if (!pools || pools.length === 0) { setPool(null); setLoading(false); return; }

      const activePool = pools[0] as Pool;
      setPool(activePool);

      // Stats: use public_pool_summary view (RLS-safe, no privileged access needed)
      const { data: summary } = await supabase
        .from("public_pool_summary")
        .select("total_paid_bets")
        .eq("pool_id", activePool.id)
        .single();

      // Total bets: query public_bets_consultation (view, RLS-safe) for count
      const { count: allBetsCount } = await supabase
        .from("public_bets_consultation")
        .select("public_code", { count: "exact", head: true })
        .eq("pool_id", activePool.id);

      setTotalBets(allBetsCount ?? 0);
      setTotalPaid(Number(summary?.total_paid_bets ?? 0));

      await loadCaptcha();

      if (activePool.status === "FINISHED") {
        const { data: res } = await supabase
          .from("results")
          .select("*")
          .eq("pool_id", activePool.id)
          .single();

        if (res) {
          const { data: winners } = await supabase
            .from("public_paid_bets")
            .select("public_code, score_key")
            .eq("is_winner", true);
          setResult({ ...res, winners: winners || [] });
        }
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Erro ao carregar dados do bolão.");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Real-time subscription: update local bets status automatically ────────
  useEffect(() => {
    fetchData();
    loadLocalBets(syncLocalBetsStatus);
  }, [fetchData]);


  useEffect(() => {
    if (!pool) return;

    // Subscribe to bet changes on this pool
    const channel = supabase
      .channel(`pool-bets-${pool.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "bets", filter: `pool_id=eq.${pool.id}` },
        (payload) => {
          const updatedBet = payload.new as any;
          // Update stats
          setTotalBets((prev) => prev); // unchanged on UPDATE
          fetchStats(pool.id);
          // Update local bets stored on device in real-time
          setLocalBets((prev) => {
            const updated = prev.map((b) =>
              b.codigo === updatedBet.public_code ? { ...b, status: updatedBet.status } : b
            );
            try { localStorage.setItem(LS_KEY, JSON.stringify(updated)); } catch {}
            return updated;
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [pool]);

  // ── Auto-close when deadline arrives (client-side timer, zero quota) ───────
  useEffect(() => {
    if (!pool || pool.status === "CLOSED" || pool.status === "FINISHED") return;
    const msUntilDeadline = new Date(pool.deadline).getTime() - Date.now();
    if (msUntilDeadline <= 0) {
      setDeadlinePassed(true);
      return;
    }
    const timer = setTimeout(() => setDeadlinePassed(true), msUntilDeadline);
    return () => clearTimeout(timer);
  }, [pool]);

  const fetchStats = async (poolId: string) => {
    const { data: summary } = await supabase
      .from("public_pool_summary")
      .select("total_paid_bets")
      .eq("pool_id", poolId)
      .single();

    const { count: allBetsCount } = await supabase
      .from("public_bets_consultation")
      .select("public_code", { count: "exact", head: true })
      .eq("pool_id", poolId);

    setTotalBets(allBetsCount ?? 0);
    setTotalPaid(Number(summary?.total_paid_bets ?? 0));
  };

  // ── Captcha ──────────────────────────────────────────────────────────────
  const loadCaptcha = async () => {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
      const res = await fetch(`${supabaseUrl}/functions/v1/get-captcha`, {
        method: "GET",
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
      });
      const json = await res.json();
      if (json.ok) { setCaptchaQuestion(json.data.question); setCaptchaToken(json.data.token); setCaptchaAnswer(""); }
    } catch {}
  };

  // ── Local bets helpers ───────────────────────────────────────────────────
  const loadLocalBets = (onLoaded?: (bets: LocalBet[]) => void) => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed: LocalBet[] = JSON.parse(raw);
        setLocalBets(parsed);
        onLoaded?.(parsed);
      }
    } catch {}
  };

  // Sync all stored bets' statuses from DB in a single batch query
  const syncLocalBetsStatus = async (stored: LocalBet[]) => {
    if (!stored.length) return;
    try {
      const codes = stored.map((b) => b.codigo);
      const { data } = await supabase
        .from("public_bets_consultation")
        .select("public_code, status")
        .in("public_code", codes);
      if (!data || data.length === 0) return;

      // Build a lookup map
      const statusMap: Record<string, string> = {};
      data.forEach((row: any) => { statusMap[row.public_code] = row.status; });

      setLocalBets((prev) => {
        const updated = prev.map((b) =>
          statusMap[b.codigo] !== undefined ? { ...b, status: statusMap[b.codigo] } : b
        );
        try { localStorage.setItem(LS_KEY, JSON.stringify(updated)); } catch {}
        return updated;
      });
    } catch {
      // silently fail — status will be updated via realtime
    }
  };

  const saveLocalBet = (bet: LocalBet) => {
    const current = [...localBets];
    if (!current.some((b) => b.codigo === bet.codigo)) {
      current.unshift(bet);
      setLocalBets(current);
      try { localStorage.setItem(LS_KEY, JSON.stringify(current)); } catch {}
    }
  };

  const clearLocalBets = () => {
    if (confirm("Remover lista de palpites deste aparelho? Os palpites continuam válidos no sistema.")) {
      localStorage.removeItem(LS_KEY);
      setLocalBets([]);
    }
  };

  // ── Register bet ─────────────────────────────────────────────────────────
  const handleRegisterBet = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setPendingData(null);
    if (submitting) return;
    if (!formName.trim() || formName.trim().length < 2) { setErrorMsg("Informe seu nome (mínimo 2 caracteres)."); return; }
    const cleanPhone = formPhone.replace(/\D/g, "");
    if (cleanPhone.length < 10) { setErrorMsg("Telefone inválido. Use DDD + número."); return; }
    if (!captchaAnswer.trim()) { setErrorMsg("Responda a verificação de segurança."); return; }

    try {
      setSubmitting(true);
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
      const res = await fetch(`${supabaseUrl}/functions/v1/register-bet`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
        body: JSON.stringify({ nome: formName.trim(), whatsapp: formPhone.trim(), golsCasa, golsVisitante: golsVis, captchaToken, captchaResposta: captchaAnswer.trim() }),
      });
      const json = await res.json();
      await loadCaptcha();

      if (json.ok) {
        setSuccessData(json.data);
        saveLocalBet({ codigo: json.data.codigo, placar: json.data.placar, status: json.data.status, nome: formName.trim(), timeCasa: json.data.timeCasa, timeVisitante: json.data.timeVisitante, valor: json.data.valor });
        setGolsCasa("0");
        setGolsVis("0");
        if (pool) fetchStats(pool.id);
      } else {
        if (json.errorCode === "TEM_PENDENTE") setPendingData(json.data);
        else setErrorMsg(json.message || "Erro ao processar palpite.");
      }
    } catch { setErrorMsg("Falha na comunicação. Tente novamente."); }
    finally { setSubmitting(false); }
  };

  const copyPixKey = (key: string) => {
    navigator.clipboard.writeText(key).then(() => { setPixCopied(true); setTimeout(() => setPixCopied(false), 2500); });
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);

  const getThemeClass = () => (pool ? `theme-${pool.theme}` : "theme-verde");

  // ── Team logo — rectangular, no crop ────────────────────────────────────
  const teamLogo = (url: string | null, name: string) =>
    url ? (
      <img
        src={url}
        alt={name}
        className="max-h-24 max-w-[120px] w-auto h-auto object-contain rounded-xl shadow-lg bg-white/80 p-1"
      />
    ) : (
      <div className="w-20 h-20 rounded-xl bg-[var(--primary)] text-white flex items-center justify-center font-black text-4xl shadow-lg">
        {name[0]}
      </div>
    );

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white gap-4">
        <div className="text-5xl animate-bounce">⚽</div>
        <p className="font-bold text-lg animate-pulse text-slate-300">Carregando bolão...</p>
      </div>
    );
  }

  if (!pool) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-slate-300 p-6 text-center gap-4">
        <div className="text-7xl">⚽</div>
        <h1 className="text-2xl font-bold">Bolão de Placar Exato</h1>
        <p className="text-slate-400 max-w-md">Não há nenhum bolão ativo no momento. Volte em breve!</p>
      </div>
    );
  }

  const isFinished = pool.status === "FINISHED";
  const isClosed = !isFinished && (pool.status === "CLOSED" || deadlinePassed || new Date(pool.deadline) <= new Date());
  const isOpen = !isClosed && !isFinished;

  return (
    <div className={`${getThemeClass()} min-h-screen`}>
      {/* Modals */}
      {showConsulta && <ConsultaModal onClose={() => setShowConsulta(false)} />}
      {showTransparencia && pool && <TransparenciaModal poolId={pool.id} onClose={() => setShowTransparencia(false)} />}

      {/* ── HERO HEADER ─────────────────────────────────────────────────── */}
      <header className="hero-header relative overflow-hidden">
        {/* Decorative blobs */}
        <div className="blob blob-1" />
        <div className="blob blob-2" />

        <div className="relative z-10 max-w-3xl mx-auto px-4 py-10 text-center">
          {/* Pool badge */}
          <span className="inline-block text-xs uppercase tracking-widest font-bold px-4 py-1.5 rounded-full mb-4 bg-[var(--primary-glow)] text-[var(--primary)] border border-[var(--primary)]/30">
            {pool.name}
          </span>

          {/* Status & Deadline badges */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
            {isFinished ? (
              <span className="status-badge badge-finished text-sm px-4 py-1.5">🏁 FINALIZADO</span>
            ) : isClosed ? (
              <>
                <span className="status-badge badge-closed text-sm px-4 py-1.5">🔒 ENCERRADO</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20">
                  Encerrado em: {new Date(pool.deadline).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </>
            ) : (
              <>
                <span className="status-badge badge-open text-sm px-4 py-1.5 animate-pulse">🟢 ABERTO PARA PALPITES</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20">
                  ⏰ Limite: {new Date(pool.deadline).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </>
            )}
          </div>

          {/* Teams versus */}
          <div className="flex items-center justify-center gap-4 sm:gap-10 my-6">
            <div className="flex flex-col items-center gap-3 flex-1 min-w-0">
              <div className="flex items-center justify-center min-h-[6rem]">
                {teamLogo(pool.home_team_image_url, pool.home_team)}
              </div>
              <span className="font-black text-lg sm:text-2xl text-[var(--text-main)] text-center leading-tight">{pool.home_team}</span>
            </div>

            <div className="flex flex-col items-center gap-1 shrink-0">
              <span className="text-3xl font-black text-[var(--primary)]">VS</span>
              <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Placar Exato</span>
            </div>

            <div className="flex flex-col items-center gap-3 flex-1 min-w-0">
              <div className="flex items-center justify-center min-h-[6rem]">
                {teamLogo(pool.away_team_image_url, pool.away_team)}
              </div>
              <span className="font-black text-lg sm:text-2xl text-[var(--text-main)] text-center leading-tight">{pool.away_team}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
            <button onClick={() => setShowConsulta(true)} className="btn-secondary flex items-center gap-2 text-sm py-2.5 px-5">
              🔍 Consultar Palpite
            </button>
            <button onClick={() => setShowTransparencia(true)} className="btn-secondary flex items-center gap-2 text-sm py-2.5 px-5">
              📊 Transparência
            </button>
          </div>
        </div>
      </header>

      {/* ── CONTENT ─────────────────────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Result (if finished) */}
        {isFinished && result && (
          <section className="glass-card p-6 border-[var(--primary)]/40 text-center space-y-4">
            <h2 className="text-xl font-black text-[var(--primary)] flex items-center justify-center gap-2">🏆 Resultado Oficial</h2>
            <div className="text-3xl font-extrabold tracking-wide">
              {pool.home_team} <span className="text-[var(--primary)]">{result.home_score} × {result.away_score}</span> {pool.away_team}
            </div>
            <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto pt-4 border-t border-[var(--card-border)]">
              <div><span className="text-xl font-black">{result.total_winners}</span><p className="text-xs text-[var(--text-muted)]">Ganhadores</p></div>
              <div><span className="text-lg font-black">{formatCurrency(result.total_prize)}</span><p className="text-xs text-[var(--text-muted)]">Prêmio Total</p></div>
              <div><span className="text-lg font-black text-[var(--primary)]">{formatCurrency(result.prize_per_winner)}</span><p className="text-xs text-[var(--text-muted)]">Por Ganhador</p></div>
            </div>
            {result.total_winners > 0 && (
              <div className="p-4 bg-[var(--primary-glow)] rounded-xl border border-[var(--primary)]/30">
                <span className="text-sm font-bold text-[var(--primary)] block mb-2">🏅 Palpites Vencedores:</span>
                <div className="flex flex-wrap gap-2 justify-center">
                  {result.winners.map((w: any) => (
                    <span key={w.public_code} className="font-black px-3 py-1 rounded-lg text-sm bg-[var(--primary)] text-white">{w.public_code}</span>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Meus Palpites */}
        {localBets.length > 0 && (
          <section className="glass-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-base flex items-center gap-2">📋 Meus Palpites <span className="text-xs font-normal text-[var(--text-muted)]">(este aparelho)</span></h2>
            </div>
            <div className="space-y-3">
              {localBets.map((b) => (
                <div key={b.codigo} className="p-4 rounded-xl border border-[var(--card-border)] bg-[var(--primary-glow)] flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold tracking-widest text-[var(--primary)] text-lg">{b.codigo}</span>
                      <span className="text-sm font-semibold text-[var(--text-muted)]">({b.placar})</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">{b.nome}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`status-badge text-xs ${b.status === "PAID" ? "badge-open" : b.status === "REJECTED" ? "badge-finished" : "badge-closed bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300"}`}>
                      {b.status === "PAID" ? "✅ Pago" : b.status === "REJECTED" ? "❌ Recusado" : "⏳ Pendente"}
                    </span>
                    {b.status === "PENDING" && pool && (
                      <div className="flex gap-1.5">
                        <button onClick={() => copyPixKey(pool.pix_key)} className="px-2 py-1 text-xs bg-[var(--primary)] text-white font-bold rounded-lg cursor-pointer">📋 Pix</button>
                        <a
                          href={`https://wa.me/${pool.organizer_whatsapp}?text=${encodeURIComponent(`Olá! Fiz um palpite no bolão.\n\nCódigo: ${b.codigo}\nNome: ${b.nome}\nPlacar: ${b.timeCasa || pool.home_team} ${b.placar} ${b.timeVisitante || pool.away_team}\n\nSegue o comprovante do pagamento.`)}`}
                          target="_blank" rel="noreferrer"
                          className="px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg no-underline"
                        >
                          📲 Comprovante
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-[var(--card-border)]">
              <button onClick={clearLocalBets} className="text-xs text-rose-500 font-semibold hover:underline bg-transparent border-none p-0 cursor-pointer">🗑️ Limpar histórico deste aparelho</button>
            </div>
          </section>
        )}

        {/* Bet form */}
        {isOpen && !successData && (
          <section className="glass-card p-6 space-y-5">
            <h2 className="text-xl font-black flex items-center gap-2">⚽ Faça seu Palpite</h2>

            {errorMsg && (
              <div className="p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-300/40 text-rose-600 dark:text-rose-400 rounded-xl text-sm font-semibold">⚠️ {errorMsg}</div>
            )}

            {pendingData && (
              <div className="p-5 bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-500 rounded-xl space-y-4 text-center">
                <div className="text-3xl">⚠️</div>
                <h3 className="font-bold text-amber-700 dark:text-amber-400">Você já possui um palpite pendente!</h3>
                <div className="p-3 bg-white dark:bg-slate-900 rounded-lg max-w-xs mx-auto text-sm space-y-1">
                  <p><b>Código:</b> <span className="font-mono font-bold tracking-widest">{pendingData.codigoPendente}</span></p>
                  <p><b>Placar:</b> {pendingData.placarPendente}</p>
                </div>
                <div className="flex flex-col gap-2 max-w-xs mx-auto">
                  <a href={`https://wa.me/${pool.organizer_whatsapp}?text=${encodeURIComponent(`Olá! Gostaria de cancelar o palpite pendente: ${pendingData.codigoPendente}`)}`} target="_blank" rel="noreferrer" className="btn-primary bg-rose-600 hover:bg-rose-700 text-xs no-underline block text-center">
                    📲 Solicitar cancelamento
                  </a>
                  <button onClick={() => setPendingData(null)} className="btn-secondary text-xs">Fechar</button>
                </div>
              </div>
            )}

            <form onSubmit={handleRegisterBet} className="space-y-4">
              <div className="flex flex-col space-y-1">
                <label className="text-sm font-bold">Seu Nome Completo</label>
                <input type="text" required placeholder="Ex: João Silva" value={formName} onChange={(e) => setFormName(e.target.value)} maxLength={60} className="custom-input" />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="text-sm font-bold">WhatsApp (com DDD)</label>
                <input type="tel" required placeholder="Ex: 11999999999" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} maxLength={20} className="custom-input" />
                <span className="text-[10px] text-[var(--text-muted)]">Somente números com DDD.</span>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold block text-center">Seu Palpite de Placar</label>
                <div className="flex items-center justify-center gap-3 p-5 rounded-xl border border-[var(--card-border)] bg-[var(--primary-glow)]">
                  <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                    <div className="flex items-center justify-center h-14">
                      {pool.home_team_image_url ? (
                        <img src={pool.home_team_image_url} alt={pool.home_team} className="max-h-12 max-w-[64px] w-auto h-auto object-contain rounded-lg bg-white/80 p-0.5 shadow" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-[var(--primary)] text-white flex items-center justify-center font-black text-xl shadow">{pool.home_team[0]}</div>
                      )}
                    </div>
                    <span className="font-bold text-xs text-center leading-tight">{pool.home_team}</span>
                  </div>
                  <input type="number" min="0" max="20" value={golsCasa} onChange={(e) => setGolsCasa(e.target.value)} className="w-16 text-center text-2xl font-black custom-input" />
                  <span className="text-xl font-black text-[var(--primary)]">×</span>
                  <input type="number" min="0" max="20" value={golsVis} onChange={(e) => setGolsVis(e.target.value)} className="w-16 text-center text-2xl font-black custom-input" />
                  <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                    <div className="flex items-center justify-center h-14">
                      {pool.away_team_image_url ? (
                        <img src={pool.away_team_image_url} alt={pool.away_team} className="max-h-12 max-w-[64px] w-auto h-auto object-contain rounded-lg bg-white/80 p-0.5 shadow" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-[var(--primary)] text-white flex items-center justify-center font-black text-xl shadow">{pool.away_team[0]}</div>
                      )}
                    </div>
                    <span className="font-bold text-xs text-center leading-tight">{pool.away_team}</span>
                  </div>
                </div>
              </div>

              {captchaQuestion && (
                <div className="p-4 bg-[var(--primary-glow)] rounded-xl border border-[var(--primary)]/20 space-y-2">
                  <label className="text-sm font-bold flex items-center gap-1">🔐 Verificação de Segurança</label>
                  <p className="text-sm font-medium">{captchaQuestion}</p>
                  <input type="number" required placeholder="Sua resposta" value={captchaAnswer} onChange={(e) => setCaptchaAnswer(e.target.value)} className="custom-input w-full max-w-[180px]" />
                </div>
              )}

              <button type="submit" disabled={submitting} className="btn-primary w-full py-3.5 text-base font-black flex items-center justify-center gap-2">
                {submitting ? <><span className="spinner" /><span>Enviando...</span></> : <span>🎯 Enviar Palpite — {formatCurrency(pool.bet_amount)}</span>}
              </button>
            </form>
          </section>
        )}

        {/* Success */}
        {successData && (
          <section className="glass-card p-6 text-center space-y-5">
            <div className="w-16 h-16 bg-[var(--primary-glow)] text-4xl rounded-full flex items-center justify-center mx-auto">✅</div>
            <div>
              <h2 className="text-xl font-black">Palpite Enviado!</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">Efetue o pagamento PIX para validar sua participação.</p>
            </div>
            <div className="py-4 px-5 bg-[var(--primary-glow)] rounded-xl border border-[var(--primary)]/30 max-w-sm mx-auto space-y-3">
              <div>
                <span className="text-xs font-semibold text-[var(--text-muted)] block uppercase">Código do Palpite</span>
                <span className="text-3xl font-extrabold tracking-widest text-[var(--primary)]">{successData.codigo}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-left text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--card-border)]">
                <div><b>Placar:</b> {successData.placar}</div>
                <div><b>Valor:</b> {successData.valor}</div>
                <div className="col-span-2"><b>Chave PIX:</b> <span className="font-mono text-[10px] break-all select-all font-bold">{successData.chavePix}</span></div>
                <div className="col-span-2"><b>Recebedor:</b> {successData.nomeRecebedor}</div>
              </div>
            </div>
            <div className="flex flex-col gap-2 max-w-sm mx-auto">
              <button onClick={() => copyPixKey(successData.chavePix)} className="btn-primary flex items-center justify-center gap-2">
                {pixCopied ? "✅ PIX Copiado!" : "📋 Copiar Chave PIX"}
              </button>
              <a href={`https://wa.me/${successData.whatsappOrg}?text=${encodeURIComponent(`Olá! Fiz um palpite no bolão.\n\nCódigo: ${successData.codigo}\nNome: ${successData.nome}\nPalpite: ${successData.timeCasa} ${successData.placar} ${successData.timeVisitante}\nValor: ${successData.valor}\n\nSegue o comprovante do pagamento.`)}`} target="_blank" rel="noreferrer" className="btn-secondary no-underline flex items-center justify-center gap-2 border-2 border-[var(--primary)] text-[var(--primary)]">
                📲 Enviar Comprovante via WhatsApp
              </a>
              <button onClick={() => setSuccessData(null)} className="text-xs text-[var(--text-muted)] hover:underline cursor-pointer bg-transparent border-none mt-1">
                Fazer outro palpite
              </button>
            </div>
          </section>
        )}

        {/* Closed */}
        {isClosed && !isFinished && (
          <section className="p-5 bg-rose-50 dark:bg-rose-950/30 border border-rose-300/40 text-rose-600 dark:text-rose-400 rounded-xl text-center font-bold">
            🔒 Bolão encerrado para novos palpites.
          </section>
        )}

        {/* Stats card below the action card */}
        <section className="glass-card p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div className="p-3 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-200/50 dark:border-slate-800/50 flex flex-col justify-center items-center">
              <span className="text-xl sm:text-2xl mb-1">📩</span>
              <span className="block text-2xl sm:text-3xl font-black text-[var(--primary)]">{totalBets}</span>
              <span className="text-[10px] sm:text-xs uppercase font-bold tracking-wider text-[var(--text-muted)]">Total de Palpites</span>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-200/50 dark:border-slate-800/50 flex flex-col justify-center items-center">
              <span className="text-xl sm:text-2xl mb-1">✅</span>
              <span className="block text-2xl sm:text-3xl font-black text-[var(--primary)]">{totalPaid}</span>
              <span className="text-[10px] sm:text-xs uppercase font-bold tracking-wider text-[var(--text-muted)]">Palpites Pagos</span>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-200/50 dark:border-slate-800/50 flex flex-col justify-center items-center">
              <span className="text-xl sm:text-2xl mb-1">🏆</span>
              <span className="block text-2xl sm:text-3xl font-black text-emerald-500">
                {formatCurrency(totalPaid * pool.bet_amount * (pool.prize_percent / 100))}
              </span>
              <span className="text-[10px] sm:text-xs uppercase font-bold tracking-wider text-[var(--text-muted)]">Prêmio Estimado</span>
            </div>
            <div className="p-3 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-200/50 dark:border-slate-800/50 flex flex-col justify-center items-center">
              <span className="text-xl sm:text-2xl mb-1">🎫</span>
              <span className="block text-2xl sm:text-3xl font-black text-[var(--primary)]">{formatCurrency(pool.bet_amount)}</span>
              <span className="text-[10px] sm:text-xs uppercase font-bold tracking-wider text-[var(--text-muted)]">Por Palpite</span>
            </div>
          </div>
        </section>

        {/* Rules */}
        <section className="glass-card p-6 space-y-4">
          <h2 className="text-lg font-black">📜 Regras do Bolão</h2>
          <ol className="list-decimal pl-5 text-sm text-[var(--text-muted)] space-y-2.5">
            <li>Cada palpite custa <b>{formatCurrency(pool.bet_amount)}</b>.</li>
            <li>Você deve acertar o placar <b>exato</b> da partida para ganhar.</li>
            <li>O palpite é válido apenas após a <b>confirmação do pagamento</b> pelo organizador.</li>
            <li>Palpites pendentes <b>não concorrem</b>.</li>
            <li>O prêmio é <b>{pool.prize_percent}%</b> do total arrecadado com palpites pagos.</li>
            <li>Se houver mais de um ganhador, o prêmio será dividido igualmente.</li>
            <li>Prazo final: <b>{new Date(pool.deadline).toLocaleString("pt-BR")}</b>.</li>
          </ol>
        </section>

        {/* Footer */}
        <footer className="text-center text-xs text-[var(--text-muted)] pt-2 pb-6">
          ⚽ Bolão Placar Exato — Desenvolvido com Next.js + Supabase
        </footer>
      </div>
    </div>
  );
}
