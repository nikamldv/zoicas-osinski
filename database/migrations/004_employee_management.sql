-- Phase 6: additive employee management schema.
-- This migration only adds new tables and does not modify existing data.
USE zoicas_osinski;

CREATE TABLE IF NOT EXISTS employees (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    first_name VARCHAR(80) NOT NULL,
    last_name VARCHAR(80) NOT NULL,
    email VARCHAR(254) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('EMPLOYEE', 'MANAGER', 'ADMIN') NOT NULL DEFAULT 'EMPLOYEE',
    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    employee_number VARCHAR(40) NOT NULL,
    position VARCHAR(120) NULL,
    hire_date DATE NULL,
    notes TEXT NULL,
    last_login_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_employee_email (email),
    UNIQUE KEY uq_employee_number (employee_number),
    KEY idx_employee_status_role (status, role),
    KEY idx_employee_name (last_name, first_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_tasks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(180) NOT NULL,
    description TEXT NULL,
    employee_notes TEXT NULL,
    customer_id BIGINT UNSIGNED NULL,
    appointment_id BIGINT UNSIGNED NULL,
    status ENUM('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    priority ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    scheduled_date DATE NULL,
    start_time TIME NULL,
    end_time TIME NULL,
    created_by VARCHAR(80) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_task_employee_status_date (employee_id, status, scheduled_date),
    KEY idx_task_customer (customer_id),
    KEY idx_task_appointment (appointment_id),
    CONSTRAINT fk_task_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    CONSTRAINT fk_task_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    CONSTRAINT fk_task_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_work_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_id BIGINT UNSIGNED NOT NULL,
    task_id BIGINT UNSIGNED NULL,
    work_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_work_log_employee_date (employee_id, work_date),
    KEY idx_work_log_task (task_id),
    CONSTRAINT fk_work_log_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    CONSTRAINT fk_work_log_task FOREIGN KEY (task_id) REFERENCES employee_tasks(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_documents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    task_id BIGINT UNSIGNED NOT NULL,
    employee_id BIGINT UNSIGNED NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    stored_file_name CHAR(36) NOT NULL,
    mime_type ENUM('image/jpeg', 'image/png', 'application/pdf') NOT NULL,
    file_size INT UNSIGNED NOT NULL,
    storage_path VARCHAR(255) NOT NULL,
    description VARCHAR(1000) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_task_document_stored_name (stored_file_name),
    KEY idx_task_document_task (task_id),
    KEY idx_task_document_employee (employee_id),
    CONSTRAINT fk_task_document_task FOREIGN KEY (task_id) REFERENCES employee_tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_document_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Required grants (execute once as a MySQL administrator after this migration):
-- GRANT SELECT, INSERT, UPDATE ON zoicas_osinski.employees TO 'zoicas_app'@'127.0.0.1';
-- GRANT SELECT, INSERT, UPDATE ON zoicas_osinski.employee_tasks TO 'zoicas_app'@'127.0.0.1';
-- GRANT SELECT, INSERT, UPDATE ON zoicas_osinski.employee_work_logs TO 'zoicas_app'@'127.0.0.1';
-- GRANT SELECT, INSERT ON zoicas_osinski.task_documents TO 'zoicas_app'@'127.0.0.1';
-- GRANT SELECT, INSERT, UPDATE ON zoicas_osinski.employees TO 'zoicas_dashboard'@'127.0.0.1';
-- GRANT SELECT, INSERT, UPDATE ON zoicas_osinski.employee_tasks TO 'zoicas_dashboard'@'127.0.0.1';
-- GRANT SELECT ON zoicas_osinski.employee_work_logs TO 'zoicas_dashboard'@'127.0.0.1';
-- GRANT SELECT ON zoicas_osinski.task_documents TO 'zoicas_dashboard'@'127.0.0.1';
