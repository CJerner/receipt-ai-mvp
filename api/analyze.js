export default async function handler(req, res) {

if (req.method !== "POST") {
return res.status(405).json({error: "Only POST allowed"});
}

const image = req.body;

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
content: "Du er en dansk bogholder. Find kategori og beløb fra kvitteringstekst."
},
{
role: "user",
content: image
}
]
})
});

const data = await openaiResponse.json();

res.status(200).json({
result: data.choices[0].message.content
});

}
