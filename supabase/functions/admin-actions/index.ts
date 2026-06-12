// Supabase Edge Function: admin-actions
// Handles administrative actions securely (login, config updates, bet moderation, result launching).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function hashString(str: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { action, payload } = body;

    const ipAddress = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown";
    const ipHash = await hashString(ipAddress);

    // =========================================================================
    // ACTION: LOGIN
    // =========================================================================
    if (action === "login") {
      const { password, captchaToken, captchaAnswer } = payload;
      if (!password) {
        return new Response(JSON.stringify({ ok: false, message: "Senha não fornecida", errorCode: "MISSING_PASSWORD" }), { headers: corsHeaders, status: 400 });
      }

      // 0. Verify Captcha
      if (!captchaToken || !captchaAnswer) {
        return new Response(
          JSON.stringify({ ok: false, message: "Verificação de segurança (Captcha) ausente.", errorCode: "CAPTCHA_MISSING" }),
          { headers: corsHeaders, status: 400 }
        );
      }

      const captchaTokenHash = await hashString(captchaToken);
      const { data: captchaData, error: captchaFetchError } = await supabase
        .from("math_captchas")
        .select("*")
        .eq("token_hash", captchaTokenHash)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (captchaFetchError || !captchaData) {
        return new Response(
          JSON.stringify({ ok: false, message: "Verificação de segurança expirou. Recarregue a página.", errorCode: "CAPTCHA_EXPIRED" }),
          { headers: corsHeaders, status: 400 }
        );
      }

      // Update captcha as used immediately (single-use constraint)
      await supabase
        .from("math_captchas")
        .update({ used_at: new Date().toISOString() })
        .eq("id", captchaData.id);

      const answerHash = await hashString(String(captchaAnswer).trim());
      if (answerHash !== captchaData.answer_hash) {
        return new Response(
          JSON.stringify({ ok: false, message: "Resposta de verificação incorreta. Tente novamente.", errorCode: "CAPTCHA_WRONG" }),
          { headers: corsHeaders, status: 400 }
        );
      }

      // 1. Rate limiting check (max 5 failed attempts in the last 15 minutes)
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count: failedCount, error: rateLimitError } = await supabase
        .from("admin_login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .eq("success", false)
        .gt("created_at", fifteenMinsAgo);

      if (rateLimitError) throw rateLimitError;
      if (failedCount !== null && failedCount >= 5) {
        return new Response(
          JSON.stringify({ ok: false, message: "Muitas tentativas incorretas. Tente novamente em 15 minutos.", errorCode: "TOO_MANY_ATTEMPTS" }),
          { headers: corsHeaders, status: 429 }
        );
      }

      // 2. Validate password against DB (fallback to Env Var and initialize)
      const passwordHash = await hashString(password);
      
      let expectedHash = "";
      const { data: dbCredential } = await supabase
        .from("admin_credentials")
        .select("password_hash")
        .eq("id", 1)
        .maybeSingle();

      if (dbCredential) {
        expectedHash = dbCredential.password_hash;
      } else {
        // Fall back to environment variable
        expectedHash = Deno.env.get("ADMIN_PASSWORD_HASH") ?? "";
        
        // Initialize database row so it's ready for future changes
        if (expectedHash) {
          await supabase
            .from("admin_credentials")
            .insert({ id: 1, password_hash: expectedHash });
        }
      }

      if (!expectedHash || passwordHash !== expectedHash) {
        // Log failed attempt
        await supabase.from("admin_login_attempts").insert({ identifier: "admin", ip_hash: ipHash, success: false });
        return new Response(JSON.stringify({ ok: false, message: "Senha incorreta.", errorCode: "INVALID_CREDENTIALS" }), { headers: corsHeaders, status: 401 });
      }

      // Log success attempt
      await supabase.from("admin_login_attempts").insert({ identifier: "admin", ip_hash: ipHash, success: true });

      // Create admin session token
      const sessionToken = crypto.randomUUID();
      const sessionTokenHash = await hashString(sessionToken);
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours

      const { error: sessionError } = await supabase
        .from("admin_sessions")
        .insert({
          token_hash: sessionTokenHash,
          expires_at: expiresAt
        });

      if (sessionError) throw sessionError;

      // Log audit
      await supabase.from("audit_logs").insert({
        action: "ADMIN_LOGIN",
        entity_type: "ADMIN_SESSIONS",
        actor: "ADMIN",
        details: { ip_hash: ipHash }
      });

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Login realizado com sucesso",
          data: { token: sessionToken, expires_at: expiresAt }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // AUTHENTICATE SESSION (For all other actions)
    // =========================================================================
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, message: "Token de autorização ausente.", errorCode: "UNAUTHORIZED" }), { headers: corsHeaders, status: 401 });
    }

    const token = authHeader.substring(7);
    const tokenHash = await hashString(token);

    const { data: session, error: sessionFetchError } = await supabase
      .from("admin_sessions")
      .select("*")
      .eq("token_hash", tokenHash)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessionFetchError || !session) {
      return new Response(JSON.stringify({ ok: false, message: "Sessão expirada ou inválida. Faça login novamente.", errorCode: "UNAUTHORIZED" }), { headers: corsHeaders, status: 401 });
    }

    // Extend session expiration (extend by 2 hours)
    const newExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("admin_sessions")
      .update({ expires_at: newExpiresAt, last_used_at: new Date().toISOString() })
      .eq("id", session.id);

    // =========================================================================
    // ACTION: CHANGE PASSWORD
    // =========================================================================
    if (action === "change-password") {
      const { oldPassword, newPassword } = payload;
      if (!oldPassword || !newPassword) {
        return new Response(JSON.stringify({ ok: false, message: "Campos obrigatórios ausentes." }), { headers: corsHeaders, status: 400 });
      }

      if (newPassword.length < 6) {
        return new Response(JSON.stringify({ ok: false, message: "A nova senha deve ter no mínimo 6 caracteres." }), { headers: corsHeaders, status: 400 });
      }

      // 1. Fetch current password hash
      let expectedHash = "";
      const { data: dbCredential } = await supabase
        .from("admin_credentials")
        .select("password_hash")
        .eq("id", 1)
        .maybeSingle();

      if (dbCredential) {
        expectedHash = dbCredential.password_hash;
      } else {
        expectedHash = Deno.env.get("ADMIN_PASSWORD_HASH") ?? "";
      }

      // 2. Validate current password
      const oldPasswordHash = await hashString(oldPassword);
      if (!expectedHash || oldPasswordHash !== expectedHash) {
        return new Response(JSON.stringify({ ok: false, message: "Senha atual incorreta." }), { headers: corsHeaders, status: 400 });
      }

      // 3. Update to new password hash
      const newPasswordHash = await hashString(newPassword);
      
      const { error: dbUpdateError } = await supabase
        .from("admin_credentials")
        .upsert({ id: 1, password_hash: newPasswordHash });

      if (dbUpdateError) throw dbUpdateError;

      // 4. Terminate other admin sessions
      await supabase
        .from("admin_sessions")
        .delete()
        .neq("token_hash", tokenHash);

      // 5. Log audit
      await supabase.from("audit_logs").insert({
        action: "ADMIN_CHANGE_PASSWORD",
        entity_type: "ADMIN_CREDENTIALS",
        actor: "ADMIN",
        details: { ip_hash: ipHash }
      });

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Senha alterada com sucesso! Outras sessões ativas foram desconectadas."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: DASHBOARD STATS
    // =========================================================================
    if (action === "get-dashboard") {
      // Fetch pool details
      const { data: pool } = await supabase
        .from("pools")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!pool) {
        return new Response(JSON.stringify({ ok: true, data: { noPool: true } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Fetch aggregated bet counts and amounts
      const { data: betsData, error: betsErr } = await supabase
        .from("bets")
        .select("status, amount, is_winner")
        .eq("pool_id", pool.id);

      if (betsErr) throw betsErr;

      let totalBets = 0;
      let pendingBets = 0;
      let paidBets = 0;
      let rejectedBets = 0;
      let totalCollected = 0;
      let winnersCount = 0;

      betsData?.forEach((b) => {
        totalBets++;
        if (b.status === "PENDING") pendingBets++;
        else if (b.status === "PAID") {
          paidBets++;
          totalCollected += Number(b.amount);
          if (b.is_winner) winnersCount++;
        }
        else if (b.status === "REJECTED") rejectedBets++;
      });

      const prizePercent = pool.prize_percent;
      const estimatedPrize = totalCollected * (prizePercent / 100.0);

      // Fetch result details if FINISHED
      let result = null;
      if (pool.status === "FINISHED") {
        const { data: resData } = await supabase
          .from("results")
          .select("*")
          .eq("pool_id", pool.id)
          .single();
        result = resData;
      }

      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            pool,
            stats: {
              totalBets,
              pendingBets,
              paidBets,
              rejectedBets,
              totalCollected,
              estimatedPrize,
              winnersCount,
            },
            result,
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: LIST BETS
    // =========================================================================
    if (action === "list-bets") {
      const { poolId, statusFilter, searchQuery } = payload;
      
      let query = supabase
        .from("bets")
        .select("*")
        .eq("pool_id", poolId)
        .order("created_at", { ascending: false });

      if (statusFilter && statusFilter !== "ALL") {
        if (statusFilter === "WINNERS") {
          query = query.eq("is_winner", true).eq("status", "PAID");
        } else {
          query = query.eq("status", statusFilter);
        }
      }

      const { data: bets, error: betsErr } = await query;
      if (betsErr) throw betsErr;

      // Filter in memory for fuzzy text search (Name, WhatsApp, Public Code, Score)
      let filteredBets = bets || [];
      if (searchQuery && searchQuery.trim() !== "") {
        const search = searchQuery.toLowerCase().trim();
        filteredBets = filteredBets.filter((b) => {
          return (
            b.participant_name.toLowerCase().includes(search) ||
            b.phone.includes(search) ||
            b.phone_normalized.includes(search) ||
            b.public_code.toLowerCase().includes(search) ||
            `${b.home_score}x${b.away_score}`.includes(search) ||
            `${b.home_score} x ${b.away_score}`.includes(search)
          );
        });
      }

      return new Response(
        JSON.stringify({
          ok: true,
          data: filteredBets,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: UPDATE BET STATUS (Approve, Reject, Revert)
    // =========================================================================
    if (action === "update-bet-status") {
      const { betId, newStatus, adminNote } = payload;

      const { data: bet, error: fetchBetErr } = await supabase
        .from("bets")
        .select("*")
        .eq("id", betId)
        .single();

      if (fetchBetErr || !bet) {
        return new Response(JSON.stringify({ ok: false, message: "Palpite não encontrado" }), { headers: corsHeaders, status: 404 });
      }

      const updateFields: any = {
        status: newStatus,
        admin_note: adminNote || bet.admin_note,
        updated_at: new Date().toISOString(),
      };

      if (newStatus === "PAID") {
        updateFields.payment_confirmed_at = new Date().toISOString();
        updateFields.rejected_at = null;
      } else if (newStatus === "REJECTED") {
        updateFields.rejected_at = new Date().toISOString();
        updateFields.payment_confirmed_at = null;
        updateFields.is_winner = false;
      } else if (newStatus === "PENDING") {
        updateFields.payment_confirmed_at = null;
        updateFields.rejected_at = null;
        updateFields.is_winner = false;
      }

      const { data: updatedBet, error: updateErr } = await supabase
        .from("bets")
        .update(updateFields)
        .eq("id", betId)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Log audit
      await supabase.from("audit_logs").insert({
        action: newStatus === "PAID" ? "APPROVE_BET" : (newStatus === "REJECTED" ? "REJECT_BET" : "REVERT_BET"),
        entity_type: "BETS",
        entity_id: bet.id,
        public_code: bet.public_code,
        old_status: bet.status,
        new_status: newStatus,
        actor: "ADMIN_DASHBOARD",
        details: { note: adminNote || "" },
      });

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Palpite atualizado com sucesso",
          data: updatedBet
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: UPDATE POOL CONFIG (or Create if none exists)
    // =========================================================================
    if (action === "update-pool-config") {
      const config = payload;

      const fieldsToSave: any = {
        name: config.name,
        home_team: config.home_team,
        away_team: config.away_team,
        home_team_image_url: config.home_team_image_url || null,
        away_team_image_url: config.away_team_image_url || null,
        bet_amount: parseFloat(config.bet_amount),
        prize_percent: parseFloat(config.prize_percent || "75"),
        deadline: new Date(config.deadline).toISOString(),
        status: config.status || "OPEN",
        allow_repeated_score: config.allow_repeated_score === true,
        max_bets_per_phone: parseInt(config.max_bets_per_phone || "5", 10),
        pix_key: config.pix_key,
        pix_receiver_name: config.pix_receiver_name,
        organizer_whatsapp: config.organizer_whatsapp.replace(/\D/g, ""),
        theme: config.theme || "verde",
        show_splash_screen: config.show_splash_screen === true,
        updated_at: new Date().toISOString(),
      };

      let result;

      if (config.id) {
        // Update existing pool
        const { data, error } = await supabase
          .from("pools")
          .update(fieldsToSave)
          .eq("id", config.id)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        // Create new pool
        const { data, error } = await supabase
          .from("pools")
          .insert(fieldsToSave)
          .select()
          .single();
        if (error) throw error;
        result = data;
      }

      // Log audit
      await supabase.from("audit_logs").insert({
        action: "UPDATE_CONFIG",
        entity_type: "POOLS",
        entity_id: result.id,
        actor: "ADMIN",
        details: fieldsToSave,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Configuração do bolão salva com sucesso",
          data: result
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: LAUNCH RESULT (Calculates winners and shuts down pool)
    // =========================================================================
    if (action === "launch-result") {
      const { poolId, homeScore, awayScore } = payload;
      
      const homeScoreVal = parseInt(homeScore, 10);
      const awayScoreVal = parseInt(awayScore, 10);

      if (isNaN(homeScoreVal) || isNaN(awayScoreVal) || homeScoreVal < 0 || awayScoreVal < 0) {
        return new Response(JSON.stringify({ ok: false, message: "Placar do resultado inválido" }), { headers: corsHeaders, status: 400 });
      }

      const scoreKey = `${homeScoreVal}-${awayScoreVal}`;

      // 1. Fetch pool
      const { data: pool, error: poolFetchErr } = await supabase
        .from("pools")
        .select("*")
        .eq("id", poolId)
        .single();

      if (poolFetchErr || !pool) {
        return new Response(JSON.stringify({ ok: false, message: "Bolão não encontrado" }), { headers: corsHeaders, status: 404 });
      }

      // 2. Fetch all PAID bets
      const { data: paidBets, error: fetchPaidErr } = await supabase
        .from("bets")
        .select("*")
        .eq("pool_id", poolId)
        .eq("status", "PAID");

      if (fetchPaidErr) throw fetchPaidErr;

      // 3. Mark winners
      const winnerBets = paidBets?.filter(b => b.score_key === scoreKey) || [];
      const totalWinners = winnerBets.length;

      // Reset all bets to non-winner first, then set winners
      await supabase
        .from("bets")
        .update({ is_winner: false })
        .eq("pool_id", poolId);

      if (totalWinners > 0) {
        const winnerIds = winnerBets.map(b => b.id);
        const { error: setWinnersErr } = await supabase
          .from("bets")
          .update({ is_winner: true })
          .in("id", winnerIds);
        if (setWinnersErr) throw setWinnersErr;
      }

      // 4. Calculate prize values
      const totalPaidCount = paidBets?.length || 0;
      const totalCollected = totalPaidCount * Number(pool.bet_amount);
      const totalPrize = totalCollected * (Number(pool.prize_percent) / 100.0);
      const prizePerWinner = totalWinners > 0 ? (totalPrize / totalWinners) : 0;

      // 5. Update or insert result entry
      const { error: resultErr } = await supabase
        .from("results")
        .upsert({
          pool_id: poolId,
          home_score: homeScoreVal,
          away_score: awayScoreVal,
          score_key: scoreKey,
          total_winners: totalWinners,
          total_prize: totalPrize,
          prize_per_winner: prizePerWinner,
        }, { onConflict: "pool_id" });

      if (resultErr) throw resultErr;

      // 6. Update pool status to FINISHED
      const { error: poolUpdateErr } = await supabase
        .from("pools")
        .update({ status: "FINISHED", updated_at: new Date().toISOString() })
        .eq("id", poolId);

      if (poolUpdateErr) throw poolUpdateErr;

      // 7. Audit log
      await supabase.from("audit_logs").insert({
        action: "LAUNCH_RESULT",
        entity_type: "POOLS",
        entity_id: poolId,
        actor: "ADMIN",
        details: { home_score: homeScoreVal, away_score: awayScoreVal, total_winners: totalWinners, total_prize: totalPrize },
      });

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Resultado lançado com sucesso e bolão finalizado!",
          data: {
            homeScore: homeScoreVal,
            awayScore: awayScoreVal,
            totalWinners,
            totalPrize,
            prizePerWinner,
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: GET TELEGRAM CONFIG
    // =========================================================================
    if (action === "get-telegram-config") {
      const { data: tgConfig } = await supabase
        .from("telegram_config")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      if (!tgConfig) {
        return new Response(
          JSON.stringify({ ok: true, data: { configured: false, bot_token_masked: "", admin_chat_id: "", webhook_secret_masked: "" } }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Mask token and secret for display security
      const maskValue = (val: string) => val.length > 8 ? val.substring(0, 6) + "••••••" + val.substring(val.length - 4) : (val ? "••••••" : "");

      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            configured: tgConfig.bot_token.length > 0,
            bot_token_masked: maskValue(tgConfig.bot_token),
            admin_chat_id: tgConfig.admin_chat_id,
            webhook_secret_masked: maskValue(tgConfig.webhook_secret),
            updated_at: tgConfig.updated_at,
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: SAVE TELEGRAM CONFIG
    // =========================================================================
    if (action === "save-telegram-config") {
      const { bot_token, admin_chat_id, webhook_secret } = payload;

      if (!bot_token || !admin_chat_id || !webhook_secret) {
        return new Response(
          JSON.stringify({ ok: false, message: "Todos os campos são obrigatórios: Token do Bot, Chat ID e Webhook Secret." }),
          { headers: corsHeaders, status: 400 }
        );
      }

      const { error: upsertErr } = await supabase
        .from("telegram_config")
        .upsert({ id: 1, bot_token, admin_chat_id, webhook_secret, updated_at: new Date().toISOString() });

      if (upsertErr) throw upsertErr;

      await supabase.from("audit_logs").insert({
        action: "SAVE_TELEGRAM_CONFIG",
        entity_type: "TELEGRAM_CONFIG",
        actor: "ADMIN",
        details: { admin_chat_id },
      });

      return new Response(
        JSON.stringify({ ok: true, message: "Configurações do Telegram salvas com sucesso!" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: TEST TELEGRAM CONNECTION
    // =========================================================================
    if (action === "test-telegram") {
      // Load config from DB
      const { data: tgConfig } = await supabase
        .from("telegram_config")
        .select("bot_token, admin_chat_id")
        .eq("id", 1)
        .maybeSingle();

      const botToken = tgConfig?.bot_token || Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
      const chatId = tgConfig?.admin_chat_id || Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") || "";

      if (!botToken || !chatId) {
        return new Response(
          JSON.stringify({ ok: false, message: "Token ou Chat ID não configurados. Salve as credenciais primeiro." }),
          { headers: corsHeaders, status: 400 }
        );
      }

      const testRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "✅ *Teste de Conexão — Bolão de Placar Exato*\n\nSua integração com o Bot Telegram está funcionando corretamente! As notificações de novos palpites serão enviadas aqui.",
          parse_mode: "Markdown",
        }),
      });

      const testJson = await testRes.json();

      if (!testJson.ok) {
        return new Response(
          JSON.stringify({ ok: false, message: `Erro ao enviar mensagem de teste: ${testJson.description || "Erro desconhecido"}. Verifique o token e o chat ID.` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ ok: true, message: "✅ Mensagem de teste enviada com sucesso! Verifique o seu Telegram." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: REGISTER TELEGRAM WEBHOOK
    // =========================================================================
    if (action === "register-telegram-webhook") {
      const { data: tgConfig } = await supabase
        .from("telegram_config")
        .select("bot_token, webhook_secret")
        .eq("id", 1)
        .maybeSingle();

      const botToken = tgConfig?.bot_token || Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
      const webhookSecret = tgConfig?.webhook_secret || Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";

      if (!botToken || !webhookSecret) {
        return new Response(
          JSON.stringify({ ok: false, message: "Token ou Webhook Secret não configurados. Salve as credenciais primeiro." }),
          { headers: corsHeaders, status: 400 }
        );
      }

      const webhookUrl = `${supabaseUrl}/functions/v1/telegram-webhook?secret=${webhookSecret}`;

      const webhookRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl }),
      });

      const webhookJson = await webhookRes.json();

      if (!webhookJson.ok) {
        return new Response(
          JSON.stringify({ ok: false, message: `Erro ao registrar webhook: ${webhookJson.description || "Erro desconhecido"}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase.from("audit_logs").insert({
        action: "REGISTER_TELEGRAM_WEBHOOK",
        entity_type: "TELEGRAM_CONFIG",
        actor: "ADMIN",
        details: { webhook_url: webhookUrl },
      });

      return new Response(
        JSON.stringify({ ok: true, message: `✅ Webhook registrado com sucesso! URL: ${webhookUrl}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // ACTION: AUDIT LOGS
    // =========================================================================
    if (action === "list-audit-logs") {
      const { data: logs, error: logsErr } = await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (logsErr) throw logsErr;

      return new Response(JSON.stringify({ ok: true, data: logs }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    // =========================================================================
    // ACTION: CLEAR TEST DATA
    // =========================================================================
    if (action === "clear-test-data") {
      const { poolId, confirmToken } = payload;

      // Extra safety: caller must send a specific confirm token
      if (confirmToken !== "CONFIRMAR_LIMPEZA_TOTAL") {
        return new Response(
          JSON.stringify({ ok: false, message: "Token de confirmação inválido.", errorCode: "INVALID_CONFIRM_TOKEN" }),
          { headers: corsHeaders, status: 400 }
        );
      }

      if (!poolId) {
        return new Response(
          JSON.stringify({ ok: false, message: "poolId é obrigatório.", errorCode: "MISSING_POOL_ID" }),
          { headers: corsHeaders, status: 400 }
        );
      }

      // 1. Delete all bets for this pool
      const { error: deleteBetsErr } = await supabase
        .from("bets")
        .delete()
        .eq("pool_id", poolId);
      if (deleteBetsErr) throw deleteBetsErr;

      // 2. Delete result for this pool (if any)
      const { error: deleteResultErr } = await supabase
        .from("results")
        .delete()
        .eq("pool_id", poolId);
      if (deleteResultErr) throw deleteResultErr;

      // 3. Delete all audit logs
      const { error: deleteLogsErr } = await supabase
        .from("audit_logs")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000"); // delete all rows
      if (deleteLogsErr) throw deleteLogsErr;

      // 4. Reset pool status back to OPEN
      const { error: resetPoolErr } = await supabase
        .from("pools")
        .update({ status: "OPEN", updated_at: new Date().toISOString() })
        .eq("id", poolId);
      if (resetPoolErr) throw resetPoolErr;

      // 5. Write a single fresh audit log so the table isn't empty
      await supabase.from("audit_logs").insert({
        action: "CLEAR_TEST_DATA",
        entity_type: "POOLS",
        entity_id: poolId,
        actor: "ADMIN",
        details: { cleared_at: new Date().toISOString(), note: "Limpeza de dados de teste realizada pelo admin." },
      });

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Dados de teste limpos com sucesso! Todos os palpites, resultado e logs foram removidos e o bolão foi reaberto.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ok: false, message: "Ação não suportada", errorCode: "UNSUPPORTED_ACTION" }), { headers: corsHeaders, status: 400 });


  } catch (error: any) {
    console.error("Error in admin-actions:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        message: error.message || "Erro interno no servidor admin",
        errorCode: "INTERNAL_ERROR",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
