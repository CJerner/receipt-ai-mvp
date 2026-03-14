import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Ikke autoriseret" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  // Verificer at kalderen er admin
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return res.status(401).json({ error: "Ugyldig session" });

  const { data: callerData } = await supabase
    .from("company_users")
    .select("role, company_id")
    .eq("user_id", user.id)
    .single();

  if (!callerData || callerData.role !== "admin") {
    return res.status(403).json({ error: "Kun admins kan invitere brugere" });
  }

  const { email, role = "member" } = req.body;
  if (!email) return res.status(400).json({ error: "Email er påkrævet" });

  // Brug Supabase service role til at invitere
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Inviter bruger via Supabase Auth
  const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { invited_by: user.id, company_id: callerData.company_id }
  });

  if (inviteError) return res.status(500).json({ error: inviteError.message });

  // Tilknyt bruger til firma
  const { error: linkError } = await supabaseAdmin
    .from("company_users")
    .insert([{
      company_id: callerData.company_id,
      user_id: inviteData.user.id,
      role
    }]);

  if (linkError) return res.status(500).json({ error: linkError.message });

  return res.status(200).json({ success: true, email });
}
