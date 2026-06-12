// Supabase Edge Function: telegram-webhook
// Receives Telegram inline button callback actions to Approve/Reject bets.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    // Load telegram credentials: prefer env vars, fall back to DB config
    let telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
    let telegramAdminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") ?? "";
    let telegramAdminUserId = "";
    let telegramGroupChatId = "";
    let dbWebhookSecret = "";

    const { data: tgConfig } = await supabase
      .from("telegram_config")
      .select("bot_token, admin_chat_id, admin_user_id, group_chat_id, webhook_secret")
      .eq("id", 1)
      .maybeSingle();

    if (tgConfig) {
      telegramBotToken = tgConfig.bot_token || telegramBotToken;
      telegramAdminChatId = tgConfig.admin_chat_id || telegramAdminChatId;
      telegramAdminUserId = tgConfig.admin_user_id || "";
      telegramGroupChatId = tgConfig.group_chat_id || "";
      dbWebhookSecret = tgConfig.webhook_secret || "";
    }

    const url = new URL(req.url);
    const secretParam = url.searchParams.get("secret");
    const envWebhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

    // 1. Verify webhook secret against env variable or database config
    const isSecretValid = 
      (secretParam && envWebhookSecret && secretParam === envWebhookSecret) ||
      (secretParam && dbWebhookSecret && secretParam === dbWebhookSecret);

    if (!isSecretValid) {
      console.warn("Invalid webhook secret param");
      return new Response(JSON.stringify({ ok: false, message: "Unauthorized" }), { status: 401 });
    }

    const update = await req.json();

    console.log("Telegram Webhook Update received:", JSON.stringify(update));

    if (!update.callback_query) {
      // Not a callback query, ignore
      return new Response(JSON.stringify({ ok: true, message: "No action needed" }), { status: 200 });
    }

    const cbQuery = update.callback_query;
    const fromId = String(cbQuery.from.id);
    const chatId = String(cbQuery.message.chat.id);

    // 2. Validate Telegram admin identity (check both sender, private chat, group chat and admin ID)
    const isAllowed = 
      (telegramGroupChatId && chatId === telegramGroupChatId) ||
      (telegramAdminChatId && (chatId === telegramAdminChatId || fromId === telegramAdminChatId)) ||
      (telegramAdminUserId && (chatId === telegramAdminUserId || fromId === telegramAdminUserId));

    if (!isAllowed) {
      console.warn(`Unauthorized chat access from user: ${fromId}, chat: ${chatId}. Expected admin: ${telegramAdminUserId}/${telegramAdminChatId}, group: ${telegramGroupChatId}`);
      
      // Answer callback anyway so the UI doesn't hang, but tell them they can't do this
      await fetch(`https://api.telegram.org/bot${telegramBotToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: cbQuery.id,
          text: "Acesso negado. Você não tem permissão para aprovar/reprovar neste bolão.",
          show_alert: true,
        }),
      });

      return new Response(JSON.stringify({ ok: false, message: "Forbidden admin chat" }), { status: 403 });
    }

    // 3. Parse action and bet ID
    const callbackData = cbQuery.data ?? ""; // Format: "approve:<bet_uuid>" or "reject:<bet_uuid>"
    const separatorIndex = callbackData.indexOf(":");
    if (separatorIndex === -1) {
      return new Response(JSON.stringify({ ok: false, message: "Invalid callback format" }), { status: 400 });
    }

    const action = callbackData.substring(0, separatorIndex);
    const betId = callbackData.substring(separatorIndex + 1);

    // Fetch the bet
    const { data: bet, error: fetchError } = await supabase
      .from("bets")
      .select("*, pools(home_team, away_team)")
      .eq("id", betId)
      .single();

    if (fetchError || !bet) {
      await fetch(`https://api.telegram.org/bot${telegramBotToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: cbQuery.id,
          text: "Palpite não encontrado no sistema.",
          show_alert: true,
        }),
      });
      return new Response(JSON.stringify({ ok: false, message: "Bet not found" }), { status: 404 });
    }

    // Check if pool is closed or finished, but still allow approve/reject unless already processed
    if (bet.status !== "PENDING") {
      await fetch(`https://api.telegram.org/bot${telegramBotToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: cbQuery.id,
          text: `Este palpite já foi processado anteriormente (Status: ${bet.status === "PAID" ? "PAGO" : "REPROVADO"}).`,
          show_alert: true,
        }),
      });

      // Update message to remove buttons
      await updateTelegramMessage(telegramBotToken, chatId, cbQuery.message.message_id, bet, bet.status === "PAID" ? "✅ PAGO" : "❌ REPROVADO");
      return new Response(JSON.stringify({ ok: true, message: "Already processed" }), { status: 200 });
    }

    let nextStatus = "";
    let alertText = "";
    let updateFields = {};

    if (action === "approve") {
      nextStatus = "PAID";
      alertText = `Palpite ${bet.public_code} aprovado com sucesso!`;
      updateFields = {
        status: "PAID",
        payment_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    } else if (action === "reject") {
      nextStatus = "REJECTED";
      alertText = `Palpite ${bet.public_code} recusado.`;
      updateFields = {
        status: "REJECTED",
        rejected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    } else {
      return new Response(JSON.stringify({ ok: false, message: "Unknown action" }), { status: 400 });
    }

    // 4. Update Database
    const { error: updateError } = await supabase
      .from("bets")
      .update(updateFields)
      .eq("id", betId);

    if (updateError) {
      console.error("Database update error:", updateError);
      throw updateError;
    }

    // 5. Audit Log
    await supabase.from("audit_logs").insert({
      action: action === "approve" ? "APPROVE_BET" : "REJECT_BET",
      entity_type: "BETS",
      entity_id: bet.id,
      public_code: bet.public_code,
      old_status: "PENDING",
      new_status: nextStatus,
      actor: "TELEGRAM_ADMIN",
      details: { via: "telegram_callback" },
    });

    // 6. Answer callback query
    await fetch(`https://api.telegram.org/bot${telegramBotToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: cbQuery.id,
        text: alertText,
      }),
    });

    // 7. Update message text to remove inline keyboard and show status
    await updateTelegramMessage(telegramBotToken, chatId, cbQuery.message.message_id, { ...bet, status: nextStatus }, action === "approve" ? "✅ PAGO" : "❌ REPROVADO");

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Status updated successfully",
        data: { id: betId, status: nextStatus },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error: any) {
    console.error("Error in telegram-webhook:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        message: "Internal Server Error",
        errorCode: "INTERNAL_ERROR",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

// Helper to edit the telegram message text and clear the inline buttons
async function updateTelegramMessage(
  token: string,
  chatId: string,
  messageId: number,
  bet: any,
  statusLabel: string
) {
  const homeTeam = bet.pools?.home_team ?? "Casa";
  const awayTeam = bet.pools?.away_team ?? "Visitante";
  
  const textMessage = `🆕 *Novo palpite recebido (Processado)*\n\n` +
    `*Código:* \`${bet.public_code}\`\n` +
    `*Nome:* ${bet.participant_name}\n` +
    `*Telefone:* ${bet.phone}\n` +
    `*Palpite:* ${homeTeam} ${bet.home_score} x ${bet.away_score} ${awayTeam}\n` +
    `*Valor:* R$ ${Number(bet.amount).toFixed(2).replace(".", ",")}\n` +
    `*Status:* *${statusLabel}*`;

  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: textMessage,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [] // Remove all buttons
    }
  };

  const editRes = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!editRes.ok) {
    console.error("Failed to edit Telegram message:", await editRes.text());
  }
}
