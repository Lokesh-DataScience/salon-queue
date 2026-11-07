-- step3_register_salon.sql
-- Creates a salon and its OWNER login in ONE transaction. Idempotent: safe to re-run.
CREATE OR REPLACE FUNCTION public.register_salon(
  p_name text, p_phone text, p_address text,
  p_latitude double precision, p_longitude double precision,
  p_opening text, p_closing text, p_avg integer,
  p_owner_name text, p_email text, p_password_hash text
)
RETURNS TABLE(o_salon_id uuid, o_staff_id uuid, o_qr_code text)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_salon uuid;
  v_staff uuid;
  v_qr text;
BEGIN
  IF EXISTS (SELECT 1 FROM salon_staff s WHERE lower(s.email) = lower(p_email)) THEN
    RAISE EXCEPTION 'EMAIL_TAKEN';
  END IF;

  INSERT INTO salons (name, phone, address, latitude, longitude, opening_time, closing_time, average_service_minutes)
  VALUES (p_name, p_phone, p_address, p_latitude, p_longitude, p_opening, p_closing, p_avg)
  RETURNING salons.id, salons.qr_code INTO v_salon, v_qr;

  BEGIN
    INSERT INTO salon_staff (salon_id, name, email, password_hash, role)
    VALUES (v_salon, p_owner_name, lower(p_email), p_password_hash, 'OWNER')
    RETURNING salon_staff.id INTO v_staff;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'EMAIL_TAKEN';  -- two sign-ups racing on the same email
  END;

  RETURN QUERY SELECT v_salon, v_staff, v_qr;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_salon(text, text, text, double precision, double precision, text, text, integer, text, text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_salon(text, text, text, double precision, double precision, text, text, integer, text, text, text)
  TO service_role;