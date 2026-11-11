-- Phase 3: additive migration. Existing tables and data are not changed.
USE zoicas_osinski;

CREATE TABLE IF NOT EXISTS quote_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    first_name VARCHAR(80) NOT NULL,
    last_name VARCHAR(80) NOT NULL,
    company VARCHAR(160) NULL,
    email VARCHAR(254) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    object_type VARCHAR(40) NOT NULL,
    address VARCHAR(180) NOT NULL,
    postal_code VARCHAR(16) NOT NULL,
    city VARCHAR(120) NOT NULL,
    requested_service VARCHAR(100) NOT NULL,
    area_m2 SMALLINT UNSIGNED NULL,
    frequency VARCHAR(80) NULL,
    preferred_period VARCHAR(120) NULL,
    preferred_date DATE NULL,
    message TEXT NULL,
    additional_information TEXT NULL,
    status ENUM('new', 'in_progress', 'offer_sent', 'accepted', 'declined', 'completed') NOT NULL DEFAULT 'new',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_quote_created_at (created_at),
    KEY idx_quote_status (status),
    KEY idx_quote_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quote_request_files (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    quote_request_id BIGINT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name CHAR(36) NOT NULL,
    mime_type ENUM('image/jpeg', 'image/png', 'application/pdf') NOT NULL,
    size_bytes INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_quote_file_stored_name (stored_name),
    KEY idx_quote_file_request (quote_request_id),
    CONSTRAINT fk_quote_file_request
        FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Run with a MySQL administrator after the migration.
-- GRANT INSERT ON zoicas_osinski.quote_requests TO 'zoicas_app'@'127.0.0.1';
-- GRANT INSERT ON zoicas_osinski.quote_request_files TO 'zoicas_app'@'127.0.0.1';
-- GRANT SELECT, UPDATE ON zoicas_osinski.quote_requests TO 'zoicas_dashboard'@'127.0.0.1';
-- GRANT SELECT ON zoicas_osinski.quote_request_files TO 'zoicas_dashboard'@'127.0.0.1';
