-- Phase 14.1: Leistungsnachweise, Serviceberichte & Qualitätsfreigabe.
-- Additive migration only. Existing Phase 1–13 tables and data are untouched.
USE zoicas_osinski;

CREATE TABLE IF NOT EXISTS service_reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    report_number VARCHAR(40) NOT NULL,
    order_id BIGINT UNSIGNED NOT NULL,
    assignment_id BIGINT UNSIGNED NOT NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    employee_id BIGINT UNSIGNED NOT NULL,
    service_date DATE NOT NULL,
    started_at DATETIME NULL,
    finished_at DATETIME NULL,
    summary TEXT NULL,
    internal_notes TEXT NULL,
    customer_notes TEXT NULL,
    status ENUM('DRAFT','SUBMITTED','REVIEWED','RETURNED','SHARED','CUSTOMER_CONFIRMED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    submitted_at DATETIME NULL,
    reviewed_at DATETIME NULL,
    reviewed_by_employee_id BIGINT UNSIGNED NULL,
    shared_with_customer_at DATETIME NULL,
    customer_confirmed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_p14_service_report_number (report_number),
    KEY idx_p14_service_report_order (order_id),
    KEY idx_p14_service_report_assignment (assignment_id),
    KEY idx_p14_service_report_customer (customer_id),
    KEY idx_p14_service_report_employee (employee_id),
    KEY idx_p14_service_report_status (status),
    KEY idx_p14_service_report_service_date (service_date),
    CONSTRAINT fk_p14_service_report_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p14_service_report_assignment FOREIGN KEY (assignment_id) REFERENCES order_assignments(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p14_service_report_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p14_service_report_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p14_service_report_reviewer FOREIGN KEY (reviewed_by_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    CONSTRAINT chk_p14_service_report_times CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- An individual FK proves each referenced row exists. These triggers also
-- enforce the cross-table ownership chain: assignment -> order/customer/employee.
-- The migration is a one-time forward migration; it never drops a trigger.

DELIMITER $$
CREATE TRIGGER trg_p14_service_reports_validate_insert
BEFORE INSERT ON service_reports
FOR EACH ROW
BEGIN
    DECLARE relationship_matches INT DEFAULT 0;
    SELECT COUNT(*) INTO relationship_matches
    FROM order_assignments AS assignment_row
    INNER JOIN orders AS order_row ON order_row.id = assignment_row.order_id
    WHERE assignment_row.id = NEW.assignment_id
      AND assignment_row.order_id = NEW.order_id
      AND assignment_row.employee_id = NEW.employee_id
      AND order_row.customer_id = NEW.customer_id;

    IF relationship_matches <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Service report ownership relationship is invalid.';
    END IF;
END$$

CREATE TRIGGER trg_p14_service_reports_validate_update
BEFORE UPDATE ON service_reports
FOR EACH ROW
BEGIN
    DECLARE relationship_matches INT DEFAULT 0;
    SELECT COUNT(*) INTO relationship_matches
    FROM order_assignments AS assignment_row
    INNER JOIN orders AS order_row ON order_row.id = assignment_row.order_id
    WHERE assignment_row.id = NEW.assignment_id
      AND assignment_row.order_id = NEW.order_id
      AND assignment_row.employee_id = NEW.employee_id
      AND order_row.customer_id = NEW.customer_id;

    IF relationship_matches <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Service report ownership relationship is invalid.';
    END IF;
END$$
DELIMITER ;

GRANT SELECT, INSERT, UPDATE ON zoicas_osinski.service_reports TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.service_reports TO 'zoicas_dashboard'@'127.0.0.1';
FLUSH PRIVILEGES;
