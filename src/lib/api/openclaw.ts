import { supabase } from "@/integrations/supabase/client";

export async function searchOpenClaw(message: string, agent = "main") {
  const { data, error } = await supabase.functions.invoke("openclaw-search", {
    body: { message, agent },
  });

  if (error) {
    throw new Error(error.message || "Failed to call OpenClaw");
  }

  if (!data?.success) {
    throw new Error(data?.error || "OpenClaw search failed");
  }

  return data.reply as string;
}
