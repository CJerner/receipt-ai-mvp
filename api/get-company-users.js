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

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: companyUsers } = await supabaseAdmin
    .from("company_users")
    .select("user_id, role")
    .eq("company_id", callerData.company_id);

  // Hent kun de specifikke brugere én ad gangen — hurtigere end listUsers()
  const result = await Promise.all(
    companyUsers.map(async cu => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(cu.user_id);
      return {
        user_id: cu.user_id,
        role: cu.role,
        email: data?.user?.email || 'Ukendt',
        isMe: cu.user_id === user.id
      };
    })
  );

  return res.status(200).json(result);
}
