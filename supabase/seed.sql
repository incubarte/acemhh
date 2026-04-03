-- Seed user for local development (matches DEV_AUTH_ID in .env.local)
INSERT INTO users (id, username, first_name, last_name)
VALUES
    (45669763, 'Migralito', 'Alejandro', null),
    (40541227, 'DiegoBerko', 'Diego', 'Berko'),
    (6885365547, null, 'Fran', null)
ON CONFLICT (id) DO NOTHING;
