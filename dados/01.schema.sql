-- 1. Tipos personalizados (ENUMs) para impedir estados inválidos no banco (RN01)
CREATE TYPE auction_status AS ENUM (
    'SCHEDULED',      -- Agendado
    'ACTIVE',         -- Em andamento
    'SOLD',           -- Vendido (término com lances)
    'ENDED_NO_BIDS',  -- Encerrado sem lances
    'CANCELED'        -- Cancelado pelo comitente
);

-- 2. Tabela de Usuários (RF01, RF03, RF29)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE, -- Garante 1 conta por e-mail (RF01)
    password_hash TEXT NOT NULL,        -- Apenas o hash bcrypt/argon2, nunca texto puro
    declared_income NUMERIC(12, 2) DEFAULT 0.00, -- Para cálculo de pontuação/crédito (Bônus RF29)
    is_seller_enabled BOOLEAN NOT NULL DEFAULT TRUE, -- TRUE no Núcleo (RF03); vira FALSE por padrão se fizer Bônus RF30
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabela de Itens (Separada do leilão para permitir relistagem no RF28)
CREATE TABLE items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Tabela de Fotos do Item (RF05 e RF07 - apenas URLs do bucket da nuvem)
CREATE TABLE item_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    storage_url TEXT NOT NULL,
    position SMALLINT NOT NULL DEFAULT 1,
    CONSTRAINT unique_photo_position UNIQUE (item_id, position)
);

-- 5. Tabela de Leilões (RF05, RN01, RF14, RF15, RF19)
CREATE TABLE auctions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    status auction_status NOT NULL DEFAULT 'SCHEDULED',
    
    -- Valores monetários exatos sem arredondamento (RF19)
    starting_price NUMERIC(12, 2) NOT NULL CHECK (starting_price > 0),
    current_price NUMERIC(12, 2) NOT NULL CHECK (current_price >= starting_price),
    min_next_bid NUMERIC(12, 2) NOT NULL CHECK (min_next_bid >= starting_price),
    
    -- Controle de liderança e contagem rápida
    leader_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    winner_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    bid_count INTEGER NOT NULL DEFAULT 0 CHECK (bid_count >= 0),
    
    -- Controle temporal em UTC (RF15, RF16, RF19)
    starts_at TIMESTAMPTZ NOT NULL,
    original_ends_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Garante que o leilão não termina antes de começar
    CONSTRAINT valid_auction_window CHECK (original_ends_at > starts_at AND ends_at >= original_ends_at)
);

-- 6. Tabela de Lances (RF10, RF11, RF12)
CREATE TABLE bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE RESTRICT,
    bidder_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    
    -- Chave única gerada pelo front-end para evitar clique duplo/reenvio (RF12)
    idempotency_key UUID NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para acelerar as consultas críticas do sistema e do worker de tempo
CREATE INDEX idx_auctions_status_ends_at ON auctions(status, ends_at);
CREATE INDEX idx_auctions_status_starts_at ON auctions(status, starts_at);
CREATE INDEX idx_bids_auction_created ON bids(auction_id, created_at DESC);
CREATE INDEX idx_bids_bidder ON bids(bidder_id);