"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Pool {
  id: string;
  name: string;
  home_team: string;
  away_team: string;
  theme: string;
  status: "OPEN" | "CLOSED" | "FINISHED";
  bet_amount: number;
}

interface PaidBet {
  public_code: string;
  score_key: string;
  status: string;
  is_winner: boolean;
  created_at: string;
}

export default function Transparencia() {
  const [pool, setPool] = useState<Pool | null>(null);
  const [stats, setStats] = useState({ totalPaid: 0, estimatedPrize: 0 });
  const [bets, setBets] = useState<PaidBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setErrorMsg("");

      // Fetch active pool
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

      // Fetch public pool summary
      const { data: summary } = await supabase
        .from("public_pool_summary")
        .select("*")
        .eq("pool_id", activePool.id)
        .single();

      if (summary) {
        setStats({
          totalPaid: Number(summary.total_paid_bets || 0),
          estimatedPrize: Number(summary.estimated_prize || 0),
        });
      }

      // Fetch paid bets
      const { data: paidBets, error: betsError } = await supabase
        .from("public_paid_bets")
        .select("*")
        .order("created_at", { ascending: true });

      if (betsError) throw betsError;
      setBets(paidBets || []);

    } catch (err: any) {
      console.error(err);
      setErrorMsg("Erro ao carregar dados de transparência.");
    } finally {
      setLoading(false);
    }
  };

  const getThemeClass = () => {
    if (!pool) return "theme-verde";
    return `theme-${pool.theme}`;
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val);
  };

  const isFinished = pool?.status === "FINISHED";

  return (
    <div className={`${getThemeClass()} min-h-screen py-8 px-4 sm:px-6 lg:px-8`}>
      <div className="max-w-xl mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="text-center">
          <span className="text-xs uppercase tracking-wider font-semibold text-[var(--primary)] bg-[var(--primary-glow)] px-3 py-1 rounded-full">
            {pool?.name || "Bolão de Placar Exato"}
          </span>
          <h1 className="text-2xl font-black mt-2 text-slate-800 dark:text-slate-200">📊 Transparência Pública</h1>
          <p className="text-xs text-slate-400 mt-1">Lista auditável de palpites confirmados (pagos) no sistema.</p>
        </div>

        {/* METRICS ROW */}
        <section className="grid grid-cols-2 gap-4">
          <div className="glass-card p-4 text-center">
            <span className="text-xl font-bold text-emerald-600 block">{stats.totalPaid}</span>
            <span className="text-[10px] text-slate-400 font-bold uppercase">Palpites Pagos</span>
          </div>
          <div className="glass-card p-4 text-center bg-amber-500/[0.02] border-amber-500/20">
            <span className="text-xl font-bold text-amber-500 block">{formatCurrency(stats.estimatedPrize)}</span>
            <span className="text-[10px] text-slate-400 font-bold uppercase">Prêmio Estimado</span>
          </div>
        </section>

        {/* AUDIT TABLE CARD */}
        <section className="glass-card p-6 space-y-4">
          {errorMsg && (
            <div className="p-4 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl text-sm font-semibold text-center">
              ⚠️ {errorMsg}
            </div>
          )}

          {loading ? (
            <div className="text-center py-12">
              <span className="spinner border-t-[var(--primary)] mb-2"></span>
              <p className="text-xs text-slate-400 font-semibold">Carregando lista...</p>
            </div>
          ) : bets.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <span className="text-4xl block mb-2">📥</span>
              <p className="font-semibold text-sm">Nenhum palpite confirmado ainda.</p>
              <p className="text-xs text-slate-500 mt-0.5">Palpites pendentes de pagamento não são exibidos.</p>
            </div>
          ) : (
            <div className="space-y-4">
              
              {/* Secrecy Warning */}
              {!isFinished && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-xl text-center space-y-1">
                  <div className="text-lg">🔒</div>
                  <h3 className="font-bold text-sm text-slate-700 dark:text-slate-300">Placares em Sigilo</h3>
                  <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                    Os placares escolhidos ficam ocultos até o encerramento do bolão para evitar cópias e garantir a integridade da competição.
                  </p>
                </div>
              )}

              {/* Table wrapper */}
              <div className="overflow-hidden border border-slate-200 dark:border-slate-800 rounded-xl">
                <table className="custom-table text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/50">
                      <th>Código</th>
                      <th>Placar Escolhido</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bets.map((b) => (
                      <tr key={b.public_code} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                        <td className="font-mono font-bold tracking-widest text-slate-800 dark:text-slate-200 uppercase text-sm">
                          {b.public_code}
                        </td>
                        <td className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                          {isFinished ? (
                            <span className="bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-800">
                              {b.score_key.replace("-", " x ")}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic font-normal">🔒 Em sigilo</span>
                          )}
                        </td>
                        <td>
                          {b.is_winner ? (
                            <span className="status-badge badge-open text-[10px] py-0.5 px-2 bg-emerald-100 text-emerald-800">
                              🏅 Vencedor!
                            </span>
                          ) : (
                            <span className="status-badge badge-open text-[10px] py-0.5 px-2">
                              Confirmado
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="text-[10px] text-slate-400 text-center">
                Exibindo {bets.length} palpite(s) pago(s) confirmado(s).
              </div>

            </div>
          )}
        </section>

        {/* NAVIGATION BACK BAR */}
        <section className="flex justify-center gap-4 text-xs font-semibold">
          <a href="/" className="text-[var(--primary)] hover:underline">🏠 Tela Inicial</a>
          <span className="text-slate-300">•</span>
          <a href="/consulta" className="text-[var(--primary)] hover:underline">🔍 Consultar Palpite</a>
        </section>

        <footer className="text-center text-[10px] text-slate-400">
          ⚽ Bolão Placar Exato • Transparência
        </footer>

      </div>
    </div>
  );
}
