import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Only GET allowed" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Ikke autoriseret" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("exported", false)
    .eq("status", "approved")
    .order("date", { ascending: false });

  if (error) return res.status(500).json(error);

  if (!data.length) {
    return res.status(200).send("\uFEFFIngen kvitteringer at eksportere");
  }

  const headers = ["Dato","Leverandør","Beløb inkl. moms","Moms","Beløb ex. moms","Momssats %","Kategori","Konto","Kontonavn","Betalingsmetode","Valuta"];

  const rows = data.map(r => {
    const amountEx = (Number(r.amount) || 0) - (Number(r.vat) || 0);
    return [
      r.date || "", r.vendor || "",
      r.amount != null ? Number(r.amount).toFixed(2) : "",
      r.vat != null ? Number(r.vat).toFixed(2) : "",
      amountEx ? amountEx.toFixed(2) : "",
      r.vat_rate != null ? Number(r.vat_rate).toFixed(0) : "",
      r.category || "", r.account || "", r.account_name || "",
      r.payment_method || "", r.currency || "DKK"
    ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(";");
  });

  // Markér som eksporteret
  await supabase.from("receipts").update({ exported: true }).in("id", data.map(r => r.id));

  const csv = [headers.join(";"), ...rows].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kvitteringer-${new Date().toISOString().slice(0,10)}.csv"`);
  return res.status(200).send("\uFEFF" + csv);
}
