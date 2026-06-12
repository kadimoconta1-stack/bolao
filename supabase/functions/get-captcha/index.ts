// Supabase Edge Function: get-captcha
// Generates a simple math question and records the validation token.

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

serve(async (req) => {
  // Handle CORS preflight request
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

    // Generate math captcha: numbers from 1 to 20
    const num1 = Math.floor(Math.random() * 20) + 1;
    const num2 = Math.floor(Math.random() * 20) + 1;
    const isAddition = Math.random() > 0.5;

    let question = "";
    let answer = 0;

    if (isAddition) {
      question = `Quanto é ${num1} + ${num2}?`;
      answer = num1 + num2;
    } else {
      // Ensure answer is never negative
      const max = Math.max(num1, num2);
      const min = Math.min(num1, num2);
      question = `Quanto é ${max} - ${min}?`;
      answer = max - min;
    }

    // Generate unique token (using standard crypto.randomUUID)
    const token = crypto.randomUUID();
    const tokenHash = await hashString(token);
    const answerHash = await hashString(String(answer));

    // Save in database (expires in 5 minutes)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("math_captchas")
      .insert({
        token_hash: tokenHash,
        question: question,
        answer_hash: answerHash,
        expires_at: expiresAt,
      });

    if (error) {
      console.error("Database insert error:", error);
      throw error;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Captcha gerado com sucesso",
        data: {
          token: token,
          question: question,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error("Error in get-captcha:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        message: "Erro interno ao gerar captcha",
        errorCode: "INTERNAL_ERROR",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
