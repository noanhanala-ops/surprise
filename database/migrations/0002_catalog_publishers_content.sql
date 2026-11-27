-- 0002 — Publisher, Catalog, Content, Storage
CREATE TYPE publisher_status AS ENUM ('PENDING','KYC_REVIEW','ACTIVE','SUSPENDED','TERMINATED');
CREATE TYPE publisher_member_role AS ENUM ('OWNER','EDITOR','FINANCE','VIEWER');
CREATE TYPE edition_status AS ENUM ('DRAFT','IN_REVIEW','APPROVED','PUBLISHED','SUSPENDED','DELISTED');
CREATE TYPE book_format_type AS ENUM ('EPUB','PDF','AUDIOBOOK','COMIC');
CREATE TYPE asset_type AS ENUM ('COVER','PREVIEW','SOURCE_FILE','SAMPLE_AUDIO','AUXILIARY');
CREATE TYPE contribution_type AS ENUM ('AUTHOR','CO_AUTHOR','TRANSLATOR','EDITOR','ILLUSTRATOR','NARRATOR');
CREATE TYPE processing_status AS ENUM ('UPLOADED','SCANNING','VALIDATING','READY','REJECTED','FAILED');
CREATE TYPE territory_permission AS ENUM ('SELL','DENY');

CREATE TABLE publishers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name   text NOT NULL,
  display_name text NOT NULL,
  slug         text NOT NULL UNIQUE,
  country_code country_code NOT NULL,
  tax_id       text,
  status       publisher_status NOT NULL DEFAULT 'PENDING',
  is_individual_author boolean NOT NULL DEFAULT false,   -- autor independente
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER publishers_updated BEFORE UPDATE ON publishers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE publisher_users (
  publisher_id uuid NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         publisher_member_role NOT NULL DEFAULT 'EDITOR',
  PRIMARY KEY (publisher_id, user_id)
);

CREATE TABLE authors (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name      text NOT NULL,
  slug      text NOT NULL UNIQUE,
  biography text,
  user_id   uuid REFERENCES users(id) ON DELETE SET NULL
);

-- Identidade editorial da obra
CREATE TABLE books (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  title       text NOT NULL,
  description text,
  original_language language_code,
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER books_updated BEFORE UPDATE ON books FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX books_title_trgm ON books USING gin (title gin_trgm_ops);

-- Edição concreta (o direito de leitura aponta SEMPRE aqui)
CREATE TABLE book_editions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id        uuid NOT NULL REFERENCES books(id),
  publisher_id   uuid NOT NULL REFERENCES publishers(id),
  isbn           text UNIQUE CHECK (isbn IS NULL OR isbn ~ '^[0-9X-]{10,17}$'),
  edition_number int  NOT NULL DEFAULT 1 CHECK (edition_number > 0),
  language_code  language_code NOT NULL,
  title_override text,
  status         edition_status NOT NULL DEFAULT 'DRAFT',
  published_at   timestamptz,
  delisted_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, publisher_id, edition_number, language_code),
  CONSTRAINT edition_published_has_date CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)
);
CREATE TRIGGER book_editions_updated BEFORE UPDATE ON book_editions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX book_editions_book_idx ON book_editions (book_id);
CREATE INDEX book_editions_publisher_idx ON book_editions (publisher_id);
CREATE INDEX book_editions_public_idx ON book_editions (status, language_code) WHERE status = 'PUBLISHED';

CREATE TABLE book_languages (
  book_id       uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  language_code language_code NOT NULL,
  PRIMARY KEY (book_id, language_code)
);

CREATE TABLE book_authors (
  book_edition_id   uuid NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  author_id         uuid NOT NULL REFERENCES authors(id),
  contribution_type contribution_type NOT NULL DEFAULT 'AUTHOR',
  position          int NOT NULL DEFAULT 0,
  PRIMARY KEY (book_edition_id, author_id, contribution_type)
);
CREATE INDEX book_authors_author_idx ON book_authors (author_id);

CREATE TABLE categories (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES categories(id),
  name      text NOT NULL,
  slug      text NOT NULL UNIQUE
);
CREATE TABLE book_categories (
  book_edition_id uuid NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  category_id     uuid NOT NULL REFERENCES categories(id),
  PRIMARY KEY (book_edition_id, category_id)
);

-- book_assets: capas, previews, material auxiliar. Chaves de objecto em bucket privado.
CREATE TABLE book_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_edition_id uuid NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  asset_type      asset_type NOT NULL,
  storage_key     text NOT NULL UNIQUE,
  mime_type       text NOT NULL,
  size_bytes      bigint NOT NULL CHECK (size_bytes >= 0),
  is_public       boolean NOT NULL DEFAULT false,   -- só capas/previews via CDN
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_only_cover_preview CHECK (NOT is_public OR asset_type IN ('COVER','PREVIEW'))
);
CREATE INDEX book_assets_edition_idx ON book_assets (book_edition_id);

-- book_formats: representação digital da edição; cada formato tem validação/autorização própria
CREATE TABLE book_formats (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_edition_id    uuid NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  format             book_format_type NOT NULL,
  current_version_id uuid,                           -- FK adicionada abaixo
  UNIQUE (book_edition_id, format)
);
CREATE TABLE book_format_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_format_id   uuid NOT NULL REFERENCES book_formats(id) ON DELETE CASCADE,
  version_number   int  NOT NULL CHECK (version_number > 0),
  storage_key      text NOT NULL UNIQUE,
  checksum_sha256  bytea NOT NULL CHECK (octet_length(checksum_sha256) = 32),
  size_bytes       bigint NOT NULL CHECK (size_bytes > 0),
  processing_status processing_status NOT NULL DEFAULT 'UPLOADED',
  rejection_reason text,
  metadata         jsonb NOT NULL DEFAULT '{}',      -- extraído (TOC, páginas, duração...)
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_format_id, version_number),
  CONSTRAINT rejected_has_reason CHECK (processing_status <> 'REJECTED' OR rejection_reason IS NOT NULL)
);
ALTER TABLE book_formats ADD CONSTRAINT book_formats_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES book_format_versions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE content_processing_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  format_version_id uuid NOT NULL REFERENCES book_format_versions(id) ON DELETE CASCADE,
  stage             text NOT NULL CHECK (stage IN ('ANTIVIRUS','VALIDATE','EXTRACT_METADATA','THUMBNAILS','INDEX')),
  status            text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
  attempts          int NOT NULL DEFAULT 0,
  last_error        text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (format_version_id, stage)
);

CREATE TABLE book_prices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_edition_id uuid NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  currency        currency_code NOT NULL,
  amount_minor    money_minor NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  EXCLUDE USING gist (book_edition_id WITH =, currency WITH =,
                      tstzrange(effective_from, effective_to) WITH &&)
);

CREATE TABLE rights_contracts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id    uuid NOT NULL REFERENCES publishers(id),
  book_edition_id uuid NOT NULL REFERENCES book_editions(id),
  start_at        timestamptz NOT NULL,
  end_at          timestamptz,
  commission_bps  int NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),  -- fatia da plataforma
  document_key    text,
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','EXPIRED','TERMINATED')),
  CHECK (end_at IS NULL OR end_at > start_at)
);
CREATE INDEX rights_contracts_edition_idx ON rights_contracts (book_edition_id, status);

CREATE TABLE rights_territories (
  contract_id     uuid NOT NULL REFERENCES rights_contracts(id) ON DELETE CASCADE,
  country_code    text NOT NULL CHECK (country_code = 'WW' OR country_code ~ '^[A-Z]{2}$'),  -- WW = mundo
  permission_type territory_permission NOT NULL,
  PRIMARY KEY (contract_id, country_code)
);

-- AC-04: a edição só é vendável se houver contrato activo, território permitido e sem DENY.
CREATE OR REPLACE FUNCTION edition_sellable_in(p_edition uuid, p_country text, p_at timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM book_editions e
      JOIN rights_contracts c ON c.book_edition_id = e.id AND c.status = 'ACTIVE'
       AND c.start_at <= p_at AND (c.end_at IS NULL OR c.end_at > p_at)
      JOIN rights_territories t ON t.contract_id = c.id
       AND t.permission_type = 'SELL' AND t.country_code IN ('WW', p_country)
     WHERE e.id = p_edition AND e.status = 'PUBLISHED'
       AND NOT EXISTS (SELECT 1 FROM rights_territories d
                        WHERE d.contract_id = c.id AND d.permission_type = 'DENY' AND d.country_code = p_country)
  );
$$;
