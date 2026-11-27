-- Phase 16.17B: TEST-ONLY live-location simulation foundation.
-- Execute only after explicitly selecting zoicas_osinski_test.
-- This migration deliberately has no USE statement and stores no GPS history.

CREATE TABLE IF NOT EXISTS employee_location_sharing_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_id BIGINT UNSIGNED NOT NULL,
    attendance_session_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NOT NULL,
    assignment_id BIGINT UNSIGNED NOT NULL,
    started_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    stopped_at DATETIME NULL,
    status ENUM('ACTIVE','STOPPED','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
    active_employee_id BIGINT UNSIGNED GENERATED ALWAYS AS (IF(status = 'ACTIVE', employee_id, NULL)) STORED,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_location_simulation_active_employee (active_employee_id),
    KEY idx_location_simulation_employee_status (employee_id, status),
    KEY idx_location_simulation_expiry (status, expires_at),
    KEY idx_location_simulation_attendance (attendance_session_id),
    KEY idx_location_simulation_assignment (assignment_id),
    CONSTRAINT fk_location_simulation_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    CONSTRAINT fk_location_simulation_attendance FOREIGN KEY (attendance_session_id) REFERENCES employee_attendance_sessions(id) ON DELETE RESTRICT,
    CONSTRAINT fk_location_simulation_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
    CONSTRAINT fk_location_simulation_assignment FOREIGN KEY (assignment_id) REFERENCES order_assignments(id) ON DELETE RESTRICT,
    CONSTRAINT chk_location_simulation_expiry CHECK (expires_at > started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_live_locations (
    employee_id BIGINT UNSIGNED NOT NULL,
    sharing_session_id BIGINT UNSIGNED NOT NULL,
    latitude DECIMAL(9,6) NOT NULL,
    longitude DECIMAL(9,6) NOT NULL,
    accuracy_meters DECIMAL(8,2) NULL,
    is_synthetic TINYINT(1) NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (employee_id),
    UNIQUE KEY uq_live_location_session (sharing_session_id),
    KEY idx_live_location_updated (updated_at),
    CONSTRAINT fk_live_location_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    CONSTRAINT fk_live_location_session FOREIGN KEY (sharing_session_id) REFERENCES employee_location_sharing_sessions(id) ON DELETE CASCADE,
    CONSTRAINT chk_live_location_latitude CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT chk_live_location_longitude CHECK (longitude BETWEEN -180 AND 180),
    CONSTRAINT chk_live_location_synthetic CHECK (is_synthetic = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
