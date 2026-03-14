import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Ikke autoriseret" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return res.status(401).json({ error: "Ugyldig session" });

  // Verificer admin rolle
  const { data: callerData } = await supabase
    .from("company_users")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!callerData || callerData.role !== "admin") {
    return res.status(403).json({ error: "Kun admins kan godkende kvitteringer" });
  }

  const { id, action } = req.body; // action: 'approve' eller 'reject'
  if (!id || !action) return res.status(400).json({ error: "id og action er påkrævet" });

  const status = action === "approve" ? "approved" : "rejected";

  const { error } = await supabase
    .from("receipts")
    .update({ status })
    .eq("id", id);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true, status });
}
