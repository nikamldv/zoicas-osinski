-- Phase 5: additive customer portal schema.
USE zoicas_osinski;

CREATE TABLE IF NOT EXISTS customers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    first_name VARCHAR(80) NOT NULL, last_name VARCHAR(80) NOT NULL,
    email VARCHAR(254) NOT NULL, phone VARCHAR(40) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    status ENUM('active','inactive','blocked') NOT NULL DEFAULT 'active',
    address VARCHAR(180) NULL, postal_code VARCHAR(16) NULL, city VARCHAR(120) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP NULL,
    PRIMARY KEY (id), UNIQUE KEY uq_customer_email (email), KEY idx_customer_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nullable links preserve all pre-existing data and allow future public requests to be linked safely.
ALTER TABLE appointments ADD COLUMN portal_customer_id BIGINT UNSIGNED NULL AFTER customer_id;
ALTER TABLE appointments ADD KEY idx_appointments_portal_customer (portal_customer_id);
ALTER TABLE appointments ADD CONSTRAINT fk_appointments_portal_customer FOREIGN KEY (portal_customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE quote_requests ADD COLUMN customer_id BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE quote_requests ADD KEY idx_quotes_customer (customer_id);
ALTER TABLE quote_requests ADD CONSTRAINT fk_quotes_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

-- Run with a MySQL administrator after the migration.
-- GRANT INSERT, SELECT, UPDATE ON zoicas_osinski.customers TO 'zoicas_app'@'127.0.0.1';
-- GRANT SELECT ON zoicas_osinski.appointments TO 'zoicas_app'@'127.0.0.1';
-- GRANT SELECT ON zoicas_osinski.quote_requests TO 'zoicas_app'@'127.0.0.1';
-- GRANT SELECT, UPDATE ON zoicas_osinski.customers TO 'zoicas_dashboard'@'127.0.0.1';
