import formidable from "formidable";
import fs from "fs";

export const config = {
  api: { bodyParser: false } // Skal være false når vi modtager filer
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    // 1. Parse den uploadede fil
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 }); // 10MB max
    const [, files] = await form.parse(req);

    const file = files.file?.[0];
    if (!file) {
      return res.status(400).json({ error: "Ingen fil modtaget" });
    }

    // 2. Konverter billede til base64
    const imageBuffer = fs.readFileSync(file.filepath);
    const base64Image = imageBuffer.toString("base64");
    const mimeType = file.mimetype || "image/jpeg";

    // 3. Send til OpenAI med billedet
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Vision-understøttelse + billig
        messages: [
          {
            role: "system",
            content: `Du er en dansk bogholder. Analyser kvitteringsbilledet og returner KUN et JSON-objekt uden markdown eller forklaringer.

JSON skal have disse felter (brug null hvis ikke fundet):
{
  "dato": "YYYY-MM-DD",
  "leverandør": "firmanavn",
  "beløb_inkl_moms": 0.00,
  "moms": 0.00,
  "moms_procent": 25,
  "kategori": "f.eks. Dagligvarer / Kontorartikler / Transport / Restauration",
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
                  detail: "high" // Høj kvalitet til at læse tekst på kvitteringer
                }
              },
              {
                type: "text",
                text: "Analyser denne kvittering og returner JSON."
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

    // 4. Returner JSON-svaret direkte (frontend parser det)
    const content = data.choices[0].message.content;
    return res.status(200).send(content);

  } catch (error) {
    console.error("Handler fejl:", error);
    return res.status(500).json({ error: error.toString() });
  }
}
