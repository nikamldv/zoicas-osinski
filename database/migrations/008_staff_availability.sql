-- Phase 8: employee working hours, absences and availability planning.
-- Execute once as a MySQL administrator after creating the pre-008 backup.
USE zoicas_osinski;

CREATE TABLE IF NOT EXISTS employee_work_hours (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_id BIGINT UNSIGNED NOT NULL,
    weekday TINYINT UNSIGNED NOT NULL COMMENT '1=Monday ... 7=Sunday',
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_employee_work_hours_day (employee_id, weekday),
    KEY idx_employee_work_hours_weekday (weekday, employee_id),
    CONSTRAINT fk_employee_work_hours_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    CONSTRAINT chk_employee_work_hours_weekday CHECK (weekday BETWEEN 1 AND 7),
    CONSTRAINT chk_employee_work_hours_range CHECK (start_time < end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_absences (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_id BIGINT UNSIGNED NOT NULL,
    absence_type ENUM('URLAUB','KRANK','FREI','SONSTIGE') NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    notes VARCHAR(1000) NULL,
    created_by VARCHAR(80) NOT NULL DEFAULT 'admin',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_employee_absences_employee_dates (employee_id, start_date, end_date),
    KEY idx_employee_absences_dates (start_date, end_date),
    CONSTRAINT fk_employee_absences_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    CONSTRAINT chk_employee_absences_range CHECK (start_date <= end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Give current active staff a stored, editable standard schedule.
INSERT IGNORE INTO employee_work_hours (employee_id, weekday, start_time, end_time)
SELECT e.id, d.weekday, '08:00:00', '16:00:00'
FROM employees e
CROSS JOIN (
    SELECT 1 AS weekday UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
) d
WHERE e.status = 'ACTIVE';

GRANT SELECT ON zoicas_osinski.employee_work_hours TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT ON zoicas_osinski.employee_absences TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.employee_work_hours TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.employee_absences TO 'zoicas_dashboard'@'127.0.0.1';
FLUSH PRIVILEGES;
