"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Pool {
  id: string;
  name: string;
  home_team: string;
  away_team: string;
  theme: string;
}

interface BetDetails {
  public_code: string;
  home_score: number;
  away_score: number;
  status: "PENDING" | "PAID" | "REJECTED";
  is_winner: boolean;
  created_at: string;
  amount: number;
  pool_id: string;
}

export default function Consulta() {
  const [pool, setPool] = useState<Pool | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [bet, setBet] = useState<BetDetails | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"error" | "success" | "">("");

  const LS_KEY = "bpe5_meus_palpites";

  useEffect(() => {
    fetchActivePool();
  }, []);

  const fetchActivePool = async () => {
    try {
      const { data } = await supabase
        .from("pools")
        .select("id, name, home_team, away_team, theme")
        .order("created_at", { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        setPool(data[0] as Pool);
      }
    } catch (err) {
      console.error("Failed to load active pool config", err);
    }
  };

  const handleConsult = async (e: React.FormEvent) => {
    e.preventDefault();
    setBet(null);
    setMessage("");
    setMessageType("");

    const searchCode = code.trim().toUpperCase();
    if (!searchCode) {
      setMessage("Por favor, digite um código de palpite.");
      setMessageType("error");
      return;
    }

    if (searchCode.length !== 6) {
      setMessage("O código deve possuir exatamente 6 caracteres.");
      setMessageType("error");
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("public_bets_consultation")
        .select("*")
        .eq("public_code", searchCode)
        .limit(1);

      if (error) throw error;

      if (!data || data.length === 0) {
        setMessage("Palpite não encontrado. Verifique o código informado.");
        setMessageType("error");
        return;
      }

      const betInfo = data[0] as BetDetails;
      setBet(betInfo);
      setMessageType("success");

      // Save locally if found so the user can easily trace it in the future
      saveToLocalHistory(betInfo);

    } catch (err) {
      console.error(err);
      setMessage("Erro ao consultar palpite. Tente novamente.");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  const saveToLocalHistory = (betInfo: BetDetails) => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      
      const exists = list.some((b: any) => b.codigo === betInfo.public_code);
      if (!exists && pool) {
        const item = {
          codigo: betInfo.public_code,
          placar: `${betInfo.home_score} x ${betInfo.away_score}`,
          status: betInfo.status,
          nome: "Consultado",
          timeCasa: pool.home_team,
          timeVisitante: pool.away_team,
        };
        list.unshift(item);
        localStorage.setItem(LS_KEY, JSON.stringify(list));
      }
    } catch (e) {
      console.error("Failed to save to local storage", e);
    }
  };

  const getThemeClass = () => {
    if (!pool) return "theme-verde";
    return `theme-${pool.theme}`;
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "PAID":
        return "Confirmado / Pago";
      case "REJECTED":
        return "Recusado / Não Confirmado";
      case "PENDING":
      default:
        return "Pendente de Pagamento";
    }
  };

  return (
    <div className={`${getThemeClass()} min-h-screen py-8 px-4 sm:px-6 lg:px-8`}>
      <div className="max-w-md mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="text-center">
          <span className="text-xs uppercase tracking-wider font-semibold text-[var(--primary)] bg-[var(--primary-glow)] px-3 py-1 rounded-full">
            {pool?.name || "Bolão de Placar Exato"}
          </span>
          <h1 className="text-2xl font-black mt-2 text-slate-800 dark:text-slate-200">🔍 Consulta de Palpite</h1>
          <p className="text-xs text-slate-400 mt-1">Consulte o status do seu palpite informando o código de 6 caracteres.</p>
        </div>

        {/* CONSULT CARD */}
        <section className="glass-card p-6 space-y-4">
          <form onSubmit={handleConsult} className="space-y-4">
            <div className="flex flex-col space-y-1">
              <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Código do Palpite</label>
              <input
                type="text"
                maxLength={6}
                required
                placeholder="Ex: AB82KQ"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="custom-input text-center font-mono text-xl tracking-widest uppercase"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="spinner"></span>
                  <span>Buscando...</span>
                </>
              ) : (
                <span>Consultar</span>
              )}
            </button>
          </form>

          {/* Feedback message (error or status alert) */}
          {messageType === "error" && message && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-300/40 text-rose-600 dark:text-rose-400 rounded-xl text-sm font-semibold text-center">
              ⚠️ {message}
            </div>
          )}
        </section>

        {/* RESULTS PANEL */}
        {bet && (
          <section className="glass-card p-6 space-y-4 animate-[fadeIn_0.25s_ease]">
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800 pb-2">
              📋 Dados do Palpite
            </h2>
            
            <div className="space-y-3.5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Código:</span>
                <span className="font-mono font-black text-[var(--primary)] tracking-widest text-lg">{bet.public_code}</span>
              </div>

              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Placar Escolhido:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200 text-base">
                  {pool ? `${pool.home_team} ${bet.home_score} x ${bet.away_score} ${pool.away_team}` : `${bet.home_score} x ${bet.away_score}`}
                </span>
              </div>

              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Data de Cadastro:</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {new Date(bet.created_at).toLocaleString("pt-BR")}
                </span>
              </div>

              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Valor do Palpite:</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(bet.amount)}
                </span>
              </div>

              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Situação:</span>
                <span
                  className={`status-badge text-xs ${
                    bet.status === "PAID"
                      ? "badge-open"
                      : bet.status === "REJECTED"
                      ? "badge-finished"
                      : "badge-closed bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300"
                  }`}
                >
                  {getStatusText(bet.status)}
                </span>
              </div>

              {bet.status === "PAID" && bet.is_winner && (
                <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-extrabold text-center rounded-xl animate-bounce">
                  🎉 PARABÉNS! ESTE PALPITE FOI VENCEDOR!
                </div>
              )}
            </div>
          </section>
        )}

        {/* NAVIGATION BACK BAR */}
        <section className="flex justify-center gap-4 text-xs font-semibold">
          <a href="/" className="text-[var(--primary)] hover:underline">🏠 Tela Inicial</a>
          <span className="text-slate-300">•</span>
          <a href="/transparencia" className="text-[var(--primary)] hover:underline">📊 Transparência</a>
        </section>

        <footer className="text-center text-[10px] text-slate-400">
          ⚽ Bolão Placar Exato • Consulta
        </footer>

      </div>
    </div>
  );
}
