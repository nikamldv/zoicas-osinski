-- Select and verify the intended database before applying.
ALTER TABLE recurring_schedules
    ADD COLUMN service_address VARCHAR(180) NULL,
    ADD COLUMN service_postal_code VARCHAR(16) NULL,
    ADD COLUMN service_city VARCHAR(120) NULL;
