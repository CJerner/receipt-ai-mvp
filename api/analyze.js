export default async function handler(req, res) {

if (req.method !== "POST") {
  return res.status(405).json({ error: "Only POST allowed" });
}

try {

  const receiptText = "Netto Kvittering Total 89.50 DKK";

  const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "Du er en dansk bogholder. Find kategori og beløb fra kvittering."
        },
        {
          role: "user",
          content: receiptText
        }
      ]
    })
  });

  const data = await openaiResponse.json();

  // Hvis OpenAI giver fejl
  if (!data.choices) {
    return res.status(200).json({
      error: "OpenAI svar fejl",
      debug: data
    });
  }

  return res.status(200).json({
    result: data.choices[0].message.content
  });

} catch (error) {

  return res.status(500).json({
    error: error.toString()
  });

}

}