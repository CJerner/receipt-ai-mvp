import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Only GET allowed" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Ikke autoriseret" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return res.status(401).json({ error: "Ugyldig session" });

  // Hent brugerens firma og rolle
  const { data, error } = await supabase
    .from("company_users")
    .select("role, companies(id, name)")
    .eq("user_id", user.id)
    .single();

  if (error || !data) return res.status(200).json({ company: null, role: null });

  return res.status(200).json({
    company: data.companies,
    role: data.role
  });
}
