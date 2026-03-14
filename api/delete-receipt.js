import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Ikke autoriseret" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "id er påkrævet" });

  const { error } = await supabase.from("receipts").delete().eq("id", id);
  if (error) return res.status(500).json(error);
  return res.status(200).json({ success: true });
}
