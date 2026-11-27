-- Absence requests extend the existing employee_absences scheduling records.
-- Select and verify the intended database before applying. This file changes no grants.
CREATE TABLE IF NOT EXISTS employee_absence_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_id BIGINT UNSIGNED NOT NULL,
    absence_id BIGINT UNSIGNED NULL,
    absence_type ENUM('URLAUB','KRANK','FREI','SONSTIGE') NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    note VARCHAR(1000) NULL,
    status ENUM('PENDING','APPROVED','REJECTED','WITHDRAWN') NOT NULL DEFAULT 'PENDING',
    decision_note VARCHAR(1000) NULL,
    decided_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_absence_request_absence (absence_id),
    KEY idx_absence_requests_employee_dates (employee_id,status,start_date,end_date),
    KEY idx_absence_requests_status (status,id),
    CONSTRAINT fk_absence_request_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    CONSTRAINT fk_absence_request_absence FOREIGN KEY (absence_id) REFERENCES employee_absences(id) ON DELETE RESTRICT,
    CONSTRAINT chk_absence_request_range CHECK (start_date <= end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
