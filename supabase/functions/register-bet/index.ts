// Supabase Edge Function: register-bet
// Handles bet registration, security validations, captcha verify, and Telegram bot notification.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function hashString(str: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(val);
}

// Generate unique 6 character uppercase alphanumeric code
function generatePublicCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
    let telegramAdminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") ?? "";
    let telegramAdminUserId = "";
    let telegramGroupChatId = "";

    const { data: tgConfig } = await supabase
      .from("telegram_config")
      .select("bot_token, admin_chat_id, admin_user_id, group_chat_id")
      .eq("id", 1)
      .maybeSingle();

    if (tgConfig) {
      telegramBotToken = tgConfig.bot_token || telegramBotToken;
      telegramAdminChatId = tgConfig.admin_chat_id || telegramAdminChatId;
      telegramAdminUserId = tgConfig.admin_user_id || "";
      telegramGroupChatId = tgConfig.group_chat_id || "";
    }

    const body = await req.json();


    const {
      nome,
      whatsapp,
      golsCasa,
      golsVisitante,
      captchaToken,
      captchaResposta,
      browser_session_id,
    } = body;

    // 1. Basic validation
    if (!nome || nome.trim().length < 2) {
      return new Response(
        JSON.stringify({ ok: false, message: "Informe seu nome (mínimo 2 letras).", errorCode: "INVALID_NAME" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const cleanPhone = whatsapp ? whatsapp.replace(/\D/g, "") : "";
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      return new Response(
        JSON.stringify({ ok: false, message: "WhatsApp inválido. Deve conter DDD e número.", errorCode: "INVALID_PHONE" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const homeScoreVal = parseInt(golsCasa, 10);
    const awayScoreVal = parseInt(golsVisitante, 10);
    if (isNaN(homeScoreVal) || isNaN(awayScoreVal) || homeScoreVal < 0 || awayScoreVal < 0) {
      return new Response(
        JSON.stringify({ ok: false, message: "Placar inválido.", errorCode: "INVALID_SCORE" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // 2. Validate Captcha
    if (!captchaToken || !captchaResposta) {
      return new Response(
        JSON.stringify({ ok: false, message: "Captcha ausente.", errorCode: "CAPTCHA_MISSING" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
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
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Update captcha as used immediately (single-use constraint)
    await supabase
      .from("math_captchas")
      .update({ used_at: new Date().toISOString() })
      .eq("id", captchaData.id);

    const answerHash = await hashString(String(captchaResposta).trim());
    if (answerHash !== captchaData.answer_hash) {
      return new Response(
        JSON.stringify({ ok: false, message: "Resposta de verificação incorreta. Tente novamente.", errorCode: "CAPTCHA_WRONG" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // 3. Fetch Active Pool
    const { data: pool, error: poolError } = await supabase
      .from("pools")
      .select("*")
      .eq("status", "OPEN")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (poolError || !pool) {
      return new Response(
        JSON.stringify({ ok: false, message: "Nenhum bolão aberto no momento.", errorCode: "NO_ACTIVE_POOL" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Validate deadline
    if (new Date(pool.deadline) <= new Date()) {
      return new Response(
        JSON.stringify({ ok: false, message: "O prazo limite para palpites já expirou.", errorCode: "POOL_EXPIRED" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const scoreKey = `${homeScoreVal}-${awayScoreVal}`;

    // 4. Duplicate bet check (same phone, same score)
    const { data: existingBet, error: checkBetError } = await supabase
      .from("bets")
      .select("public_code, status")
      .eq("pool_id", pool.id)
      .eq("phone_normalized", cleanPhone)
      .eq("home_score", homeScoreVal)
      .eq("away_score", awayScoreVal)
      .limit(1);

    if (existingBet && existingBet.length > 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: `Este palpite já foi registrado. Código: ${existingBet[0].public_code}.`,
          errorCode: "DUPLICATE",
          data: {
            codigo: existingBet[0].public_code,
            status: existingBet[0].status,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // 5. Block if there is any other PENDING bet for this phone (force user to pay or cancel)
    const { data: pendingBets, error: checkPendingError } = await supabase
      .from("bets")
      .select("public_code, home_score, away_score")
      .eq("pool_id", pool.id)
      .eq("phone_normalized", cleanPhone)
      .eq("status", "PENDING")
      .limit(1);

    if (pendingBets && pendingBets.length > 0) {
      const p = pendingBets[0];
      return new Response(
        JSON.stringify({
          ok: false,
          message: "Você já tem um palpite pendente!",
          errorCode: "TEM_PENDENTE",
          data: {
            codigoPendente: p.public_code,
            placarPendente: `${p.home_score} x ${p.away_score}`,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // 6. Max bets per phone check
    const { count: betsCount, error: countError } = await supabase
      .from("bets")
      .select("id", { count: "exact", head: true })
      .eq("pool_id", pool.id)
      .eq("phone_normalized", cleanPhone);

    if (betsCount !== null && betsCount >= pool.max_bets_per_phone) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: `Você atingiu o limite de ${pool.max_bets_per_phone} palpites por telefone neste bolão.`,
          errorCode: "LIMIT_EXCEEDED",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // 7. Repeated score rule validation (if allow_repeated_score = false, no other user can have this score)
    if (!pool.allow_repeated_score) {
      const { count: scoreExistsCount, error: scoreExistsError } = await supabase
        .from("bets")
        .select("id", { count: "exact", head: true })
        .eq("pool_id", pool.id)
        .eq("score_key", scoreKey)
        .in("status", ["PENDING", "PAID"]);

      if (scoreExistsCount !== null && scoreExistsCount > 0) {
        return new Response(
          JSON.stringify({
            ok: false,
            message: "Este placar já foi escolhido por outro participante. Escolha outro placar.",
            errorCode: "SCORE_TAKEN",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }
    }

    // 8. Generate unique public code
    let uniqueCode = "";
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 10) {
      uniqueCode = generatePublicCode();
      const { data: codeCheck } = await supabase
        .from("bets")
        .select("id")
        .eq("public_code", uniqueCode)
        .limit(1);
      if (!codeCheck || codeCheck.length === 0) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      throw new Error("Could not generate a unique public code");
    }

    // 9. Save bet
    const { data: newBet, error: insertError } = await supabase
      .from("bets")
      .insert({
        pool_id: pool.id,
        public_code: uniqueCode,
        participant_name: nome.trim(),
        phone: whatsapp.trim(),
        phone_normalized: cleanPhone,
        home_score: homeScoreVal,
        away_score: awayScoreVal,
        score_key: scoreKey,
        amount: pool.bet_amount,
        status: "PENDING",
        browser_session_id: browser_session_id || null,
      })
      .select()
      .single();

    if (insertError || !newBet) {
      console.error("Bet insertion error:", insertError);
      throw insertError;
    }

    // 10. Audit log
    await supabase.from("audit_logs").insert({
      action: "CREATE_BET",
      entity_type: "BETS",
      entity_id: newBet.id,
      public_code: uniqueCode,
      new_status: "PENDING",
      actor: `PARTICIPANT: ${nome.trim()}`,
      details: { phone: cleanPhone, score: scoreKey },
    });

    // 11. Dispatch Telegram Notification
    const targetChatId = telegramGroupChatId || telegramAdminChatId || telegramAdminUserId;
    if (telegramBotToken && targetChatId) {
      try {
        const textMessage = `🆕 *Novo palpite recebido*\n\n` +
          `*Código:* \`${uniqueCode}\`\n` +
          `*Nome:* ${nome.trim()}\n` +
          `*Telefone:* ${whatsapp.trim()}\n` +
          `*Palpite:* ${pool.home_team} ${homeScoreVal} x ${awayScoreVal} ${pool.away_team}\n` +
          `*Valor:* ${formatCurrency(pool.bet_amount)}\n` +
          `*Status:* PENDENTE`;

        const waText = `Olá! Fiz um palpite no bolão.\n\nCódigo: ${uniqueCode}\nNome: ${nome.trim()}\nTelefone: ${whatsapp.trim()}\nPalpite: ${pool.home_team} ${homeScoreVal} x ${awayScoreVal} ${pool.away_team}\n\nSegue o comprovante do pagamento.`;
        const whatsappUrl = `https://wa.me/${pool.organizer_whatsapp}?text=${encodeURIComponent(waText)}`;

        const payload = {
          chat_id: targetChatId,
          text: textMessage,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Aprovar pagamento", callback_data: `approve:${newBet.id}` },
                { text: "❌ Reprovar", callback_data: `reject:${newBet.id}` }
              ]
            ]
          }
        };

        const tgRes = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        
        if (!tgRes.ok) {
          console.error("Telegram API Error:", await tgRes.text());
        }
      } catch (tgErr) {
        console.error("Failed sending Telegram message:", tgErr);
      }
    }

    // 12. Return Response
    return new Response(
      JSON.stringify({
        ok: true,
        message: "Palpite registrado com sucesso",
        data: {
          codigo: uniqueCode,
          placar: `${homeScoreVal} x ${awayScoreVal}`,
          status: "PENDING",
          timeCasa: pool.home_team,
          timeVisitante: pool.away_team,
          valor: formatCurrency(pool.bet_amount),
          chavePix: pool.pix_key,
          nomeRecebedor: pool.pix_receiver_name,
          whatsappOrg: pool.organizer_whatsapp,
          nome: nome.trim(),
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error("Error in register-bet:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        message: "Erro interno ao processar palpite",
        errorCode: "INTERNAL_ERROR",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
