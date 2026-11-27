-- 0004 — Reading: progresso versionado, marcadores, destaques, anotações
CREATE TABLE reading_progress (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edition_id       uuid NOT NULL REFERENCES book_editions(id),
  locator_json     jsonb NOT NULL,                    -- Readium Locator
  progress_percent numeric(5,2) NOT NULL CHECK (progress_percent BETWEEN 0 AND 100),
  version          bigint NOT NULL DEFAULT 1,         -- compare-and-set: evita sobrescrita silenciosa
  last_device_id   uuid REFERENCES user_devices(id) ON DELETE SET NULL,
  client_updated_at timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, edition_id)
);
-- Actualização: UPDATE ... SET version = version+1 WHERE user_id=? AND edition_id=? AND version = :base_version

CREATE TABLE reading_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edition_id uuid NOT NULL REFERENCES book_editions(id),
  device_id  uuid REFERENCES user_devices(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX reading_sessions_user_idx ON reading_sessions (user_id, started_at DESC);

CREATE TABLE bookmarks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edition_id   uuid NOT NULL REFERENCES book_editions(id),
  locator_json jsonb NOT NULL,
  title        text,
  version      bigint NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz                            -- soft delete para sincronização
);
CREATE INDEX bookmarks_user_edition_idx ON bookmarks (user_id, edition_id) WHERE deleted_at IS NULL;

CREATE TABLE highlights (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edition_id    uuid NOT NULL REFERENCES book_editions(id),
  locator_json  jsonb NOT NULL,
  selected_text text NOT NULL,
  color         text,
  version       bigint NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX highlights_user_edition_idx ON highlights (user_id, edition_id) WHERE deleted_at IS NULL;

CREATE TABLE annotations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  highlight_id uuid NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
  content      text NOT NULL,
  version      bigint NOT NULL DEFAULT 1,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE reading_preferences (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  font_family  text,
  font_size    int CHECK (font_size BETWEEN 8 AND 72),
  theme        text CHECK (theme IN ('LIGHT','DARK','SEPIA','AUTO')),
  line_spacing numeric(3,2),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reading_lists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  visibility text NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE','UNLISTED','PUBLIC'))
);
CREATE TABLE reading_list_items (
  list_id    uuid NOT NULL REFERENCES reading_lists(id) ON DELETE CASCADE,
  edition_id uuid NOT NULL REFERENCES book_editions(id),
  position   int NOT NULL DEFAULT 0,
  PRIMARY KEY (list_id, edition_id)
);
