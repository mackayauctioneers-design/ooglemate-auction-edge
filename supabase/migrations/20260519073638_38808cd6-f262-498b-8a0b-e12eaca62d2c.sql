
CREATE OR REPLACE FUNCTION public.notify_operator_on_new_dealer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fn_url text := 'https://xznchxsbuwngfmwvsvhq.supabase.co/functions/v1/notify-operator-signup';
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bmNoeHNidXduZ2Ztd3ZzdmhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwNzY4NzIsImV4cCI6MjA4MjY1Mjg3Mn0.EAtZMU4QRmk00Gomr7R25LR0OyJqZtMQA9ZK-7M19hM';
BEGIN
  PERFORM net.http_post(
    url := fn_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body := jsonb_build_object(
      'dealer_profile_id', NEW.id,
      'dealer_name', NEW.dealer_name,
      'dealer_email', NEW.dealer_email,
      'dealer_website', NEW.dealer_website
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block signup if the notifier fails
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_operator_on_new_dealer ON public.dealer_profiles;
CREATE TRIGGER trg_notify_operator_on_new_dealer
AFTER INSERT ON public.dealer_profiles
FOR EACH ROW
EXECUTE FUNCTION public.notify_operator_on_new_dealer();
