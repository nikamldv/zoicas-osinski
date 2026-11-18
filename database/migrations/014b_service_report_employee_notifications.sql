-- Phase 14.2 prerequisite: extend the existing Phase-12 notification enum.
-- Additive only; no notification rows are removed or rewritten.
USE zoicas_osinski;

ALTER TABLE notifications
    MODIFY recipient_type ENUM('ADMIN','CUSTOMER','EMPLOYEE') NOT NULL;
