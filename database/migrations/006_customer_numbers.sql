-- Phase 5 follow-up: immutable customer numbers for existing and future portal accounts.
USE zoicas_osinski;

ALTER TABLE customers ADD COLUMN customer_number VARCHAR(40) NULL AFTER id;

-- Existing customers receive deterministic, human-readable numbers.
UPDATE customers
SET customer_number = CONCAT('KU-', YEAR(created_at), '-', LPAD(id, 6, '0'))
WHERE customer_number IS NULL OR customer_number = '';

ALTER TABLE customers MODIFY customer_number VARCHAR(40) NOT NULL;
ALTER TABLE customers ADD UNIQUE KEY uq_customer_number (customer_number);
