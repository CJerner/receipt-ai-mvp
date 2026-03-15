import { createClient } from "@supabase/supabase-js";

function getSupabase(token) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

function getAdmin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Ikke autoriseret" });

  const supabase = getSupabase(token);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return res.status(401).json({ error: "Ugyldig session" });

  if (req.method === "GET") {
    const { action } = req.query;

    // Hent alle firmaer brugeren tilhører
    if (action === "all") {
      const { data, error } = await supabase
        .from("company_users")
        .select("role, companies(id, name, auto_approve)")
        .eq("user_id", user.id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data.map(d => ({
        company: d.companies,
        role: d.role
      })));
    }

    // Hent brugerliste for specifikt firma (kun admin)
    if (action === "users") {
      const { company_id } = req.query;
      const { data: callerData } = await supabase
        .from("company_users")
        .select("role, company_id")
        .eq("user_id", user.id)
        .eq("company_id", company_id || "")
        .single();

      // Fallback til første firma hvis company_id ikke angivet
      const { data: anyCallerData } = !callerData ? await supabase
        .from("company_users").select("role, company_id").eq("user_id", user.id).single()
        : { data: callerData };

      const effectiveCaller = callerData || anyCallerData;
      if (!effectiveCaller || effectiveCaller.role !== "admin")
        return res.status(403).json({ error: "Kun admins kan se brugerliste" });

      const supabaseAdmin = getAdmin();
      const { data: companyUsers } = await supabaseAdmin
        .from("company_users").select("user_id, role").eq("company_id", effectiveCaller.company_id);

      const result = await Promise.all(
        companyUsers.map(async cu => {
          const { data } = await supabaseAdmin.auth.admin.getUserById(cu.user_id);
          return { user_id: cu.user_id, role: cu.role, email: data?.user?.email || 'Ukendt', isMe: cu.user_id === user.id };
        })
      );
      return res.status(200).json(result);
    }

    // Hent aktivt firma og rolle (med company_id query param)
    const { company_id } = req.query;
    let query = supabase.from("company_users").select("role, companies(id, name, auto_approve)").eq("user_id", user.id);
    if (company_id) query = query.eq("company_id", company_id);
    else query = query.limit(1);

    const { data, error } = await query.single();
    if (error || !data) return res.status(200).json({ company: null, role: null });
    return res.status(200).json({ company: data.companies, role: data.role });
  }

  if (req.method === "POST") {
    const { action } = req.body;

    // Opret firma
    if (action === "create") {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: "Firmanavn er påkrævet" });
      const { data: company, error: companyError } = await supabase
        .from("companies").insert([{ name }]).select().single();
      if (companyError) return res.status(500).json({ error: companyError.message });
      const { error: userError } = await supabase
        .from("company_users").insert([{ company_id: company.id, user_id: user.id, role: "admin" }]);
      if (userError) return res.status(500).json({ error: userError.message });
      return res.status(200).json({ company });
    }

    // Inviter bruger
    if (action === "invite") {
      const { company_id } = req.body;
      const { data: callerData } = await supabase
        .from("company_users").select("role, company_id")
        .eq("user_id", user.id)
        .eq("company_id", company_id)
        .single();
      if (!callerData || callerData.role !== "admin")
        return res.status(403).json({ error: "Kun admins kan invitere brugere" });

      const { email, role = "member" } = req.body;
      if (!email) return res.status(400).json({ error: "Email er påkrævet" });

      const supabaseAdmin = getAdmin();
      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { invited_by: user.id, company_id: callerData.company_id }
      });
      if (inviteError) return res.status(500).json({ error: inviteError.message });

      const { error: linkError } = await supabaseAdmin
        .from("company_users").insert([{ company_id: callerData.company_id, user_id: inviteData.user.id, role }]);
      if (linkError) return res.status(500).json({ error: linkError.message });
      return res.status(200).json({ success: true, email });
    }

    // Opdater rolle
    if (action === "update-role") {
      const { company_id } = req.body;
      const { data: callerData } = await supabase
        .from("company_users").select("role, company_id")
        .eq("user_id", user.id)
        .eq("company_id", company_id)
        .single();
      if (!callerData || callerData.role !== "admin")
        return res.status(403).json({ error: "Kun admins kan ændre roller" });

      const { userId, role } = req.body;
      if (!userId || !role) return res.status(400).json({ error: "userId og role er påkrævet" });
      if (!["admin", "member"].includes(role)) return res.status(400).json({ error: "Ugyldig rolle" });
      if (userId === user.id) return res.status(400).json({ error: "Du kan ikke ændre din egen rolle" });

      const { error } = await supabase.from("company_users")
        .update({ role }).eq("user_id", userId).eq("company_id", callerData.company_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    // Opdater auto-godkend
    if (action === "update-settings") {
      const { company_id, auto_approve } = req.body;
      const { data: callerData } = await supabase
        .from("company_users").select("role")
        .eq("user_id", user.id)
        .eq("company_id", company_id)
        .single();
      if (!callerData || callerData.role !== "admin")
        return res.status(403).json({ error: "Kun admins kan ændre indstillinger" });

      const { error } = await supabase
        .from("companies").update({ auto_approve }).eq("id", company_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Ukendt action" });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
