-- Unique OAuth state hashes so two in-flight connects cannot share a nonce.
-- Lookups already filter by owner and provider; uniqueness is defense in depth.

create unique index if not exists oauth_states_state_hash_uidx
  on public.oauth_states (state_hash);
