-- dados de demonstração (RNF04)
-- Todas as contas usam a senha: senha123  (hash bcrypt, custo 10)
-- Horários são relativos ao momento em que o seed roda.

INSERT INTO users (id, display_name, email, password_hash, declared_income) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'Carlos Vendedor', 'carlos@demo.com', '$2b$10$rmFhPYJtb8kcj50wgDyIBOP4Nvr3MNPtlU3xN0tZ2ZefpYfASS8zO', 8000),
 ('a0000000-0000-0000-0000-000000000002', 'Ana Compradora',  'ana@demo.com',    '$2b$10$rmFhPYJtb8kcj50wgDyIBOP4Nvr3MNPtlU3xN0tZ2ZefpYfASS8zO', 12000),
 ('a0000000-0000-0000-0000-000000000003', 'Bruno Vaz',       'bruno@demo.com',  '$2b$10$rmFhPYJtb8kcj50wgDyIBOP4Nvr3MNPtlU3xN0tZ2ZefpYfASS8zO', 3000),
 ('a0000000-0000-0000-0000-000000000004', 'Carla Souza',     'carla@demo.com',  '$2b$10$rmFhPYJtb8kcj50wgDyIBOP4Nvr3MNPtlU3xN0tZ2ZefpYfASS8zO', 20000);

INSERT INTO items (id, seller_id, name, description, category) VALUES
 ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Notebook Dell Inspiron', 'Notebook usado, 16GB de RAM, SSD 512GB.', 'Eletrônicos'),
 ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Bicicleta Caloi 29',     'Aro 29, 21 marchas, pouco uso.',          'Esportes'),
 ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Relógio de pulso antigo', 'Relógio mecânico dos anos 80.',             'Acessórios'),
 ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Coleção de livros',       'Box com 10 livros de ficção.',            'Livros'),
 ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Cadeira gamer',           'Cadeira reclinável com apoio lombar.',    'Móveis');

-- 3 fotos por item (URLs de exemplo; troque pelas URLs do bucket da nuvem)
INSERT INTO item_photos (item_id, storage_url, position)
SELECT i.id, 'https://picsum.photos/seed/' || i.id || '-' || n || '/800/600', n
FROM items i CROSS JOIN generate_series(1, 3) AS n;

-- Agendado: começa em 1 dia
INSERT INTO auctions (id, item_id, status, starting_price, current_price, min_next_bid, starts_at, original_ends_at, ends_at) VALUES
 ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'SCHEDULED',
  300, 300, 300, now() + interval '1 day', now() + interval '1 day 1 hour', now() + interval '1 day 1 hour');

-- Em andamento: começou há 1h, termina em 1h, com 2 lances (100 -> 105, próximo mínimo 110)
INSERT INTO auctions (id, item_id, status, starting_price, current_price, min_next_bid, leader_id, bid_count, starts_at, original_ends_at, ends_at) VALUES
 ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'ACTIVE',
  100, 105, 110, 'a0000000-0000-0000-0000-000000000003', 2,
  now() - interval '1 hour', now() + interval '1 hour', now() + interval '1 hour');
INSERT INTO bids (auction_id, bidder_id, amount, idempotency_key, created_at) VALUES
 ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 100, gen_random_uuid(), now() - interval '30 minutes'),
 ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 105, gen_random_uuid(), now() - interval '10 minutes');

-- Vendido: terminou ontem, 3 lances, vencedor Carla
INSERT INTO auctions (id, item_id, status, starting_price, current_price, min_next_bid, leader_id, winner_id, bid_count, starts_at, original_ends_at, ends_at) VALUES
 ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'SOLD',
  500, 520, 530, 'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 3,
  now() - interval '2 days', now() - interval '1 day', now() - interval '1 day');
INSERT INTO bids (auction_id, bidder_id, amount, idempotency_key, created_at) VALUES
 ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 500, gen_random_uuid(), now() - interval '40 hours'),
 ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 510, gen_random_uuid(), now() - interval '30 hours'),
 ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004', 520, gen_random_uuid(), now() - interval '25 hours');

-- Encerrado sem lances
INSERT INTO auctions (id, item_id, status, starting_price, current_price, min_next_bid, starts_at, original_ends_at, ends_at) VALUES
 ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'ENDED_NO_BIDS',
  50, 50, 50, now() - interval '3 days', now() - interval '2 days', now() - interval '2 days');

-- Cancelado pelo comitente (sem lances)
INSERT INTO auctions (id, item_id, status, starting_price, current_price, min_next_bid, starts_at, original_ends_at, ends_at) VALUES
 ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000005', 'CANCELED',
  200, 200, 200, now() + interval '2 days', now() + interval '2 days 1 hour', now() + interval '2 days 1 hour');