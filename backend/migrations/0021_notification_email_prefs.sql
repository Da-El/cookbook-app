-- Iteration 22: per-type email opt-in for notifications. Every notification
-- type has always landed in the bell/Activity tab (in-app is never gated -
-- that's the core feed, not something to accidentally silence) - this is
-- purely about the *additional* email copy, which no type has ever sent
-- until this iteration. Opt-in (missing row = disabled), not opt-out: a
-- user who has never received these emails shouldn't suddenly start
-- getting seven kinds of mail because a preferences table appeared under
-- them.
CREATE TABLE notification_email_prefs (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type    TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, type)
);
