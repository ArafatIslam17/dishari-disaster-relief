-- pg_trgm powers duplicate-candidate retrieval (FR18). Must exist before the trigram index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
