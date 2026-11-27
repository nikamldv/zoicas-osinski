-- Phase 16.17A: attendance foundation.
-- Run only after selecting the intended database. This file intentionally has
-- no USE statement so the test runner cannot silently target production.
-- No GPS coordinates, location permissions, or live-location data are stored.

CREATE TABLE IF NOT EXISTS employee_attendance_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NOT NULL,
    assignment_id BIGINT UNSIGNED NOT NULL,
    work_log_id BIGINT UNSIGNED NULL,
    check_in_at DATETIME NOT NULL,
    check_out_at DATETIME NULL,
    check_in_note VARCHAR(1000) NULL,
    check_out_note VARCHAR(1000) NULL,
    status ENUM('OPEN','CLOSED','REVIEW_REQUIRED','CANCELLED') NOT NULL DEFAULT 'OPEN',
    review_required TINYINT(1) NOT NULL DEFAULT 0,
    active_employee_id BIGINT UNSIGNED GENERATED ALWAYS AS (IF(status = 'OPEN', employee_id, NULL)) STORED,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_attendance_open_employee (active_employee_id),
    UNIQUE KEY uq_attendance_work_log (work_log_id),
    KEY idx_attendance_employee_checkin (employee_id, check_in_at),
    KEY idx_attendance_order_checkin (order_id, check_in_at),
    KEY idx_attendance_assignment (assignment_id),
    KEY idx_attendance_status_checkin (status, check_in_at),
    CONSTRAINT fk_attendance_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    CONSTRAINT fk_attendance_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
    CONSTRAINT fk_attendance_assignment FOREIGN KEY (assignment_id) REFERENCES order_assignments(id) ON DELETE RESTRICT,
    CONSTRAINT fk_attendance_work_log FOREIGN KEY (work_log_id) REFERENCES employee_work_logs(id) ON DELETE SET NULL,
    CONSTRAINT chk_attendance_checkout_after_checkin CHECK (check_out_at IS NULL OR check_out_at >= check_in_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
