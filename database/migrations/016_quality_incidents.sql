-- Phase 16.8A: Quality Incident & Corrective Action Management
-- Additive only. Run against database: zoicas_osinski.
-- created_by_type / created_by_id are deliberately polymorphic; ownership is validated in application code.

CREATE TABLE quality_incidents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    incident_number VARCHAR(40) NOT NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NULL,
    assignment_id BIGINT UNSIGNED NULL,
    service_report_id BIGINT UNSIGNED NULL,
    created_by_type ENUM('ADMIN','CUSTOMER','EMPLOYEE','SYSTEM') NOT NULL,
    created_by_id BIGINT UNSIGNED NULL,
    assigned_employee_id BIGINT UNSIGNED NULL,
    category VARCHAR(80) NOT NULL,
    severity ENUM('LOW','NORMAL','HIGH','CRITICAL') NOT NULL DEFAULT 'NORMAL',
    status ENUM('OPEN','IN_REVIEW','IN_PROGRESS','WAITING_CUSTOMER','RESOLVED','CLOSED','CANCELLED') NOT NULL DEFAULT 'OPEN',
    title VARCHAR(180) NOT NULL,
    description TEXT NOT NULL,
    internal_notes TEXT NULL,
    root_cause TEXT NULL,
    due_date DATE NULL,
    resolved_at DATETIME NULL,
    closed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_p16_quality_incident_number (incident_number),
    KEY idx_p16_incident_customer_status (customer_id, status, created_at),
    KEY idx_p16_incident_order (order_id),
    KEY idx_p16_incident_assignment (assignment_id),
    KEY idx_p16_incident_service_report (service_report_id),
    KEY idx_p16_incident_assigned_status (assigned_employee_id, status, due_date),
    KEY idx_p16_incident_status_severity_due (status, severity, due_date),
    CONSTRAINT fk_p16_incident_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p16_incident_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    CONSTRAINT fk_p16_incident_assignment FOREIGN KEY (assignment_id) REFERENCES order_assignments(id) ON DELETE SET NULL,
    CONSTRAINT fk_p16_incident_service_report FOREIGN KEY (service_report_id) REFERENCES service_reports(id) ON DELETE SET NULL,
    CONSTRAINT fk_p16_incident_assigned_employee FOREIGN KEY (assigned_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    CONSTRAINT chk_p16_incident_closed_at CHECK (closed_at IS NULL OR resolved_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Action status meaning: OPEN = unstarted, IN_PROGRESS = active work,
-- COMPLETED = evidence/action finished, CANCELLED = action no longer required.
CREATE TABLE quality_corrective_actions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    incident_id BIGINT UNSIGNED NOT NULL,
    assigned_employee_id BIGINT UNSIGNED NULL,
    title VARCHAR(180) NOT NULL,
    description TEXT NULL,
    due_date DATE NULL,
    status ENUM('OPEN','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'OPEN',
    completed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_p16_action_incident_status (incident_id, status, due_date),
    KEY idx_p16_action_employee_status (assigned_employee_id, status, due_date),
    KEY idx_p16_action_due_date (due_date),
    CONSTRAINT fk_p16_action_incident FOREIGN KEY (incident_id) REFERENCES quality_incidents(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p16_action_assigned_employee FOREIGN KEY (assigned_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    CONSTRAINT chk_p16_action_completed_at CHECK (completed_at IS NULL OR status = 'COMPLETED')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
