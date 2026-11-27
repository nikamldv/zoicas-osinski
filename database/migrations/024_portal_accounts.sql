-- Select and verify the intended database before applying.
ALTER TABLE employees ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE customers
    MODIFY email VARCHAR(254) NULL,
    MODIFY password_hash VARCHAR(255) NULL,
    ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN customer_type ENUM('PRIVATE','BUSINESS') NOT NULL DEFAULT 'PRIVATE',
    ADD COLUMN company_name VARCHAR(180) NULL,
    ADD COLUMN contact_name VARCHAR(160) NULL,
    ADD COLUMN billing_address VARCHAR(180) NULL,
    ADD COLUMN billing_postal_code VARCHAR(16) NULL,
    ADD COLUMN billing_city VARCHAR(120) NULL,
    ADD COLUMN internal_notes TEXT NULL,
    ADD COLUMN registration_key CHAR(36) NULL,
    ADD UNIQUE KEY uq_customer_registration_key (registration_key);
CREATE TABLE customer_portal_invitations (
    customer_id BIGINT UNSIGNED PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    session_version INT UNSIGNED NOT NULL,
    CONSTRAINT fk_customer_portal_invitation FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB;
