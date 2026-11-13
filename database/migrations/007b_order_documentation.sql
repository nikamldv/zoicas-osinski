-- Phase 7 follow-up: link existing private employee documentation to an order.
USE zoicas_osinski;

ALTER TABLE task_documents
    ADD COLUMN order_id BIGINT UNSIGNED NULL AFTER task_id,
    ADD KEY idx_task_documents_order (order_id),
    ADD CONSTRAINT fk_task_documents_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

-- The application account already has private-document access from Phase 6.
FLUSH PRIVILEGES;
