-- Phase 10: invoices and payments. Additive only.
USE zoicas_osinski;

CREATE TABLE IF NOT EXISTS invoices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    invoice_number VARCHAR(40) NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NULL,
    sales_quote_id BIGINT UNSIGNED NULL,
    contract_id BIGINT UNSIGNED NULL,
    customer_number_snapshot VARCHAR(40) NULL,
    customer_name_snapshot VARCHAR(180) NOT NULL,
    billing_address_snapshot VARCHAR(180) NULL,
    billing_postal_code_snapshot VARCHAR(16) NULL,
    billing_city_snapshot VARCHAR(120) NULL,
    invoice_date DATE NOT NULL,
    service_period_from DATE NULL,
    service_period_to DATE NULL,
    due_date DATE NOT NULL,
    status ENUM('ENTWURF','AUSGESTELLT','GESENDET','BEZAHLT','TEILBEZAHLT','ÜBERFÄLLIG','STORNIERT') NOT NULL DEFAULT 'ENTWURF',
    net_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    gross_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    outstanding_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_invoices_number (invoice_number),
    UNIQUE KEY uq_invoices_order (order_id),
    KEY idx_invoices_customer_status_due (customer_id, status, due_date),
    KEY idx_invoices_order (order_id),
    KEY idx_invoices_due_status (due_date, status),
    CONSTRAINT fk_p10_invoices_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p10_invoices_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p10_invoices_quote FOREIGN KEY (sales_quote_id) REFERENCES quotes(id) ON DELETE SET NULL,
    CONSTRAINT fk_p10_invoices_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL,
    CONSTRAINT chk_p10_invoice_period CHECK (service_period_from IS NULL OR service_period_to IS NULL OR service_period_from <= service_period_to),
    CONSTRAINT chk_p10_invoice_due CHECK (due_date >= invoice_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    invoice_id BIGINT UNSIGNED NOT NULL,
    sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    title VARCHAR(180) NOT NULL,
    description TEXT NULL,
    quantity DECIMAL(12,2) NOT NULL,
    unit ENUM('Stück','m²','Stunde','Pauschale','Monat','Einsatz') NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    net_amount DECIMAL(12,2) NOT NULL,
    tax_rate DECIMAL(5,2) NOT NULL,
    tax_amount DECIMAL(12,2) NOT NULL,
    gross_amount DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_invoice_items_invoice_order (invoice_id, sort_order, id),
    CONSTRAINT fk_p10_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_payments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    invoice_id BIGINT UNSIGNED NOT NULL,
    payment_date DATE NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    payment_method ENUM('BANKÜBERWEISUNG','BAR','KARTENZAHLUNG','SONSTIGE') NOT NULL,
    payment_reference VARCHAR(180) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_invoice_payments_invoice_date (invoice_id, payment_date, id),
    CONSTRAINT fk_p10_invoice_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
    CONSTRAINT chk_p10_invoice_payment_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

GRANT SELECT ON zoicas_osinski.invoices TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT ON zoicas_osinski.invoice_items TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.invoices TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.invoice_items TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.invoice_payments TO 'zoicas_dashboard'@'127.0.0.1';
FLUSH PRIVILEGES;
