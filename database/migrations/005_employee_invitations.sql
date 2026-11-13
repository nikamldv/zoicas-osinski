-- Phase 6.1: one-time, time-limited employee invitation links.
USE zoicas_osinski;

CREATE TABLE IF NOT EXISTS employee_invitations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    employee_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    accepted_at DATETIME NULL,
    revoked_at DATETIME NULL,
    created_by VARCHAR(80) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_employee_invite_token (token_hash),
    KEY idx_employee_invitation_employee (employee_id, accepted_at, revoked_at),
    KEY idx_employee_invitation_expiry (expires_at),
    CONSTRAINT fk_employee_invitation_employee FOREIGN KEY (employee_id)
        REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Required grants (execute once as a MySQL administrator):
-- GRANT SELECT, INSERT, UPDATE ON zoicas_osinski.employee_invitations TO 'zoicas_app'@'127.0.0.1';
-- GRANT SELECT, INSERT, UPDATE ON zoicas_osinski.employee_invitations TO 'zoicas_dashboard'@'127.0.0.1';
