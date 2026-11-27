-- Select and verify the intended database before applying.
ALTER TABLE contracts
    ADD COLUMN external_contract_number VARCHAR(80) NULL,
    ADD COLUMN historical_registration BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN registration_key CHAR(36) NULL,
    ADD UNIQUE KEY uq_contract_external_number (customer_id, external_contract_number),
    ADD UNIQUE KEY uq_contract_registration_key (registration_key);
