-- react-matchup/supabase/migrations/elo_level_helpers.sql
-- ============================================================
-- Conversion niveau padel ↔ ELO en SQL (port des ancres de lib/theme.ts).
-- Ancres : (700,1)(850,2)(1000,3)(1200,4)(1400,5)(1650,6)(1950,7)(2300,8).
-- Interpolation linéaire par segment ; clamp aux bornes. IMMUTABLE.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.elo_to_level(p_elo numeric)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  e numeric[] := ARRAY[700,850,1000,1200,1400,1650,1950,2300];
  l numeric[] := ARRAY[1,2,3,4,5,6,7,8];
  i int;
BEGIN
  IF p_elo <= 700 THEN RETURN 1.0; END IF;
  IF p_elo >= 2300 THEN RETURN 8.0; END IF;
  FOR i IN 1..7 LOOP
    IF p_elo >= e[i] AND p_elo < e[i+1] THEN
      RETURN round((l[i] + (p_elo - e[i]) / (e[i+1] - e[i]) * (l[i+1] - l[i]))::numeric, 2);
    END IF;
  END LOOP;
  RETURN 8.0;
END;
$$;

CREATE OR REPLACE FUNCTION public.level_to_elo(p_lvl numeric)
RETURNS int
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  e numeric[] := ARRAY[700,850,1000,1200,1400,1650,1950,2300];
  l numeric[] := ARRAY[1,2,3,4,5,6,7,8];
  i int;
BEGIN
  IF p_lvl <= 1.0 THEN RETURN 700; END IF;
  IF p_lvl >= 8.0 THEN RETURN 2300; END IF;
  FOR i IN 1..7 LOOP
    IF p_lvl >= l[i] AND p_lvl <= l[i+1] THEN
      RETURN round(e[i] + (p_lvl - l[i]) / (l[i+1] - l[i]) * (e[i+1] - e[i]))::int;
    END IF;
  END LOOP;
  RETURN 2300;
END;
$$;

COMMIT;
