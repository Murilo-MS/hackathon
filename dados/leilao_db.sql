
CREATE EXTENSION IF NOT EXISTS citext;

-- O ENUM limita os valores; as transições são controladas pelo trigger no fim do arquivo
CREATE TYPE auction_status AS ENUM
    ('SCHEDULED', 'ACTIVE', 'SOLD', 'ENDED_NO_BIDS', 'CANCELED');

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name    VARCHAR(100) NOT NULL,
    email           CITEXT NOT NULL UNIQUE,          -- ignora maiúsculas/minúsculas
    password_hash   TEXT NOT NULL,                   -- nunca a senha em texto
    declared_income NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (declared_income >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Item separado do leilão: o mesmo item pode ser relistado depois
CREATE TABLE items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id   UUID NOT NULL REFERENCES users(id),
    name        VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    category    VARCHAR(80) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Só a URL no bucket da nuvem, nunca o arquivo
CREATE TABLE item_photos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    storage_url TEXT NOT NULL,
    position    SMALLINT NOT NULL DEFAULT 1,
    UNIQUE (item_id, position)
);

CREATE TABLE auctions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id        UUID NOT NULL REFERENCES items(id),
    status         auction_status NOT NULL DEFAULT 'SCHEDULED',

    starting_price NUMERIC(12,2) NOT NULL CHECK (starting_price > 0),
    current_price  NUMERIC(12,2) NOT NULL,
    min_next_bid   NUMERIC(12,2) NOT NULL,

    leader_id      UUID REFERENCES users(id),
    winner_id      UUID REFERENCES users(id),
    bid_count      INTEGER NOT NULL DEFAULT 0 CHECK (bid_count >= 0),

    starts_at        TIMESTAMPTZ NOT NULL,
    original_ends_at TIMESTAMPTZ NOT NULL,
    ends_at          TIMESTAMPTZ NOT NULL,   -- muda com a prorrogação
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (original_ends_at > starts_at AND ends_at >= original_ends_at),
    CHECK (current_price >= starting_price AND min_next_bid >= current_price),
    CHECK ((bid_count = 0) = (leader_id IS NULL)),       -- tem líder só se tem lance
    CHECK ((status = 'SOLD') = (winner_id IS NOT NULL)), -- tem vencedor só se vendido
    CHECK (status NOT IN ('SCHEDULED', 'ENDED_NO_BIDS', 'CANCELED') OR bid_count = 0)
);

-- Um item nunca tem dois leilões abertos ao mesmo tempo
CREATE UNIQUE INDEX uq_one_open_auction_per_item
    ON auctions(item_id) WHERE status IN ('SCHEDULED', 'ACTIVE');

CREATE TABLE bids (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id      UUID NOT NULL REFERENCES auctions(id),
    bidder_id       UUID NOT NULL REFERENCES users(id),
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    idempotency_key UUID NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

    UNIQUE (bidder_id, idempotency_key),  -- reenvio/clique duplo não cria 2º lance
    UNIQUE (auction_id, amount)           -- trava extra: nunca dois lances de mesmo valor
);

-- Índices usados pelo worker (abrir/fechar) e pelas telas
CREATE INDEX idx_auctions_status_ends_at   ON auctions(status, ends_at);
CREATE INDEX idx_auctions_status_starts_at ON auctions(status, starts_at);
CREATE INDEX idx_bids_bidder_auction       ON bids(bidder_id, auction_id);
CREATE INDEX idx_items_seller              ON items(seller_id);

-- Máquina de estados: só as 5 transições do edital; estados finais não mudam
CREATE FUNCTION auction_state_guard() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('SOLD', 'ENDED_NO_BIDS', 'CANCELED') THEN
        RAISE EXCEPTION 'Leilão em estado final (%) não pode ser alterado', OLD.status;
    END IF;
    IF NEW.status <> OLD.status AND NOT (
        (OLD.status = 'SCHEDULED' AND NEW.status IN ('ACTIVE', 'CANCELED')) OR
        (OLD.status = 'ACTIVE'    AND NEW.status IN ('SOLD', 'ENDED_NO_BIDS', 'CANCELED'))
    ) THEN
        RAISE EXCEPTION 'Transição inválida: % -> %', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER auction_state_guard
    BEFORE UPDATE ON auctions
    FOR EACH ROW EXECUTE FUNCTION auction_state_guard();