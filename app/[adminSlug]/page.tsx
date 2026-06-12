"use client";

import { useEffect, useState } from "react";
import { useParams, notFound } from "next/navigation";

export default function AdminDashboard() {
  const params = useParams();
  const adminSlug = params?.adminSlug as string;

  // Verify slug against env variable. Fallback to "admin-kadimo-seguro" if not defined.
  const expectedSlug = process.env.NEXT_PUBLIC_ADMIN_ROUTE_SLUG || "admin-kadimo-seguro";

  // Prevent client rendering if slug is wrong.
  const isSlugValid = adminSlug === expectedSlug;

  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "bets" | "config" | "result" | "audit" | "telegram" | "security"
  >("dashboard");

  // Captcha states for login
  const [captchaQuestion, setCaptchaQuestion] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");

  // Change password states
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  // Dashboard state
  const [pool, setPool] = useState<any>(null);
  const [stats, setStats] = useState<any>({
    totalBets: 0,
    pendingBets: 0,
    paidBets: 0,
    rejectedBets: 0,
    totalCollected: 0,
    estimatedPrize: 0,
    winnersCount: 0,
  });
  const [result, setResult] = useState<any>(null);
  
  // Bets list state
  const [bets, setBets] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [betsLoading, setBetsLoading] = useState(false);

  // Config tab form state
  const [configForm, setConfigForm] = useState({
    id: "",
    name: "",
    home_team: "",
    away_team: "",
    home_team_image_url: "",
    away_team_image_url: "",
    bet_amount: "",
    prize_percent: "75",
    deadline: "",
    status: "OPEN",
    allow_repeated_score: true,
    max_bets_per_phone: "5",
    pix_key: "",
    pix_receiver_name: "",
    organizer_whatsapp: "",
    theme: "verde",
    show_splash_screen: false,
    show_logo_image: false,
    logo_style: "normal",
  });

  // Telegram config state
  const [telegramConfigDisplay, setTelegramConfigDisplay] = useState<any>(null);
  const [telegramForm, setTelegramForm] = useState({
    bot_token: "",
    admin_chat_id: "",
    webhook_secret: "",
  });
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramMsg, setTelegramMsg] = useState<{type: "success" | "error", text: string} | null>(null);
  const [showTokenInput, setShowTokenInput] = useState(false);

  // Launch result form state
  const [homeScoreInput, setHomeScoreInput] = useState("0");
  const [awayScoreInput, setAwayScoreInput] = useState("0");
  
  // Audit logs state
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const LS_TOKEN_KEY = "bpe5_admin_token";

  const loadCaptcha = async () => {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
      const res = await fetch(`${supabaseUrl}/functions/v1/get-captcha`, {
        method: "GET",
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
      });
      const json = await res.json();
      if (json.ok) {
        setCaptchaQuestion(json.data.question);
        setCaptchaToken(json.data.token);
        setCaptchaAnswer("");
      }
    } catch (err) {
      console.error("Failed to load captcha:", err);
    }
  };

  useEffect(() => {
    if (!isSlugValid) {
      notFound();
    }
    const savedToken = localStorage.getItem(LS_TOKEN_KEY);
    if (savedToken) {
      setToken(savedToken);
      setAuthenticated(true);
    } else {
      loadCaptcha();
    }
  }, [isSlugValid]);

  useEffect(() => {
    if (authenticated) {
      loadDashboard();
    }
  }, [authenticated]);

  useEffect(() => {
    if (authenticated && activeTab === "bets") {
      loadBets();
    } else if (authenticated && activeTab === "audit") {
      loadAuditLogs();
    } else if (authenticated && activeTab === "telegram") {
      loadTelegramConfig();
    }
  }, [activeTab, statusFilter, searchQuery]);

  const callAdminApi = async (action: string, payload: any = {}) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

    // Always send anon key as Authorization so Supabase gateway lets the request through.
    // The actual admin session token is sent separately in x-admin-token.
    const currentToken = token || localStorage.getItem(LS_TOKEN_KEY) || "";

    const headers: any = {
      "Content-Type": "application/json",
      "apikey": supabaseAnonKey,
      "Authorization": `Bearer ${supabaseAnonKey}`,
    };

    if (currentToken) {
      headers["x-admin-token"] = currentToken;
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/admin-actions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, payload }),
    });

    const json = await res.json();
    if (res.status === 401) {
      if (action !== "login") {
        localStorage.removeItem(LS_TOKEN_KEY);
        setAuthenticated(false);
        setToken("");
        throw new Error("Sessão expirada. Faça login novamente.");
      }
    }

    if (!json.ok) {
      throw new Error(json.message || "Erro desconhecido na API Admin");
    }

    return json;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setLoading(true);

    try {
      const res = await callAdminApi("login", {
        password,
        captchaToken,
        captchaAnswer: captchaAnswer.trim(),
      });
      if (res.ok) {
        localStorage.setItem(LS_TOKEN_KEY, res.data.token);
        setToken(res.data.token);
        setAuthenticated(true);
        setPassword("");
        setCaptchaAnswer("");
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Senha incorreta ou erro de servidor.");
      loadCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(LS_TOKEN_KEY);
    setAuthenticated(false);
    setToken("");
    loadCaptcha();
  };

  const loadDashboard = async () => {
    setErrorMsg("");
    try {
      const res = await callAdminApi("get-dashboard");
      if (res.ok && res.data) {
        if (res.data.noPool) {
          setPool(null);
        } else {
          setPool(res.data.pool);
          setStats(res.data.stats);
          setResult(res.data.result);
          
          // Populate config form
          const p = res.data.pool;
          // Format deadline to yyyy-MM-ddThh:mm for datetime-local input
          const dlDate = new Date(p.deadline);
          const offset = dlDate.getTimezoneOffset();
          const localDl = new Date(dlDate.getTime() - offset * 60 * 1000).toISOString().substring(0, 16);

          setConfigForm({
            id: p.id,
            name: p.name,
            home_team: p.home_team,
            away_team: p.away_team,
            home_team_image_url: p.home_team_image_url || "",
            away_team_image_url: p.away_team_image_url || "",
            bet_amount: String(p.bet_amount),
            prize_percent: String(p.prize_percent),
            deadline: localDl,
            status: p.status,
            allow_repeated_score: p.allow_repeated_score,
            max_bets_per_phone: String(p.max_bets_per_phone),
            pix_key: p.pix_key,
            pix_receiver_name: p.pix_receiver_name,
            organizer_whatsapp: p.organizer_whatsapp,
            theme: p.theme,
            show_splash_screen: p.show_splash_screen || false,
            show_logo_image: p.show_logo_image || false,
            logo_style: p.logo_style || "normal",
          });

          if (res.data.result) {
            setHomeScoreInput(String(res.data.result.home_score));
            setAwayScoreInput(String(res.data.result.away_score));
          }
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const loadBets = async () => {
    if (!pool) return;
    setBetsLoading(true);
    try {
      const res = await callAdminApi("list-bets", {
        poolId: pool.id,
        statusFilter,
        searchQuery,
      });
      if (res.ok) {
        setBets(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setBetsLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const res = await callAdminApi("list-audit-logs");
      if (res.ok) {
        setAuditLogs(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleClearTestData = async () => {
    if (!pool) { setErrorMsg("Nenhum bolão carregado."); return; }

    // Triple confirmation
    const step1 = confirm(
      "⚠️ ATENÇÃO — LIMPEZA DE DADOS DE TESTE\n\n" +
      "Esta ação irá apagar PERMANENTEMENTE:\n" +
      "• Todos os palpites (pendentes, aprovados e recusados)\n" +
      "• O resultado lançado (se houver)\n" +
      "• Todo o histórico de auditoria\n" +
      "• O bolão será reaberto (status → ABERTO)\n\n" +
      "Deseja continuar? (1/3)"
    );
    if (!step1) return;

    const step2 = confirm(
      "🔴 SEGUNDA CONFIRMAÇÃO\n\n" +
      `Você está prestes a apagar TODOS os dados do bolão "${pool.name}".\n` +
      "Esta operação NÃO pode ser desfeita.\n\n" +
      "Tem absoluta certeza? (2/3)"
    );
    if (!step2) return;

    const step3 = confirm(
      "☠️ ÚLTIMA CHANCE — CONFIRMAÇÃO FINAL\n\n" +
      "Clique em OK apenas se realmente deseja apagar TUDO.\n" +
      "Após confirmar, os dados serão removidos imediatamente do banco de dados.\n\n" +
      "CONFIRMAR LIMPEZA TOTAL? (3/3)"
    );
    if (!step3) return;

    setErrorMsg("");
    setSuccessMsg("");
    setClearLoading(true);
    try {
      const res = await callAdminApi("clear-test-data", {
        poolId: pool.id,
        confirmToken: "CONFIRMAR_LIMPEZA_TOTAL",
      });
      if (res.ok) {
        setSuccessMsg(res.message);
        setAuditLogs([]);
        setBets([]);
        await loadDashboard();
        await loadAuditLogs();
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setClearLoading(false);
    }
  };

  const handleUpdateBetStatus = async (betId: string, newStatus: string, note: string = "") => {
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const res = await callAdminApi("update-bet-status", { betId, newStatus, adminNote: note });
      if (res.ok) {
        setSuccessMsg(`Palpite ${res.data.public_code} atualizado para ${newStatus}.`);
        loadBets();
        loadDashboard();
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    setLoading(true);

    try {
      // Convert datetime-local value (browser local time) to UTC ISO string.
      // datetime-local gives "2026-06-12T18:40" (no timezone). new Date() in the
      // browser interprets it as LOCAL time, so .toISOString() gives correct UTC.
      const deadlineUtc = configForm.deadline
        ? new Date(configForm.deadline).toISOString()
        : configForm.deadline;

      const res = await callAdminApi("update-pool-config", {
        ...configForm,
        deadline: deadlineUtc,
      });
      if (res.ok) {
        setSuccessMsg("Configurações do bolão salvas com sucesso!");
        setPool(res.data);
        loadDashboard();
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };


  const handleLaunchResult = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");
    
    if (!confirm("Tem certeza que deseja lançar este resultado? Esta ação vai fechar o bolão, calcular os ganhadores e é irreversível!")) {
      return;
    }

    setLoading(true);
    try {
      const res = await callAdminApi("launch-result", {
        poolId: pool.id,
        homeScore: homeScoreInput,
        awayScore: awayScoreInput,
      });

      if (res.ok) {
        setSuccessMsg(res.message);
        loadDashboard();
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (newPassword.length < 6) {
      setErrorMsg("A nova senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMsg("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    try {
      const res = await callAdminApi("change-password", {
        oldPassword,
        newPassword,
      });
      if (res.ok) {
        setSuccessMsg(res.message);
        setOldPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadTelegramConfig = async () => {
    setTelegramLoading(true);
    setTelegramMsg(null);
    try {
      const res = await callAdminApi("get-telegram-config");
      if (res.ok) {
        setTelegramConfigDisplay(res.data);
        // Pre-fill the admin_chat_id in form (token/secret not sent back for security)
        setTelegramForm(prev => ({
          ...prev,
          admin_chat_id: res.data.admin_chat_id || "",
        }));
      }
    } catch (err: any) {
      setTelegramMsg({ type: "error", text: err.message });
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleSaveTelegramConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setTelegramMsg(null);
    setTelegramLoading(true);
    try {
      const res = await callAdminApi("save-telegram-config", telegramForm);
      if (res.ok) {
        setTelegramMsg({ type: "success", text: res.message });
        setTelegramForm({ bot_token: "", admin_chat_id: telegramForm.admin_chat_id, webhook_secret: "" });
        setShowTokenInput(false);
        loadTelegramConfig();
      }
    } catch (err: any) {
      setTelegramMsg({ type: "error", text: err.message });
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleTestTelegram = async () => {
    setTelegramMsg(null);
    setTelegramLoading(true);
    try {
      const res = await callAdminApi("test-telegram");
      setTelegramMsg({ type: res.ok ? "success" : "error", text: res.ok ? res.message : "Falha no teste" });
    } catch (err: any) {
      setTelegramMsg({ type: "error", text: err.message });
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleRegisterWebhook = async () => {
    if (!confirm("Registrar o webhook irá vincular a URL do Supabase ao seu bot Telegram. Confirmar?")) return;
    setTelegramMsg(null);
    setTelegramLoading(true);
    try {
      const res = await callAdminApi("register-telegram-webhook");
      setTelegramMsg({ type: res.ok ? "success" : "error", text: res.message || "Erro desconhecido" });
    } catch (err: any) {
      setTelegramMsg({ type: "error", text: err.message });
    } finally {
      setTelegramLoading(false);
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);
  };

  // Prevent render if slug is invalid
  if (!isSlugValid) return null;

  // Render Login view if not authenticated
  if (!authenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100 px-4">
        <div className="max-w-sm w-full space-y-6 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl">
          <div className="text-center space-y-2">
            <span className="text-4xl">🔐</span>
            <h1 className="text-xl font-black">Bolão Admin Login</h1>
            <p className="text-xs text-slate-500">Acesso restrito para administradores.</p>
          </div>

          {errorMsg && (
            <div className="p-3.5 bg-rose-950/30 border border-rose-900/50 text-rose-400 rounded-xl text-xs font-semibold text-center">
              ⚠️ {errorMsg}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-bold text-slate-400">Senha de Administrador</label>
              <input
                type="password"
                required
                placeholder="Insira a senha secreta"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="custom-input bg-slate-950 border-slate-800 text-sm"
              />
            </div>

            {captchaQuestion && (
              <div className="p-4 bg-slate-950/50 rounded-xl border border-slate-800 space-y-2 text-xs">
                <label className="font-bold flex items-center gap-1 text-slate-300">🔐 Verificação de Segurança</label>
                <p className="font-medium text-slate-400">{captchaQuestion}</p>
                <input
                  type="number"
                  required
                  placeholder="Sua resposta"
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value)}
                  className="custom-input bg-slate-950 border-slate-800 text-xs w-full text-slate-200"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2"
            >
              {loading ? <span className="spinner"></span> : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* TOP PANEL */}
        <header className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-lg">
          <div>
            <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
              🛠️ Painel Administrativo
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">Gerenciador do Bolão Placar Exato</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadDashboard}
              className="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg cursor-pointer"
            >
              🔄 Recarregar
            </button>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-xs font-semibold bg-rose-950/40 hover:bg-rose-950/70 text-rose-300 rounded-lg cursor-pointer"
            >
              🚪 Sair
            </button>
          </div>
        </header>

        {/* ALERTS */}
        {errorMsg && (
          <div className="p-4 bg-rose-950/20 border border-rose-900/50 text-rose-400 rounded-xl text-xs font-bold">
            ⚠️ Erro: {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/50 text-emerald-400 rounded-xl text-xs font-bold">
            ✅ Sucesso: {successMsg}
          </div>
        )}

        {/* TABS HEADER */}
        <nav className="flex flex-wrap gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
          {[
            { id: "dashboard", label: "📊 Resumo" },
            { id: "bets", label: "⚽ Palpites" },
            { id: "config", label: "⚙️ Configurações" },
            { id: "result", label: "🏆 Lançar Resultado" },
            { id: "audit", label: "🕵️ Auditoria" },
            { id: "telegram", label: "🤖 Bot Telegram" },
            { id: "security", label: "🔒 Segurança" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setActiveTab(t.id as any);
                setErrorMsg("");
                setSuccessMsg("");
              }}
              className={`px-4 py-2 text-xs font-bold rounded-lg cursor-pointer transition-colors ${
                activeTab === t.id
                  ? "bg-emerald-600 text-white shadow-md"
                  : "bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {/* TAB CONTENTS */}

        {/* 1. DASHBOARD TAB */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            {!pool ? (
              <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl text-center space-y-4">
                <p className="text-slate-400 text-sm">Nenhum bolão foi configurado ainda.</p>
                <button
                  onClick={() => setActiveTab("config")}
                  className="btn-primary text-xs py-2 px-4 inline-block"
                >
                  🚀 Criar Configuração Inicial
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                  <span className="text-2xl font-black text-white block">{stats.totalBets}</span>
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Total Envia</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl border-amber-500/20">
                  <span className="text-2xl font-black text-amber-500 block">{stats.pendingBets}</span>
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Pendentes</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl border-emerald-500/20">
                  <span className="text-2xl font-black text-emerald-500 block">{stats.paidBets}</span>
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Pagos</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl border-rose-500/20">
                  <span className="text-2xl font-black text-rose-500 block">{stats.rejectedBets}</span>
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Recusados</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                  <span className="text-xl font-black text-white block">{formatCurrency(stats.totalCollected)}</span>
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Total Arrecadado</span>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl bg-emerald-950/20 border-emerald-900/30">
                  <span className="text-xl font-black text-emerald-400 block">{formatCurrency(stats.estimatedPrize)}</span>
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Prêmio (75%)</span>
                </div>

                {/* Pool Status info card */}
                <div className="col-span-full bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Configuração Ativa</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                    <div><b>Nome:</b> {pool.name}</div>
                    <div><b>Jogo:</b> {pool.home_team} vs {pool.away_team}</div>
                    <div><b>Prazo:</b> {new Date(pool.deadline).toLocaleString("pt-BR")}</div>
                    <div><b>Status:</b> {pool.status}</div>
                    <div><b>Repetidos:</b> {pool.allow_repeated_score ? "Sim" : "Não"}</div>
                    <div><b>Limite por Tel:</b> {pool.max_bets_per_phone}</div>
                    <div><b>Valor:</b> {formatCurrency(pool.bet_amount)}</div>
                    <div><b>Prêmio (%):</b> {pool.prize_percent}%</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. PALPITES TAB */}
        {activeTab === "bets" && (
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
            {/* Filters bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "ALL", label: "Todos" },
                  { id: "PENDING", label: "Pendentes" },
                  { id: "PAID", label: "Pagos" },
                  { id: "REJECTED", label: "Recusados" },
                  { id: "WINNERS", label: "Ganhadores" },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setStatusFilter(f.id)}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg cursor-pointer ${
                      statusFilter === f.id ? "bg-slate-700 text-white" : "bg-slate-950 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Text Search input */}
              <input
                type="text"
                placeholder="Busca por nome, fone, código ou placar"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="custom-input bg-slate-950 border-slate-800 text-xs py-1.5 w-full sm:max-w-[280px]"
              />
            </div>

            {/* Bets list table */}
            {betsLoading ? (
              <div className="text-center py-12">
                <span className="spinner border-t-emerald-500"></span>
                <p className="text-xs text-slate-500 mt-2">Carregando palpites...</p>
              </div>
            ) : bets.length === 0 ? (
              <p className="text-center text-xs text-slate-500 py-12">Nenhum palpite correspondente aos filtros.</p>
            ) : (
              <div className="overflow-x-auto border border-slate-800 rounded-xl">
                <table className="custom-table text-xs text-slate-300">
                  <thead className="bg-slate-950/40 text-slate-400">
                    <tr>
                      <th>Cadastro</th>
                      <th>Código</th>
                      <th>Nome</th>
                      <th>Telefone</th>
                      <th>Placar</th>
                      <th>Valor</th>
                      <th>Status</th>
                      <th>Observação</th>
                      <th className="text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bets.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-950/20 border-b border-slate-800/50">
                        <td>{new Date(b.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                        <td className="font-mono font-black text-white tracking-wider text-sm select-all">{b.public_code}</td>
                        <td className="font-semibold">{b.participant_name}</td>
                        <td className="select-all">{b.phone}</td>
                        <td className="font-bold text-emerald-400 text-sm">{b.home_score} x {b.away_score}</td>
                        <td>{formatCurrency(b.amount)}</td>
                        <td>
                          <span
                            className={`status-badge text-[10px] py-0.5 px-2 ${
                              b.status === "PAID"
                                ? "bg-emerald-950 text-emerald-400"
                                : b.status === "REJECTED"
                                ? "bg-rose-950 text-rose-400"
                                : "bg-yellow-950 text-yellow-400"
                            }`}
                          >
                            {b.status === "PAID" ? "Pago" : b.status === "REJECTED" ? "Recusado" : "Pendente"}
                          </span>
                          {b.is_winner && (
                            <span className="status-badge text-[10px] py-0.5 px-2 bg-amber-900 text-amber-300 ml-1">
                              🏅 Vencedor
                            </span>
                          )}
                        </td>
                        <td>
                          <input
                            type="text"
                            placeholder="Obs"
                            defaultValue={b.admin_note || ""}
                            onBlur={(e) => {
                              if (e.target.value !== (b.admin_note || "")) {
                                handleUpdateBetStatus(b.id, b.status, e.target.value);
                              }
                            }}
                            className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] w-28"
                          />
                        </td>
                        <td className="text-right space-x-1.5 whitespace-nowrap">
                          {b.status === "PENDING" && (
                            <>
                              <button
                                onClick={() => handleUpdateBetStatus(b.id, "PAID")}
                                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold cursor-pointer"
                              >
                                Aprovar
                              </button>
                              <button
                                onClick={() => handleUpdateBetStatus(b.id, "REJECTED")}
                                className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold cursor-pointer"
                              >
                                Recusar
                              </button>
                            </>
                          )}
                          {b.status !== "PENDING" && (
                            <button
                              onClick={() => handleUpdateBetStatus(b.id, "PENDING")}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-bold cursor-pointer"
                            >
                              Pendente
                            </button>
                          )}

                          <a
                            href={`https://wa.me/${b.phone_normalized}?text=${encodeURIComponent(
                              `Olá, ${b.participant_name}! Sobre seu palpite no bolão (Código: ${b.public_code})...`
                            )}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2 py-1 bg-slate-950 border border-slate-800 hover:bg-slate-900 text-emerald-400 rounded text-[10px] font-bold inline-block"
                          >
                            WhatsApp
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 3. CONFIGURAÇÕES TAB */}
        {activeTab === "config" && (
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
            <h2 className="text-base font-bold text-white mb-4 border-b border-slate-800 pb-2">
              ⚙️ Editar Configurações do Bolão
            </h2>

            <form onSubmit={handleSaveConfig} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-slate-400">Nome do Bolão</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Copa do Mundo - Final"
                    value={configForm.name}
                    onChange={(e) => setConfigForm({ ...configForm, name: e.target.value })}
                    className="custom-input bg-slate-950 border-slate-800"
                  />
                </div>

                <div className="flex grid grid-cols-2 gap-2">
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-slate-400">Time da Casa</label>
                    <input
                      type="text"
                      required
                      placeholder="Brasil"
                      value={configForm.home_team}
                      onChange={(e) => setConfigForm({ ...configForm, home_team: e.target.value })}
                      className="custom-input bg-slate-950 border-slate-800"
                    />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-slate-400">Time Visitante</label>
                    <input
                      type="text"
                      required
                      placeholder="Marrocos"
                      value={configForm.away_team}
                      onChange={(e) => setConfigForm({ ...configForm, away_team: e.target.value })}
                      className="custom-input bg-slate-950 border-slate-800"
                    />
                  </div>
                </div>

                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-slate-400">Imagem Time Casa (URL opcional)</label>
                  <input
                    type="url"
                    placeholder="https://exemplo.com/escudo.png"
                    value={configForm.home_team_image_url}
                    onChange={(e) => setConfigForm({ ...configForm, home_team_image_url: e.target.value })}
                    className="custom-input bg-slate-950 border-slate-800"
                  />
                </div>

                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-slate-400">Imagem Time Visitante (URL opcional)</label>
                  <input
                    type="url"
                    placeholder="https://exemplo.com/escudo2.png"
                    value={configForm.away_team_image_url}
                    onChange={(e) => setConfigForm({ ...configForm, away_team_image_url: e.target.value })}
                    className="custom-input bg-slate-950 border-slate-800"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-slate-400">Valor do Palpite (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={configForm.bet_amount}
                      onChange={(e) => setConfigForm({ ...configForm, bet_amount: e.target.value })}
                      className="custom-input bg-slate-950 border-slate-800"
                    />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-slate-400">Prêmio % (Padrão 75%)</label>
                    <input
                      type="number"
                      required
                      value={configForm.prize_percent}
                      onChange={(e) => setConfigForm({ ...configForm, prize_percent: e.target.value })}
                      className="custom-input bg-slate-950 border-slate-800"
                    />
                  </div>
                </div>

                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-slate-400">Data e Hora Limite</label>
                  <input
                    type="datetime-local"
                    required
                    value={configForm.deadline}
                    onChange={(e) => setConfigForm({ ...configForm, deadline: e.target.value })}
                    className="custom-input bg-slate-950 border-slate-800 text-slate-300"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-slate-400">Máx Apostas / Fone</label>
                    <input
                      type="number"
                      required
                      value={configForm.max_bets_per_phone}
                      onChange={(e) => setConfigForm({ ...configForm, max_bets_per_phone: e.target.value })}
                      className="custom-input bg-slate-950 border-slate-800"
                    />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-slate-400">Status do Bolão</label>
                    <select
                      value={configForm.status}
                      onChange={(e) => setConfigForm({ ...configForm, status: e.target.value })}
                      className="custom-input bg-slate-950 border-slate-800 py-2.5 h-10 text-slate-300"
                    >
                      <option value="OPEN">ABERTO</option>
                      <option value="CLOSED">FECHADO</option>
                      <option value="FINISHED">FINALIZADO</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-slate-400">Tema Visual</label>
                  <select
                    value={configForm.theme}
                    onChange={(e) => setConfigForm({ ...configForm, theme: e.target.value })}
                    className="custom-input bg-slate-950 border-slate-800 py-2.5 h-10 text-slate-300"
                  >
                    <option value="verde">Verde (Padrão)</option>
                    <option value="azul">Azul</option>
                    <option value="verde_claro">Verde Claro (Mint)</option>
                    <option value="amarelo">Amarelo / Dourado</option>
                    <option value="roxo">Roxo</option>
                    <option value="escuro">Escuro (Sleek Slate)</option>
                    <option value="claro">Claro (Alta definição)</option>
                  </select>
                </div>

                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-slate-400">Chave PIX Recebimento</label>
                  <input
                    type="text"
                    required
                    placeholder="E-mail, CPF, fone ou chave aleatória"
                    value={configForm.pix_key}
                    onChange={(e) => setConfigForm({ ...configForm, pix_key: e.target.value })}
                    className="custom-input bg-slate-950 border-slate-800"
                  />
                </div>

                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-slate-400">Nome do Recebedor PIX</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: João da Silva ME"
                    value={configForm.pix_receiver_name}
                    onChange={(e) => setConfigForm({ ...configForm, pix_receiver_name: e.target.value })}
                    className="custom-input bg-slate-950 border-slate-800"
                  />
                </div>

                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-slate-400">WhatsApp do Organizador (com DDD)</label>
                  <input
                    type="tel"
                    required
                    placeholder="Ex: 5594999999999"
                    value={configForm.organizer_whatsapp}
                    onChange={(e) => setConfigForm({ ...configForm, organizer_whatsapp: e.target.value })}
                    className="custom-input bg-slate-950 border-slate-800"
                  />
                </div>

                <div className="flex items-center space-x-2 pt-4">
                  <input
                    type="checkbox"
                    id="allowRepeated"
                    checked={configForm.allow_repeated_score}
                    onChange={(e) => setConfigForm({ ...configForm, allow_repeated_score: e.target.checked })}
                    className="w-4 h-4 text-emerald-600 bg-slate-950 border-slate-800 rounded focus:ring-emerald-500 focus:ring-2"
                  />
                  <label htmlFor="allowRepeated" className="font-bold text-slate-300">
                    Permitir placares repetidos entre apostadores
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="showSplash"
                    checked={configForm.show_splash_screen}
                    onChange={(e) => setConfigForm({ ...configForm, show_splash_screen: e.target.checked })}
                    className="w-4 h-4 text-emerald-600 bg-slate-950 border-slate-800 rounded focus:ring-emerald-500 focus:ring-2"
                  />
                  <label htmlFor="showSplash" className="font-bold text-slate-300">
                    🖼️ Exibir tela de abertura (Splash Screen) ao acessar o site
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="showLogoImage"
                    checked={configForm.show_logo_image}
                    onChange={(e) => setConfigForm({ ...configForm, show_logo_image: e.target.checked })}
                    className="w-4 h-4 text-emerald-600 bg-slate-950 border-slate-800 rounded focus:ring-emerald-500 focus:ring-2"
                  />
                  <label htmlFor="showLogoImage" className="font-bold text-slate-300">
                    🖼️ Usar imagem de logotipo no topo (oculta o nome em texto)
                  </label>
                </div>

                {configForm.show_logo_image && (
                  <div className="flex flex-col space-y-1 pl-6 border-l-2 border-emerald-700/40">
                    <label className="font-bold text-slate-400">🎨 Estilo visual da logo</label>
                    <select
                      value={configForm.logo_style}
                      onChange={(e) => setConfigForm({ ...configForm, logo_style: e.target.value })}
                      className="custom-input bg-slate-950 border-slate-800 py-2.5 h-10 text-slate-300"
                    >
                      <option value="normal">Padrão (sem efeito)</option>
                      <option value="soft_edges">Bordas suavizadas (fade nas bordas)</option>
                      <option value="no_white">Sem fundo branco (transparência)</option>
                      <option value="soft_no_white">Bordas suavizadas + sem fundo branco</option>
                      <option value="glow">Brilho / Sombra ao redor</option>
                    </select>
                    <p className="text-[10px] text-slate-500">
                      &quot;Sem fundo branco&quot; funciona melhor em temas escuros.
                    </p>
                  </div>
                )}

              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary py-2.5 w-full max-w-[200px]"
                >
                  {loading ? <span className="spinner"></span> : "Salvar Configuração"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* 4. LANÇAR RESULTADO TAB */}
        {activeTab === "result" && (
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-6">
            <h2 className="text-base font-bold text-white border-b border-slate-800 pb-2">
              🏆 Lançar Resultado do Jogo
            </h2>

            {pool?.status === "FINISHED" && result ? (
              <div className="p-4 bg-emerald-950/20 border border-emerald-900/50 rounded-xl space-y-3">
                <h3 className="text-sm font-bold text-emerald-400">Este bolão já foi finalizado!</h3>
                <p className="text-xs">
                  O resultado oficial foi: <b>{pool.home_team} {result.home_score} x {result.away_score} {pool.away_team}</b>.
                </p>
                <div className="text-xs grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                  <div><b>Ganhadores:</b> {result.total_winners}</div>
                  <div><b>Arrecadação Total:</b> {formatCurrency(result.total_prize / (pool.prize_percent / 100))}</div>
                  <div><b>Prêmio Total (75%):</b> {formatCurrency(result.total_prize)}</div>
                  <div><b>Prêmio p/ Ganhador:</b> <span className="text-emerald-400 font-bold">{formatCurrency(result.prize_per_winner)}</span></div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleLaunchResult} className="space-y-4">
                <div className="p-4 bg-amber-950/20 border border-amber-900/50 rounded-xl text-xs text-amber-400 space-y-1.5">
                  <p className="font-bold">⚠️ ATENÇÃO ADMINISTRADOR:</p>
                  <p>1. Ao preencher o resultado do jogo abaixo, o bolão será automaticamente FECHADO.</p>
                  <p>2. O sistema audita todos os palpites PAGOS correspondentes ao placar informado.</p>
                  <p>3. Os vencedores serão marcados e o prêmio individual será recalculado e dividido entre eles.</p>
                </div>

                <div className="flex items-center justify-center gap-6 p-6 bg-slate-950/40 border border-slate-800 rounded-xl max-w-md mx-auto">
                  <div className="flex flex-col items-center flex-1 text-center">
                    <span className="font-bold text-xs text-slate-400 block mb-2">{pool?.home_team}</span>
                    <input
                      type="number"
                      min="0"
                      value={homeScoreInput}
                      onChange={(e) => setHomeScoreInput(e.target.value)}
                      className="w-16 text-center text-xl font-bold custom-input bg-slate-950 border-slate-800"
                    />
                  </div>

                  <span className="text-slate-600 font-bold text-lg">X</span>

                  <div className="flex flex-col items-center flex-1 text-center">
                    <span className="font-bold text-xs text-slate-400 block mb-2">{pool?.away_team}</span>
                    <input
                      type="number"
                      min="0"
                      value={awayScoreInput}
                      onChange={(e) => setAwayScoreInput(e.target.value)}
                      className="w-16 text-center text-xl font-bold custom-input bg-slate-950 border-slate-800"
                    />
                  </div>
                </div>

                <div className="text-center pt-4">
                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary bg-rose-600 hover:bg-rose-700 w-full max-w-[240px]"
                  >
                    {loading ? <span className="spinner"></span> : "🏁 Lançar Placar Oficial & Encerrar"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* 5. AUDITORIA TAB */}
        {activeTab === "audit" && (
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4">
            <h2 className="text-base font-bold text-white border-b border-slate-800 pb-2">
              🕵️ Registro de Auditoria (Audit Logs)
            </h2>

            {auditLoading ? (
              <div className="text-center py-12">
                <span className="spinner border-t-emerald-500"></span>
                <p className="text-xs text-slate-500 mt-2">Carregando logs...</p>
              </div>
            ) : auditLogs.length === 0 ? (
              <p className="text-center text-xs text-slate-500 py-12">Nenhum registro de auditoria encontrado.</p>
            ) : (
              <div className="overflow-x-auto border border-slate-800 rounded-xl">
                <table className="custom-table text-[11px] text-slate-300">
                  <thead className="bg-slate-950/40 text-slate-400">
                    <tr>
                      <th>Horário</th>
                      <th>Ação</th>
                      <th>Entidade</th>
                      <th>Apostador/Código</th>
                      <th>Status Anterior</th>
                      <th>Novo Status</th>
                      <th>Autor</th>
                      <th>Detalhes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-950/20 border-b border-slate-800/50">
                        <td>{new Date(log.created_at).toLocaleString("pt-BR")}</td>
                        <td className="font-bold text-white">{log.action}</td>
                        <td>{log.entity_type}</td>
                        <td className="font-mono">{log.public_code || "-"}</td>
                        <td className="text-slate-500">{log.old_status || "-"}</td>
                        <td className="text-emerald-400 font-semibold">{log.new_status || "-"}</td>
                        <td>{log.actor}</td>
                        <td className="max-w-[200px] truncate select-all" title={JSON.stringify(log.details)}>
                          {JSON.stringify(log.details)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* DANGER ZONE */}
            <div className="mt-6 border border-rose-900/50 rounded-xl p-5 bg-rose-950/10 space-y-3">
              <h3 className="text-sm font-black text-rose-400 flex items-center gap-2">
                ☠️ Zona de Perigo — Limpeza de Dados
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Use este botão <span className="font-bold text-rose-400">apenas durante testes</span>. Ele apaga <b>todos os palpites</b> (pendentes, aprovados e recusados),
                o resultado lançado e todo o histórico de auditoria, reiniciando o bolão para <b>ABERTO</b>.
                A operação <span className="font-bold text-rose-400">não pode ser desfeita</span>.
              </p>
              <button
                onClick={handleClearTestData}
                disabled={clearLoading || !pool}
                className="flex items-center gap-2 px-4 py-2.5 text-xs font-black rounded-xl bg-rose-700 hover:bg-rose-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {clearLoading ? (
                  <><span className="spinner border-t-white"></span> Limpando...</>
                ) : (
                  <>🧹 Limpar Todos os Dados de Teste</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* 6. TELEGRAM INTEGRATION TAB */}
        {activeTab === "telegram" && (
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-6 text-xs text-slate-300">
            <h2 className="text-base font-bold text-white border-b border-slate-800 pb-2">
              🤖 Integração do Bot Telegram
            </h2>

            {/* Status Badge */}
            {telegramConfigDisplay && (
              <div className={`flex items-center gap-3 p-3 rounded-xl border text-xs font-semibold ${
                telegramConfigDisplay.configured
                  ? "bg-emerald-950/30 border-emerald-900/50 text-emerald-400"
                  : "bg-amber-950/30 border-amber-900/50 text-amber-400"
              }`}>
                <span className="text-lg">{telegramConfigDisplay.configured ? "🟢" : "🔴"}</span>
                <div>
                  <p>{telegramConfigDisplay.configured ? "Bot configurado e ativo" : "Bot não configurado"}</p>
                  {telegramConfigDisplay.configured && telegramConfigDisplay.updated_at && (
                    <p className="font-normal text-slate-400 mt-0.5">Última atualização: {new Date(telegramConfigDisplay.updated_at).toLocaleString("pt-BR")}</p>
                  )}
                </div>
              </div>
            )}

            {/* Feedback message */}
            {telegramMsg && (
              <div className={`p-3 rounded-xl border text-xs font-semibold ${
                telegramMsg.type === "success"
                  ? "bg-emerald-950/30 border-emerald-900/50 text-emerald-400"
                  : "bg-rose-950/30 border-rose-900/50 text-rose-400"
              }`}>
                {telegramMsg.text}
              </div>
            )}

            {/* Credentials Form */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-200">🔑 Credenciais do Bot</h3>
              <p className="leading-relaxed text-slate-400">
                Configure os dados do seu bot abaixo. Para criar um bot, acesse{" "}
                <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">@BotFather</a>{" "}
                no Telegram e use o comando <code className="bg-slate-800 px-1 rounded">/newbot</code>.
              </p>

              <form onSubmit={handleSaveTelegramConfig} className="space-y-4">
                {/* Token Field */}
                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-slate-400">Token do Bot (TELEGRAM_BOT_TOKEN)</label>
                  {telegramConfigDisplay?.configured && !showTokenInput ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 custom-input bg-slate-950 border-slate-800 font-mono text-slate-500 select-all">
                        {telegramConfigDisplay.bot_token_masked}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowTokenInput(true)}
                        className="px-3 py-2 text-xs bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 text-slate-300 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        ✏️ Alterar
                      </button>
                    </div>
                  ) : (
                    <input
                      type="text"
                      required
                      placeholder="Ex: 123456789:ABCDefGhiJkl_mNOPqrstu..."
                      value={telegramForm.bot_token}
                      onChange={(e) => setTelegramForm({ ...telegramForm, bot_token: e.target.value })}
                      className="custom-input bg-slate-950 border-slate-800 font-mono text-xs"
                    />
                  )}
                </div>

                {/* Chat ID Field */}
                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-slate-400">Chat ID do Administrador (TELEGRAM_ADMIN_CHAT_ID)</label>
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      required
                      placeholder="Ex: 987654321"
                      value={telegramForm.admin_chat_id}
                      onChange={(e) => setTelegramForm({ ...telegramForm, admin_chat_id: e.target.value })}
                      className="custom-input bg-slate-950 border-slate-800 font-mono text-xs"
                    />
                    <p className="text-slate-500 leading-relaxed">
                      Para obter o Chat ID: abra o Telegram, envie uma mensagem para o seu bot criado e então acesse:
                      <code className="block bg-slate-800 px-2 py-1 rounded mt-1 break-all select-all">https://api.telegram.org/bot{"<SEU_TOKEN>"}/getUpdates</code>
                      Procure pelo campo <code className="bg-slate-800 px-1 rounded">"id"</code> dentro de <code className="bg-slate-800 px-1 rounded">"from"</code>.
                    </p>
                  </div>
                </div>

                {/* Webhook Secret Field */}
                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-slate-400">Webhook Secret (TELEGRAM_WEBHOOK_SECRET)</label>
                  {telegramConfigDisplay?.configured && !showTokenInput ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 custom-input bg-slate-950 border-slate-800 font-mono text-slate-500 select-all">
                        {telegramConfigDisplay.webhook_secret_masked}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowTokenInput(true)}
                        className="px-3 py-2 text-xs bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 text-slate-300 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        ✏️ Alterar
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        required
                        placeholder="Crie uma senha aleatória forte (ex: minha_senha_webhook_123)"
                        value={telegramForm.webhook_secret}
                        onChange={(e) => setTelegramForm({ ...telegramForm, webhook_secret: e.target.value })}
                        className="custom-input bg-slate-950 border-slate-800 font-mono text-xs"
                      />
                      <p className="text-slate-500">Use qualquer texto secreto — é um token de segurança para validar as chamadas do Telegram.</p>
                    </div>
                  )}
                </div>

                {showTokenInput && (
                  <button
                    type="button"
                    onClick={() => { setShowTokenInput(false); setTelegramForm({ bot_token: "", admin_chat_id: telegramForm.admin_chat_id, webhook_secret: "" }); }}
                    className="text-xs text-slate-400 hover:text-slate-300 underline cursor-pointer"
                  >
                    Cancelar alteração
                  </button>
                )}

                <div className="flex flex-wrap gap-3 pt-2">
                  {(showTokenInput || !telegramConfigDisplay?.configured) && (
                    <button
                      type="submit"
                      disabled={telegramLoading}
                      className="btn-primary py-2 px-5 flex items-center gap-2"
                    >
                      {telegramLoading ? <span className="spinner" /> : "💾 Salvar Credenciais"}
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Action Buttons */}
            {telegramConfigDisplay?.configured && (
              <div className="border-t border-slate-800 pt-4 space-y-4">
                <h3 className="text-sm font-bold text-slate-200">🚀 Ações</h3>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleTestTelegram}
                    disabled={telegramLoading}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {telegramLoading ? <span className="spinner border-t-white" /> : "📡 Testar Conexão"}
                  </button>
                  <button
                    onClick={handleRegisterWebhook}
                    disabled={telegramLoading}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {telegramLoading ? <span className="spinner border-t-white" /> : "🔗 Registrar Webhook"}
                  </button>
                  {!telegramConfigDisplay.configured || showTokenInput ? null : (
                    <button
                      type="button"
                      onClick={() => setShowTokenInput(true)}
                      className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl bg-slate-700 hover:bg-slate-600 text-white transition-colors cursor-pointer"
                    >
                      ✏️ Atualizar Credenciais
                    </button>
                  )}
                </div>

                <div className="p-4 bg-emerald-950/20 border border-emerald-900/50 rounded-xl">
                  <p className="font-bold text-emerald-400 mb-1">💡 Como usar:</p>
                  <ol className="list-decimal pl-4 space-y-1 leading-relaxed">
                    <li>Salve as credenciais acima.</li>
                    <li>Clique em <b>Testar Conexão</b> — você receberá uma mensagem de confirmação no seu Telegram.</li>
                    <li>Clique em <b>Registrar Webhook</b> para vincular o bot ao sistema (precisa fazer apenas uma vez).</li>
                    <li>Pronto! Novos palpites gerarão notificações automáticas com botões de Aprovar/Recusar.</li>
                  </ol>
                </div>
              </div>
            )}

            {!telegramConfigDisplay?.configured && (
              <div className="p-4 bg-amber-950/20 border border-amber-900/50 rounded-xl text-xs text-amber-400">
                <p className="font-bold mb-1">⚠️ Bot ainda não configurado</p>
                <p className="leading-relaxed">Preencha os campos acima e salve as credenciais para ativar as notificações automáticas do Telegram.</p>
              </div>
            )}
          </div>
        )}

        {/* 7. SEGURANÇA TAB */}
        {activeTab === "security" && (
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl max-w-md">
            <h2 className="text-base font-bold text-white mb-4 border-b border-slate-800 pb-2">
              🔒 Alterar Senha de Administrador
            </h2>

            <form onSubmit={handleChangePassword} className="space-y-4 text-xs">
              <div className="flex flex-col space-y-1">
                <label className="font-bold text-slate-400">Senha Atual</label>
                <input
                  type="password"
                  required
                  placeholder="Digite a senha atual"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="custom-input bg-slate-950 border-slate-800 text-slate-300 text-sm"
                />
              </div>

              <div className="flex flex-col space-y-1">
                <label className="font-bold text-slate-400">Nova Senha</label>
                <input
                  type="password"
                  required
                  placeholder="Mínimo 6 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="custom-input bg-slate-950 border-slate-800 text-slate-300 text-sm"
                />
              </div>

              <div className="flex flex-col space-y-1">
                <label className="font-bold text-slate-400">Confirmar Nova Senha</label>
                <input
                  type="password"
                  required
                  placeholder="Confirme a nova senha"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="custom-input bg-slate-950 border-slate-800 text-slate-300 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary py-2.5 w-full flex items-center justify-center gap-2 text-sm font-bold mt-2"
              >
                {loading ? <span className="spinner"></span> : "Alterar Senha"}
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}
