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

  // Hent brugerens rolle og firma
  const { data: companyUser } = await supabase
    .from("company_users")
    .select("role, company_id")
    .eq("user_id", user.id)
    .single();

  let query = supabase.from("receipts").select("*").order("date", { ascending: false });

  if (companyUser?.role === "admin") {
    // Admin ser alle firma-kvitteringer
    query = query.eq("company_id", companyUser.company_id);
  } else {
    // Member ser kun egne kvitteringer
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json(error);

  return res.status(200).json(data);
}
