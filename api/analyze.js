export default async function handler(req, res) {

if (req.method !== "POST") {
return res.status(405).json({ error: "Only POST allowed" });
}

try {

return res.status(200).json({
result: "Backend virker. AI analyse kommer snart."
});

} catch (error) {

return res.status(500).json({
error: "Server error"
});

}

}