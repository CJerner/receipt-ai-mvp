import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Only GET allowed" });
  }

  // Hent kun aktive (ikke-eksporterede) kvitteringer
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("exported", false)
    .order("date", { ascending: false });

  if (error) {
    return res.status(500).json(error);
  }

  if (!data.length) {
    return res.status(200).send("\uFEFFIngen kvitteringer at eksportere");
  }

  // CSV header
  const headers = [
    "Dato",
    "Leverandør",
    "Beløb inkl. moms",
    "Moms",
    "Beløb ex. moms",
    "Momssats %",
    "Kategori",
    "Konto",
    "Kontonavn",
    "Betalingsmetode",
    "Valuta"
  ];

  const rows = data.map(r => {
    const amountEx = (Number(r.amount) || 0) - (Number(r.vat) || 0);
    return [
      r.date || "",
      r.vendor || "",
      r.amount != null ? Number(r.amount).toFixed(2) : "",
      r.vat != null ? Number(r.vat).toFixed(2) : "",
      amountEx ? amountEx.toFixed(2) : "",
      r.vat_rate != null ? Number(r.vat_rate).toFixed(0) : "",
      r.category || "",
      r.account || "",
      r.account_name || "",
      r.payment_method || "",
      r.currency || "DKK"
    ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(";");
  });

  const csv = [headers.join(";"), ...rows].join("\n");

  // Markér alle som eksporteret
  const ids = data.map(r => r.id);
  await supabase
    .from("receipts")
    .update({ exported: true })
    .in("id", ids);

  // BOM for dansk tegnsæt i Excel
  const bom = "\uFEFF";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kvitteringer-${new Date().toISOString().slice(0,10)}.csv"`);
  return res.status(200).send(bom + csv);
}
