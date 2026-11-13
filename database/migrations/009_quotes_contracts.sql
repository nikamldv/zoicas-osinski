-- Phase 9: commercial quotes and contracts.
-- Additive only: quote_requests remains the public enquiry table from earlier phases.
USE zoicas_osinski;

CREATE TABLE IF NOT EXISTS quotes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    quote_number VARCHAR(40) NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    quote_request_id BIGINT UNSIGNED NULL,
    contact_person VARCHAR(160) NULL,
    service_description TEXT NOT NULL,
    object_address VARCHAR(180) NULL,
    postal_code VARCHAR(16) NULL,
    city VARCHAR(120) NULL,
    service_type VARCHAR(160) NOT NULL,
    area_sqm DECIMAL(10,2) NULL,
    frequency VARCHAR(100) NULL,
    start_date DATE NULL,
    valid_until DATE NULL,
    internal_notes TEXT NULL,
    customer_notes TEXT NULL,
    net_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    gross_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    status ENUM('ENTWURF','GESENDET','ANGENOMMEN','ABGELEHNT','ABGELAUFEN','STORNIERT') NOT NULL DEFAULT 'ENTWURF',
    accepted_at DATETIME NULL,
    accepted_by_customer_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_quotes_number (quote_number),
    KEY idx_quotes_customer_status (customer_id, status, created_at),
    KEY idx_quotes_request (quote_request_id),
    KEY idx_quotes_valid_until (valid_until, status),
    CONSTRAINT fk_p9_quotes_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p9_quotes_request FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id) ON DELETE SET NULL,
    CONSTRAINT fk_p9_quotes_accepted_by FOREIGN KEY (accepted_by_customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quote_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    quote_id BIGINT UNSIGNED NOT NULL,
    sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    title VARCHAR(180) NOT NULL,
    description TEXT NULL,
    quantity DECIMAL(12,2) NOT NULL,
    unit VARCHAR(40) NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    net_amount DECIMAL(12,2) NOT NULL,
    tax_rate DECIMAL(5,2) NOT NULL,
    tax_amount DECIMAL(12,2) NOT NULL,
    gross_amount DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_quote_items_quote_order (quote_id, sort_order, id),
    CONSTRAINT fk_p9_quote_items_quote FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contracts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    contract_number VARCHAR(40) NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    quote_id BIGINT UNSIGNED NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    cancellation_notice_days SMALLINT UNSIGNED NULL,
    cancellation_date DATE NULL,
    termination_date DATE NULL,
    termination_note TEXT NULL,
    service_description TEXT NOT NULL,
    service_type VARCHAR(160) NOT NULL,
    interval_type ENUM('EINMALIG','WOECHENTLICH','ZWEIMAL_WOECHENTLICH','MEHRMALS_WOECHENTLICH','MONATLICH','INDIVIDUELL') NOT NULL DEFAULT 'INDIVIDUELL',
    interval_details VARCHAR(255) NULL,
    net_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    gross_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_interval VARCHAR(80) NULL,
    status ENUM('ENTWURF','AKTIV','PAUSIERT','GEKUENDIGT','ABGELAUFEN','BEENDET') NOT NULL DEFAULT 'ENTWURF',
    internal_notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_contracts_number (contract_number),
    KEY idx_contracts_customer_status (customer_id, status, start_date),
    KEY idx_contracts_quote (quote_id),
    CONSTRAINT fk_p9_contracts_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p9_contracts_quote FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing orders.quote_id keeps its Phase-7 link to quote_requests.  These two
-- nullable columns link the commercial documents without changing historical data.
ALTER TABLE orders
    ADD COLUMN sales_quote_id BIGINT UNSIGNED NULL AFTER quote_id,
    ADD COLUMN contract_id BIGINT UNSIGNED NULL AFTER sales_quote_id,
    ADD COLUMN price_net_snapshot DECIMAL(12,2) NULL AFTER estimated_duration_minutes,
    ADD COLUMN price_tax_snapshot DECIMAL(12,2) NULL AFTER price_net_snapshot,
    ADD COLUMN price_gross_snapshot DECIMAL(12,2) NULL AFTER price_tax_snapshot,
    ADD KEY idx_orders_sales_quote (sales_quote_id),
    ADD KEY idx_orders_contract (contract_id),
    ADD CONSTRAINT fk_p9_orders_sales_quote FOREIGN KEY (sales_quote_id) REFERENCES quotes(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_p9_orders_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL;

-- Customers can read their offers and accept a sent offer through the public app account.
GRANT SELECT, UPDATE ON zoicas_osinski.quotes TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT ON zoicas_osinski.quote_items TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT ON zoicas_osinski.contracts TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.quotes TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.quote_items TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.contracts TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON zoicas_osinski.orders TO 'zoicas_dashboard'@'127.0.0.1';
FLUSH PRIVILEGES;
