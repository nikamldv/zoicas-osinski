-- Phase 7: additive order management and scheduling schema.
-- Execute once as a MySQL administrator after the pre-order backup has been created.
USE zoicas_osinski;

CREATE TABLE IF NOT EXISTS orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_number VARCHAR(40) NOT NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    appointment_id BIGINT UNSIGNED NULL,
    quote_id BIGINT UNSIGNED NULL,
    service_type VARCHAR(160) NOT NULL,
    title VARCHAR(180) NOT NULL,
    description TEXT NULL,
    object_type VARCHAR(120) NULL,
    area_sqm DECIMAL(10,2) NULL,
    frequency VARCHAR(80) NULL,
    address VARCHAR(180) NULL,
    postal_code VARCHAR(16) NULL,
    city VARCHAR(120) NULL,
    preferred_date DATE NULL,
    status ENUM('NEU','GEPLANT','ZUGEWIESEN','IN_BEARBEITUNG','PAUSIERT','ERLEDIGT','STORNIERT') NOT NULL DEFAULT 'NEU',
    priority ENUM('NORMAL','HOCH','DRINGEND') NOT NULL DEFAULT 'NORMAL',
    estimated_duration_minutes SMALLINT UNSIGNED NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_orders_number (order_number),
    KEY idx_orders_customer_status (customer_id, status, preferred_date),
    KEY idx_orders_appointment (appointment_id),
    KEY idx_orders_quote (quote_id),
    CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_orders_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
    CONSTRAINT fk_orders_quote FOREIGN KEY (quote_id) REFERENCES quote_requests(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_assignments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id BIGINT UNSIGNED NOT NULL,
    employee_id BIGINT UNSIGNED NOT NULL,
    assignment_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status ENUM('GEPLANT','IN_BEARBEITUNG','ERLEDIGT','STORNIERT') NOT NULL DEFAULT 'GEPLANT',
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_assignment_employee_slot (employee_id, assignment_date, start_time, end_time),
    KEY idx_assignments_order (order_id, assignment_date),
    KEY idx_assignments_employee_date (employee_id, assignment_date, start_time),
    CONSTRAINT fk_assignments_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_assignments_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE employee_work_logs ADD COLUMN order_id BIGINT UNSIGNED NULL AFTER task_id;
ALTER TABLE employee_work_logs ADD KEY idx_work_log_order (order_id);
ALTER TABLE employee_work_logs ADD CONSTRAINT fk_work_log_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

-- Application/runtime grants required for the existing two-pool architecture.
GRANT SELECT ON zoicas_osinski.orders TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT ON zoicas_osinski.order_assignments TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.orders TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.order_assignments TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON zoicas_osinski.employee_work_logs TO 'zoicas_app'@'127.0.0.1';
FLUSH PRIVILEGES;
