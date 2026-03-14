import formidable from "formidable";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  // Auth
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Ikke autoriseret" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return res.status(401).json({ error: "Ugyldig session" });

  try {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
    const [, files] = await form.parse(req);
    const file = files.file?.[0];
    if (!file) return res.status(400).json({ error: "Ingen fil modtaget" });

    const imageBuffer = fs.readFileSync(file.filepath);
    const base64Image = imageBuffer.toString("base64");
    const mimeType = file.mimetype || "image/jpeg";

    // Upload billede til Supabase Storage
    const ext = mimeType.split("/")[1] || "jpg";
    const filename = `${user.id}/${Date.now()}.${ext}`;
    let imageUrl = null;

    const { error: storageError } = await supabase.storage
      .from("receipts")
      .upload(filename, imageBuffer, { contentType: mimeType });

    if (!storageError) {
      const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(filename);
      imageUrl = urlData?.publicUrl || null;
    } else {
      console.error("Storage fejl:", storageError);
    }

    // Send til OpenAI
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Du er en dansk bogholder. Analyser kvitteringsbilledet og returner KUN et JSON objekt uden markdown.
{
  "dato": "YYYY-MM-DD",
  "leverandør": "firmanavn",
  "beløb_inkl_moms": 0.00,
  "moms": 0.00,
  "moms_procent": 25,
  "kategori": "fx Transport / Kontor / Mad / Byggemarked",
  "konto": "dansk standardkontoplan 4-cifret nummer",
  "konto_navn": "fx Varekøb / Husleje / Rejseomkostninger",
  "betalingsmetode": "Kort / Kontant / MobilePay",
  "valuta": "DKK"
}
Hvis noget ikke kan aflæses, brug null.`
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: "high" } },
              { type: "text", text: "Analyser kvitteringen og returner JSON." }
            ]
          }
        ],
        max_tokens: 500
      })
    });

    const data = await openaiResponse.json();
    if (!data.choices) return res.status(500).json({ error: "OpenAI fejl", debug: data });

    const content = data.choices[0].message.content;
    let receipt;
    try {
      receipt = JSON.parse(content.replace(/```json|```/g, "").trim());
    } catch {
      return res.status(500).json({ error: "AI returnerede ikke valid JSON", raw: content });
    }

    const { error: dbError } = await supabase.from("receipts").insert([{
      vendor:         receipt.leverandør      || null,
      date:           receipt.dato            || null,
      amount:         receipt.beløb_inkl_moms || null,
      vat:            receipt.moms            || null,
      vat_rate:       receipt.moms_procent    || null,
      category:       receipt.kategori        || null,
      account:        receipt.konto           || null,
      account_name:   receipt.konto_navn      || null,
      payment_method: receipt.betalingsmetode || null,
      currency:       receipt.valuta          || "DKK",
      image_url:      imageUrl
    }]);

    if (dbError) console.error("Supabase fejl:", dbError);

    return res.status(200).json(receipt);
  } catch (error) {
    console.error("Handler fejl:", error);
    return res.status(500).json({ error: error.toString() });
  }
}
