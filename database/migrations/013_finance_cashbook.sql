-- Phase 13.1: finance ledger, employee cash collection and cash transfers.
-- Additive migration only. It does not alter or replace invoice_payments.
USE zoicas_osinski;

CREATE TABLE IF NOT EXISTS financial_transactions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    transaction_number VARCHAR(40) NULL,
    transaction_type ENUM('INCOME','EXPENSE') NOT NULL,
    payment_method ENUM('CASH','BANK','CARD','OTHER') NOT NULL,
    customer_id BIGINT UNSIGNED NULL,
    order_id BIGINT UNSIGNED NULL,
    invoice_id BIGINT UNSIGNED NULL,
    invoice_payment_id BIGINT UNSIGNED NULL,
    contract_id BIGINT UNSIGNED NULL,
    employee_id BIGINT UNSIGNED NULL,
    amount DECIMAL(12,2) NOT NULL,
    transaction_date DATE NOT NULL,
    description VARCHAR(500) NOT NULL,
    reference VARCHAR(180) NULL,
    status ENUM('ERFASST','GEPRÜFT','STORNIERT') NOT NULL DEFAULT 'ERFASST',
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_p13_financial_transaction_number (transaction_number),
    UNIQUE KEY uq_p13_financial_invoice_payment (invoice_payment_id),
    KEY idx_p13_financial_date_status (transaction_date, status),
    KEY idx_p13_financial_customer (customer_id, transaction_date),
    KEY idx_p13_financial_order (order_id, transaction_date),
    KEY idx_p13_financial_employee (employee_id, transaction_date),
    CONSTRAINT fk_p13_financial_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    CONSTRAINT fk_p13_financial_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    CONSTRAINT fk_p13_financial_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
    CONSTRAINT fk_p13_financial_invoice_payment FOREIGN KEY (invoice_payment_id) REFERENCES invoice_payments(id) ON DELETE SET NULL,
    CONSTRAINT fk_p13_financial_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL,
    CONSTRAINT fk_p13_financial_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    CONSTRAINT chk_p13_financial_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_cash_payments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    payment_number VARCHAR(40) NULL,
    employee_id BIGINT UNSIGNED NOT NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NOT NULL,
    invoice_id BIGINT UNSIGNED NULL,
    invoice_payment_id BIGINT UNSIGNED NULL,
    amount DECIMAL(12,2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_method ENUM('BAR','BANK','KARTE','SONSTIGE') NOT NULL DEFAULT 'BAR',
    purpose VARCHAR(500) NOT NULL,
    receipt_number VARCHAR(180) NULL,
    receipt_file_id BIGINT UNSIGNED NULL,
    status ENUM('ERFASST','GEPRÜFT','ABGELEHNT','STORNIERT') NOT NULL DEFAULT 'ERFASST',
    customer_email_status ENUM('PENDING','SENT','FAILED','NOT_REQUIRED') NOT NULL DEFAULT 'PENDING',
    customer_email_sent_at DATETIME NULL,
    customer_email_error VARCHAR(500) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_p13_cash_payment_number (payment_number),
    UNIQUE KEY uq_p13_cash_payment_receipt_number (receipt_number),
    UNIQUE KEY uq_p13_cash_payment_invoice_payment (invoice_payment_id),
    KEY idx_p13_cash_employee_date (employee_id, payment_date, status),
    KEY idx_p13_cash_customer_date (customer_id, payment_date),
    KEY idx_p13_cash_order_date (order_id, payment_date),
    KEY idx_p13_cash_duplicate_lookup (employee_id, customer_id, order_id, payment_date, amount),
    CONSTRAINT fk_p13_cash_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p13_cash_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p13_cash_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p13_cash_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
    CONSTRAINT fk_p13_cash_invoice_payment FOREIGN KEY (invoice_payment_id) REFERENCES invoice_payments(id) ON DELETE SET NULL,
    CONSTRAINT chk_p13_cash_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_transfers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    transfer_number VARCHAR(40) NULL,
    employee_id BIGINT UNSIGNED NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    transfer_date DATE NOT NULL,
    received_by_employee_id BIGINT UNSIGNED NULL,
    status ENUM('OFFEN','ÜBERGEBEN','GEPRÜFT','ABGELEHNT') NOT NULL DEFAULT 'OFFEN',
    reference VARCHAR(180) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_p13_cash_transfer_number (transfer_number),
    KEY idx_p13_transfer_employee_date (employee_id, transfer_date, status),
    KEY idx_p13_transfer_received_by (received_by_employee_id, transfer_date),
    CONSTRAINT fk_p13_transfer_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p13_transfer_received_by FOREIGN KEY (received_by_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    CONSTRAINT chk_p13_transfer_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_receipts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    transaction_id BIGINT UNSIGNED NULL,
    employee_cash_payment_id BIGINT UNSIGNED NULL,
    customer_id BIGINT UNSIGNED NULL,
    employee_id BIGINT UNSIGNED NULL,
    file_name VARCHAR(255) NOT NULL,
    stored_file_name CHAR(36) NOT NULL,
    storage_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT UNSIGNED NOT NULL,
    receipt_type ENUM('CUSTOMER_PAYMENT','EXPENSE','CASH_TRANSFER','OTHER') NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_p13_receipt_stored_file (stored_file_name),
    KEY idx_p13_receipt_transaction (transaction_id, created_at),
    KEY idx_p13_receipt_cash_payment (employee_cash_payment_id, created_at),
    KEY idx_p13_receipt_customer (customer_id, created_at),
    KEY idx_p13_receipt_employee (employee_id, created_at),
    CONSTRAINT fk_p13_receipt_transaction FOREIGN KEY (transaction_id) REFERENCES financial_transactions(id) ON DELETE SET NULL,
    CONSTRAINT fk_p13_receipt_cash_payment FOREIGN KEY (employee_cash_payment_id) REFERENCES employee_cash_payments(id) ON DELETE SET NULL,
    CONSTRAINT fk_p13_receipt_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    CONSTRAINT fk_p13_receipt_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    CONSTRAINT chk_p13_receipt_size CHECK (file_size > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- receipt_file_id is an optional convenience reference. financial_receipts
-- remains the authoritative receipt ownership relation and avoids a circular FK.

-- Normalize status enums for installations where an earlier Windows shell
-- import used a non-UTF-8 code page. This is additive/safe for existing rows.
ALTER TABLE financial_transactions MODIFY status ENUM('ERFASST','GEPRUEFT','STORNIERT') NOT NULL DEFAULT 'ERFASST';
ALTER TABLE employee_cash_payments MODIFY status ENUM('ERFASST','GEPRUEFT','ABGELEHNT','STORNIERT') NOT NULL DEFAULT 'ERFASST';
ALTER TABLE cash_transfers MODIFY status ENUM('OFFEN','UEBERGEBEN','GEPRUEFT','ABGELEHNT') NOT NULL DEFAULT 'OFFEN';

GRANT SELECT, INSERT, UPDATE ON zoicas_osinski.employee_cash_payments TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON zoicas_osinski.financial_transactions TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT, INSERT ON zoicas_osinski.cash_transfers TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT, INSERT ON zoicas_osinski.financial_receipts TO 'zoicas_app'@'127.0.0.1';

GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.financial_transactions TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.employee_cash_payments TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.cash_transfers TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.financial_receipts TO 'zoicas_dashboard'@'127.0.0.1';
FLUSH PRIVILEGES;
