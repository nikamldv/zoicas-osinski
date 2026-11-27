-- Select and verify the intended database before applying.
ALTER TABLE recurring_schedules
    ADD COLUMN required_crew_size SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    ADD COLUMN preferred_employee_ids JSON NULL,
    ADD CONSTRAINT chk_recurring_crew_size CHECK (required_crew_size BETWEEN 1 AND 20);

ALTER TABLE orders
    ADD COLUMN required_crew_size SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    ADD CONSTRAINT chk_order_crew_size CHECK (required_crew_size BETWEEN 1 AND 20);

CREATE TABLE order_billing_exceptions (
    assignment_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    reason ENUM('ABSENT','UNABLE_TO_COMPLETE') NOT NULL,
    note VARCHAR(1000) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_billing_exception_assignment FOREIGN KEY (assignment_id) REFERENCES order_assignments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
