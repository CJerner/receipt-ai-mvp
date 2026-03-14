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

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Firmanavn er påkrævet" });

  // Opret firma
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .insert([{ name }])
    .select()
    .single();

  if (companyError) return res.status(500).json({ error: companyError.message });

  // Tilknyt bruger som admin
  const { error: userError } = await supabase
    .from("company_users")
    .insert([{ company_id: company.id, user_id: user.id, role: "admin" }]);

  if (userError) return res.status(500).json({ error: userError.message });

  return res.status(200).json({ company });
}
