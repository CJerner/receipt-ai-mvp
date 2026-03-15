import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Only GET allowed" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Ikke autoriseret" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return res.status(401).json({ error: "Ugyldig session" });

  const { data: callerData } = await supabase
    .from("company_users")
    .select("role, company_id")
    .eq("user_id", user.id)
    .single();

  if (!callerData || callerData.role !== "admin") {
    return res.status(403).json({ error: "Kun admins kan se brugerliste" });
  }

  // Brug service role til at hente emails
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: companyUsers } = await supabaseAdmin
    .from("company_users")
    .select("user_id, role")
    .eq("company_id", callerData.company_id);

  // Hent emails
  const userIds = companyUsers.map(u => u.user_id);
  const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
  const emailMap = {};
  authUsers.users.forEach(u => { emailMap[u.id] = u.email; });

  const result = companyUsers.map(u => ({
    user_id: u.user_id,
    role: u.role,
    email: emailMap[u.user_id] || 'Ukendt',
    isMe: u.user_id === user.id
  }));

  return res.status(200).json(result);
}
