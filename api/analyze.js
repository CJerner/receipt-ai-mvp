import formidable from "formidable";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

export const config = {
  api: { bodyParser: false }
};

// Supabase forbindelse
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {

    // 1. Parse uploadet fil
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
    const [, files] = await form.parse(req);

    const file = files.file?.[0];

    if (!file) {
      return res.status(400).json({ error: "Ingen fil modtaget" });
    }

    // 2. Konverter billede til base64
    const imageBuffer = fs.readFileSync(file.filepath);
    const base64Image = imageBuffer.toString("base64");
    const mimeType = file.mimetype || "image/jpeg";

    // 3. Send billede til OpenAI
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {

      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },

      body: JSON.stringify({

        model: "gpt-4o-mini",

        messages: [
          {
            role: "system",
            content: `Du er en dansk bogholder. Analyser kvitteringsbilledet og returner KUN JSON.

{
  "dato": "YYYY-MM-DD",
  "leverandør": "firmanavn",
  "beløb_inkl_moms": 0.00,
  "moms": 0.00,
  "moms_procent": 25,
  "kategori": "Dagligvarer / Kontorartikler / Transport / Restauration",
  "betalingsmetode": "Kort / Kontant / MobilePay",
  "valuta": "DKK"
}`
          },

          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                  detail: "high"
                }
              },
              {
                type: "text",
                text: "Analyser kvitteringen og returner JSON."
              }
            ]
          }
        ],

        max_tokens: 500

      })
    });

    const data = await openaiResponse.json();

    if (!data.choices) {
      console.error("OpenAI fejl:", data);
      return res.status(500).json({ error: "OpenAI svar fejl", debug: data });
    }

    // 4. AI svar
    const content = data.choices[0].message.content;

    let receipt;

    try {
      receipt = JSON.parse(content);
    } catch {
      return res.status(500).json({
        error: "AI returnerede ikke valid JSON",
        raw: content
      });
    }

    // 5. Gem i Supabase database
    await supabase.from("receipts").insert([

      {
        vendor: receipt.leverandør,
        date: receipt.dato,
        amount: receipt.beløb_inkl_moms,
        vat: receipt.moms,
        vat_rate: receipt.moms_procent,
        category: receipt.kategori,
        payment_method: receipt.betalingsmetode,
        currency: receipt.valuta
      }

    ]);

    // 6. Returner resultat til frontend
    return res.status(200).json(receipt);

  }

  catch (error) {

    console.error("Handler fejl:", error);

    return res.status(500).json({
      error: error.toString()
    });

  }

}