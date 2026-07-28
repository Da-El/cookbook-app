-- Iteration 11: the reputation-weight system (migration 0007) has quietly
-- decided how much every vote counts since Batch 1, but nobody could ever
-- see it - "weight never exposed to clients" was the right call for the raw
-- multiplier (a visible number invites gaming), but the same three tiers
-- make a fine badge once collapsed to a label instead of a number.
--
-- Deliberately a thin wrapper around reputation_weight() rather than a
-- second count query: the badge a person sees is guaranteed to match the
-- influence their votes actually carry, because it's computed from the
-- exact same function.
CREATE FUNCTION contributor_tier(uid BIGINT) RETURNS TEXT AS $$
    SELECT CASE reputation_weight(uid)
        WHEN 3 THEN 'veteran'
        WHEN 2 THEN 'trusted'
        ELSE 'novice'
    END
$$ LANGUAGE SQL STABLE;
