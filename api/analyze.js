import formidable from "formidable";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

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

    // Send til OpenAI med optimeret prompt til håndværkere
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Du er en erfaren dansk bogholder specialiseret i håndværks- og servicevirksomheder.
Analyser kvitteringen/fakturaen grundigt og returner KUN et JSON objekt - ingen markdown, ingen forklaringer.

REGLER:
- Beløb skal altid være tal (ikke strenge). Brug punktum som decimaltegn internt men returner som tal.
- Moms er typisk 25% i Danmark. Beregn: moms = beløb_inkl_moms / 1.25 * 0.25
- Dato format: YYYY-MM-DD. Hvis kun måned/år, brug den 1. i måneden.
- Leverandør: firmanavn uden CVR/adresse
- Vælg kategori fra denne liste: Materialer, Værktøj, Brændstof, Bil og transport, Arbejdstøj og sikkerhed, Kontor og administration, Telefon og internet, Forsikring, Husleje og lokaler, Restauration og forplejning, Reparation og vedligehold, El og energi, Underleverandør, Andet

DEBET KONTOPLAN (omkostningskonto):
  * Materialer/Varekøb = 1410 "Varekøb"
  * Småanskaffelser/Værktøj under 13.800 kr = 2820 "Småanskaffelser"
  * Større værktøj/maskiner = 1420 "Maskiner og inventar"
  * Brændstof = 2230 "Brændstof"
  * Bil/transport = 2220 "Bilomkostninger"
  * Arbejdstøj = 2840 "Arbejdstøj"
  * Kontor/papir = 2860 "Kontorartikler"
  * Telefon/internet = 2870 "Telefon og internet"
  * Forsikring = 2910 "Forsikringer"
  * Husleje/lokaler = 2050 "Husleje"
  * Restauration/forplejning = 2690 "Repræsentation"
  * Reparation = 2290 "Reparation og vedligehold"
  * Underleverandør = 1480 "Fremmed arbejde"
  * El/vand/varme = 2060 "El, vand og varme"
  * Andet = 2900 "Diverse omkostninger"

KREDIT KONTOPLAN (modkonto — baseret på betalingsmetode):
  * Kort/Dankort/Visa = 5810 "Bank"
  * Kontant = 5820 "Kassekonto"
  * MobilePay = 5810 "Bank"
  * Faktura/ikke betalt endnu = 6010 "Leverandørgæld"
  * Ukendt = 6010 "Leverandørgæld"

- Betalingsmetode: Kort, Kontant, MobilePay, Faktura, Ukendt

Returner præcis dette JSON format:
{
  "dato": "YYYY-MM-DD",
  "leverandør": "firmanavn",
  "beløb_inkl_moms": 0.00,
  "moms": 0.00,
  "moms_procent": 25,
  "kategori": "fra listen ovenfor",
  "konto_debet": "4-cifret nummer",
  "konto_debet_navn": "kontonavn",
  "konto_kredit": "4-cifret nummer",
  "konto_kredit_navn": "kontonavn",
  "betalingsmetode": "Kort/Kontant/MobilePay/Faktura/Ukendt",
  "valuta": "DKK",
  "beskrivelse": "kort beskrivelse af hvad der er købt"
}`
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: "high" } },
              { type: "text", text: "Analyser og returner JSON. Hvis noget er ulæseligt, brug null." }
            ]
          }
        ],
        max_tokens: 600,
        temperature: 0.1
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

    // Hent brugerens firma
    const { data: companyUser } = await supabase
      .from("company_users")
      .select("company_id")
      .eq("user_id", user.id)
      .single();

    // Hent auto_approve separat
    let autoApprove = false;
    if (companyUser?.company_id) {
      const { data: companyData } = await supabase
        .from("companies")
        .select("auto_approve")
        .eq("id", companyUser.company_id)
        .single();
      autoApprove = companyData?.auto_approve || false;
    }

    const status = autoApprove ? "approved" : "pending";

    const { error: dbError } = await supabase.from("receipts").insert([{
      user_id:            user.id,
      company_id:         companyUser?.company_id || null,
      status:             status,
      vendor:             receipt.leverandør        || null,
      date:               receipt.dato              || null,
      amount:             receipt.beløb_inkl_moms   || null,
      vat:                receipt.moms              || null,
      vat_rate:           receipt.moms_procent      || null,
      category:           receipt.kategori          || null,
      account:            receipt.konto_debet       || null,
      account_name:       receipt.konto_debet_navn  || null,
      account_debet:      receipt.konto_debet       || null,
      account_debet_name: receipt.konto_debet_navn  || null,
      account_kredit:     receipt.konto_kredit      || null,
      account_kredit_name:receipt.konto_kredit_navn || null,
      payment_method:     receipt.betalingsmetode   || null,
      currency:           receipt.valuta            || "DKK",
      image_url:          imageUrl,
      description:        receipt.beskrivelse       || null
    }]);

    if (dbError) console.error("Supabase fejl:", dbError);

    return res.status(200).json(receipt);
  } catch (error) {
    console.error("Handler fejl:", error);
    return res.status(500).json({ error: error.toString() });
  }
}
