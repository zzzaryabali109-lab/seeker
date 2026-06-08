// Bootstraps the permanent admin account. Idempotent & safe to call repeatedly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = "alibhai999@gmail.com";
const ADMIN_PASSWORD = Deno.env.get("ADMIN_BOOTSTRAP_PASSWORD");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find existing user
    const { data: list } = await supabase.auth.admin.listUsers();
    const existing = list?.users?.find(
      (u) => (u.email ?? "").toLowerCase() === ADMIN_EMAIL
    );

    let userId: string;
    let created = false;

    if (!existing) {
      if (!ADMIN_PASSWORD) {
        throw new Error("ADMIN_BOOTSTRAP_PASSWORD is not configured");
      }
      const { data, error } = await supabase.auth.admin.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        email_confirm: true,
      });
      if (error) throw error;
      userId = data.user!.id;
      created = true;
    } else {
      userId = existing.id;
      if (ADMIN_PASSWORD) {
        await supabase.auth.admin.updateUserById(userId, {
          password: ADMIN_PASSWORD,
          email_confirm: true,
        });
      }
    }

    await supabase
      .from("profiles")
      .upsert({
        user_id: userId,
        email: ADMIN_EMAIL,
        full_name: "ALI786",
        email_verified: true,
      }, { onConflict: "user_id" });

    // Ensure admin role
    await supabase
      .from("user_roles")
      .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });

    return new Response(JSON.stringify({ ok: true, created }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
