-- Phase 4: additive online appointment booking migration.
-- Booking hours are configured in the application environment, not stored as assumed company hours.
USE zoicas_osinski;

CREATE TABLE IF NOT EXISTS appointment_customers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    first_name VARCHAR(80) NOT NULL,
    last_name VARCHAR(80) NOT NULL,
    email VARCHAR(254) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id), KEY idx_appointment_customer_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    customer_id BIGINT UNSIGNED NOT NULL,
    service VARCHAR(100) NOT NULL, object_type VARCHAR(40) NOT NULL,
    address VARCHAR(180) NOT NULL, postal_code VARCHAR(16) NOT NULL, city VARCHAR(120) NOT NULL,
    area_m2 SMALLINT UNSIGNED NULL, preferred_date DATE NOT NULL,
    start_time TIME NOT NULL, end_time TIME NOT NULL, duration_minutes SMALLINT UNSIGNED NOT NULL,
    message TEXT NULL,
    status ENUM('pending', 'confirmed', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_appointment_slot (preferred_date, start_time),
    KEY idx_appointment_date_status (preferred_date, status), KEY idx_appointment_customer (customer_id),
    CONSTRAINT fk_appointment_customer FOREIGN KEY (customer_id) REFERENCES appointment_customers(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Run with a MySQL administrator after the migration.
-- GRANT INSERT, SELECT ON zoicas_osinski.appointment_customers TO 'zoicas_app'@'127.0.0.1';
-- GRANT INSERT, SELECT ON zoicas_osinski.appointments TO 'zoicas_app'@'127.0.0.1';
-- GRANT SELECT ON zoicas_osinski.appointment_customers TO 'zoicas_dashboard'@'127.0.0.1';
-- GRANT SELECT, UPDATE ON zoicas_osinski.appointments TO 'zoicas_dashboard'@'127.0.0.1';
