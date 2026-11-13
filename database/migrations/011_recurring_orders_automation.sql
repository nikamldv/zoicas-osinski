-- Phase 11: controlled recurring orders and automation audit trail. Additive only.
USE zoicas_osinski;

CREATE TABLE IF NOT EXISTS recurring_schedules (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    contract_id BIGINT UNSIGNED NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NULL,
    recurrence_type ENUM('EINMALIG','WOECHENTLICH','ZWEIMAL_WOECHENTLICH','MEHRMALS_WOECHENTLICH','MONATLICH','INDIVIDUELL') NOT NULL,
    weekdays VARCHAR(32) NULL COMMENT 'Comma-separated ISO weekdays: 1=Monday ... 7=Sunday',
    preferred_start_time TIME NOT NULL,
    duration_minutes SMALLINT UNSIGNED NOT NULL,
    preferred_employee_id BIGINT UNSIGNED NULL,
    next_run_date DATE NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    last_generated_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_recurring_schedule_contract (contract_id),
    KEY idx_recurring_schedules_active_next (active, next_run_date),
    KEY idx_recurring_schedules_employee (preferred_employee_id),
    CONSTRAINT fk_p11_schedule_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
    CONSTRAINT fk_p11_schedule_employee FOREIGN KEY (preferred_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
    CONSTRAINT chk_p11_schedule_dates CHECK (end_date IS NULL OR start_date <= end_date),
    CONSTRAINT chk_p11_schedule_duration CHECK (duration_minutes BETWEEN 15 AND 1440)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    contract_id BIGINT UNSIGNED NULL,
    schedule_id BIGINT UNSIGNED NULL,
    execution_date DATE NOT NULL,
    action VARCHAR(64) NOT NULL,
    result ENUM('SUCCESS','SKIPPED','FAILED','NO_AVAILABILITY') NOT NULL,
    generated_order_id BIGINT UNSIGNED NULL,
    error_message VARCHAR(1000) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_automation_logs_schedule_created (schedule_id, created_at),
    KEY idx_automation_logs_contract_date (contract_id, execution_date),
    KEY idx_automation_logs_order (generated_order_id),
    CONSTRAINT fk_p11_log_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE SET NULL,
    CONSTRAINT fk_p11_log_schedule FOREIGN KEY (schedule_id) REFERENCES recurring_schedules(id) ON DELETE SET NULL,
    CONSTRAINT fk_p11_log_order FOREIGN KEY (generated_order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE orders
    ADD COLUMN automation_schedule_id BIGINT UNSIGNED NULL AFTER contract_id,
    ADD COLUMN planned_start DATETIME NULL AFTER preferred_date,
    ADD COLUMN planned_end DATETIME NULL AFTER planned_start,
    ADD COLUMN is_automated TINYINT(1) NOT NULL DEFAULT 0 AFTER planned_end,
    ADD KEY idx_orders_automation_schedule (automation_schedule_id, planned_start),
    ADD UNIQUE KEY uq_orders_contract_planned_start (contract_id, planned_start),
    ADD CONSTRAINT fk_p11_orders_schedule FOREIGN KEY (automation_schedule_id) REFERENCES recurring_schedules(id) ON DELETE SET NULL;

GRANT SELECT ON zoicas_osinski.recurring_schedules TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT ON zoicas_osinski.automation_logs TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.recurring_schedules TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON zoicas_osinski.automation_logs TO 'zoicas_dashboard'@'127.0.0.1';
FLUSH PRIVILEGES;
