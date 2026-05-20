-- Relax the team_side uniqueness constraint to accepted players only.
-- Pending players store their preferred side without blocking the slot.
-- The side is assigned (or reassigned if taken) at acceptance time.
DROP INDEX IF EXISTS idx_game_participants_game_side;

CREATE UNIQUE INDEX idx_game_participants_game_side
  ON game_participants (game_id, team_side)
  WHERE team_side IS NOT NULL AND status = 'accepted';
