-- Select and verify the intended database before applying. No grants are changed.
ALTER TABLE quote_requests
    ADD COLUMN portal_submission_key CHAR(36) NULL,
    ADD UNIQUE KEY uq_quote_request_portal_submission (customer_id, portal_submission_key);

CREATE TABLE customer_complaints (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    customer_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NULL,
    incident_id BIGINT UNSIGNED NULL,
    submission_key CHAR(36) NOT NULL,
    description TEXT NOT NULL,
    status ENUM('RECEIVED','IN_REVIEW','RESOLVED','CLOSED') NOT NULL DEFAULT 'RECEIVED',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_complaint_submission (customer_id, submission_key),
    UNIQUE KEY uq_complaint_incident (incident_id),
    KEY idx_complaint_status (status,id),
    CONSTRAINT fk_complaint_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_complaint_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
    CONSTRAINT fk_complaint_incident FOREIGN KEY (incident_id) REFERENCES quality_incidents(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_complaint_updates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    complaint_id BIGINT UNSIGNED NOT NULL,
    publication_key CHAR(36) NOT NULL,
    status ENUM('RECEIVED','IN_REVIEW','RESOLVED','CLOSED') NOT NULL,
    response VARCHAR(2000) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_complaint_update_publication (complaint_id, publication_key),
    KEY idx_complaint_update (complaint_id,id),
    CONSTRAINT fk_complaint_update FOREIGN KEY (complaint_id) REFERENCES customer_complaints(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
