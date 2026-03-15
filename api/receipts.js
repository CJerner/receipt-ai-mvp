import { createClient } from "@supabase/supabase-js";

function getSupabase(token) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Ikke autoriseret" });

  const supabase = getSupabase(token);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return res.status(401).json({ error: "Ugyldig session" });

  // GET — hent kvitteringer
  if (req.method === "GET") {
    const { data: companyUser } = await supabase
      .from("company_users").select("role, company_id").eq("user_id", user.id).single();

    let query = supabase.from("receipts").select("*").order("date", { ascending: false });
    if (companyUser?.role === "admin") {
      query = query.eq("company_id", companyUser.company_id);
    } else {
      query = query.eq("user_id", user.id);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json(error);
    return res.status(200).json(data);
  }

  if (req.method === "POST") {
    const { action, id, ...rest } = req.body;
    if (!id) return res.status(400).json({ error: "id er påkrævet" });

    // Slet
    if (action === "delete") {
      const { error } = await supabase.from("receipts").delete().eq("id", id);
      if (error) return res.status(500).json(error);
      return res.status(200).json({ success: true });
    }

    // Godkend / afvis — kun admin
    if (action === "approve" || action === "reject") {
      const { data: callerData } = await supabase
        .from("company_users").select("role, company_id").eq("user_id", user.id).single();
      if (!callerData || callerData.role !== "admin")
        return res.status(403).json({ error: "Kun admins kan godkende kvitteringer" });
      const status = action === "approve" ? "approved" : "rejected";
      const { error } = await supabase.from("receipts")
        .update({ status }).eq("id", id).eq("company_id", callerData.company_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true, status });
    }

    // Opdater felter
    const { error } = await supabase.from("receipts").update(rest).eq("id", id);
    if (error) return res.status(500).json(error);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
