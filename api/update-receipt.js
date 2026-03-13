import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const { id, account } = req.body;

  if (!id || !account) {
    return res.status(400).json({ error: "id og account er påkrævet" });
  }

  const { error } = await supabase
    .from("receipts")
    .update({ account })
    .eq("id", id);

  if (error) {
    return res.status(500).json(error);
  }

  return res.status(200).json({ success: true });
}
