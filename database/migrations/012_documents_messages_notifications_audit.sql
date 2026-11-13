-- Phase 12: private documents, customer communication, notifications and immutable audit trail.
USE zoicas_osinski;
CREATE TABLE IF NOT EXISTS documents (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, customer_id BIGINT UNSIGNED NULL, quote_id BIGINT UNSIGNED NULL, contract_id BIGINT UNSIGNED NULL, order_id BIGINT UNSIGNED NULL, invoice_id BIGINT UNSIGNED NULL,
 document_type ENUM('ANGEBOT','VERTRAG','AUFTRAG','LEISTUNGSNACHWEIS','RECHNUNG','ZAHLUNGSBELEG','VORHER_FOTO','NACHHER_FOTO','SONSTIGES') NOT NULL,
 file_name VARCHAR(255) NOT NULL, stored_file_name CHAR(36) NOT NULL, storage_path VARCHAR(500) NOT NULL, mime_type VARCHAR(100) NOT NULL, file_size BIGINT UNSIGNED NOT NULL,
 uploaded_by_type ENUM('ADMIN','CUSTOMER','EMPLOYEE','SYSTEM') NOT NULL, uploaded_by_id BIGINT UNSIGNED NULL, visibility ENUM('ADMIN','CUSTOMER','EMPLOYEE') NOT NULL DEFAULT 'ADMIN', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(id), UNIQUE KEY uq_p12_document_stored(stored_file_name), KEY idx_p12_documents_customer(customer_id,created_at), KEY idx_p12_documents_order(order_id,created_at), KEY idx_p12_documents_invoice(invoice_id,created_at),
 CONSTRAINT fk_p12_document_customer FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL, CONSTRAINT fk_p12_document_quote FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE SET NULL, CONSTRAINT fk_p12_document_contract FOREIGN KEY(contract_id) REFERENCES contracts(id) ON DELETE SET NULL, CONSTRAINT fk_p12_document_order FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL, CONSTRAINT fk_p12_document_invoice FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE SET NULL, CONSTRAINT chk_p12_document_size CHECK(file_size > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS messages (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, customer_id BIGINT UNSIGNED NOT NULL, sender_type ENUM('ADMIN','CUSTOMER') NOT NULL, sender_id BIGINT UNSIGNED NULL, recipient_type ENUM('ADMIN','CUSTOMER') NOT NULL, recipient_id BIGINT UNSIGNED NULL, order_id BIGINT UNSIGNED NULL, quote_id BIGINT UNSIGNED NULL, contract_id BIGINT UNSIGNED NULL, invoice_id BIGINT UNSIGNED NULL, subject VARCHAR(180) NOT NULL, message TEXT NOT NULL, read_at DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(id), KEY idx_p12_messages_customer(customer_id,created_at), KEY idx_p12_messages_read(customer_id,read_at), CONSTRAINT fk_p12_message_customer FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE RESTRICT, CONSTRAINT fk_p12_message_order FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL, CONSTRAINT fk_p12_message_quote FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE SET NULL, CONSTRAINT fk_p12_message_contract FOREIGN KEY(contract_id) REFERENCES contracts(id) ON DELETE SET NULL, CONSTRAINT fk_p12_message_invoice FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS notifications (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, recipient_type ENUM('ADMIN','CUSTOMER') NOT NULL, recipient_id BIGINT UNSIGNED NULL, notification_type VARCHAR(64) NOT NULL, title VARCHAR(180) NOT NULL, body TEXT NULL, entity_type VARCHAR(64) NULL, entity_id BIGINT UNSIGNED NULL, read_at DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(id), KEY idx_p12_notifications_recipient(recipient_type,recipient_id,read_at,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, actor_type ENUM('ADMIN','CUSTOMER','EMPLOYEE','SYSTEM') NOT NULL, actor_id BIGINT UNSIGNED NULL, action VARCHAR(80) NOT NULL, entity_type VARCHAR(64) NOT NULL, entity_id BIGINT UNSIGNED NULL, old_value JSON NULL, new_value JSON NULL, metadata JSON NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(id), KEY idx_p12_audit_entity(entity_type,entity_id,created_at), KEY idx_p12_audit_actor(actor_type,actor_id,created_at), KEY idx_p12_audit_action(action,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
GRANT SELECT ON zoicas_osinski.documents TO 'zoicas_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE,DELETE ON zoicas_osinski.documents TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE,DELETE ON zoicas_osinski.messages TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE,DELETE ON zoicas_osinski.notifications TO 'zoicas_dashboard'@'127.0.0.1';
GRANT SELECT,INSERT ON zoicas_osinski.audit_logs TO 'zoicas_dashboard'@'127.0.0.1'; FLUSH PRIVILEGES;
