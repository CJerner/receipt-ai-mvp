import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
process.env.SUPABASE_URL,
process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {

try {

const { data, error } = await supabase
.from("receipts")
.select("*")
.order("date", { ascending: false });

if (error) {
return res.status(500).json(error);
}

return res.status(200).json(data);

}

catch (error) {

return res.status(500).json({
error: error.toString()
});

}

}
