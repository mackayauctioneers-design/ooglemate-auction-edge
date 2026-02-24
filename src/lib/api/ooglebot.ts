import { supabase } from "@/integrations/supabase/client";

export async function searchOogleBot(message: string, agent = "main") {
  const { data, error } = await supabase.functions.invoke("ooglebot", {
    body: { message, agent },
  });

  if (error) {
    throw new Error(error.message || "Failed to call OogleBot");
  }

  if (!data?.success) {
    throw new Error(data?.error || "OogleBot search failed");
  }

  return data.reply as string;
}
