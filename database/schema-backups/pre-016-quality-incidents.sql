-- Zoicas & Osinski – schema backup before Migration 016
-- Created from the live zoicas_osinski schema on 2026-11-19.
-- Scope: all existing tables referenced by the Phase 16.8 quality-incident schema.
-- Schema only; no business data is included.

CREATE TABLE `customers` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `customer_number` varchar(40) NOT NULL, `first_name` varchar(80) NOT NULL, `last_name` varchar(80) NOT NULL,
  `email` varchar(254) NOT NULL, `phone` varchar(40) NOT NULL, `password_hash` varchar(255) NOT NULL,
  `status` enum('active','inactive','blocked') NOT NULL DEFAULT 'active',
  `address` varchar(180) DEFAULT NULL, `postal_code` varchar(16) DEFAULT NULL, `city` varchar(120) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_login_at` timestamp NULL DEFAULT NULL, PRIMARY KEY (`id`), UNIQUE KEY `uq_customer_email` (`email`),
  UNIQUE KEY `uq_customer_number` (`customer_number`), KEY `idx_customer_status_created` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `employees` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT, `first_name` varchar(80) NOT NULL, `last_name` varchar(80) NOT NULL,
  `email` varchar(254) NOT NULL, `phone` varchar(40) NOT NULL, `password_hash` varchar(255) NOT NULL,
  `role` enum('EMPLOYEE','MANAGER','ADMIN') NOT NULL DEFAULT 'EMPLOYEE', `status` enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `employee_number` varchar(40) NOT NULL, `position` varchar(120) DEFAULT NULL, `hire_date` date DEFAULT NULL, `notes` text,
  `last_login_at` timestamp NULL DEFAULT NULL, `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employee_email` (`email`), UNIQUE KEY `uq_employee_number` (`employee_number`),
  KEY `idx_employee_status_role` (`status`,`role`), KEY `idx_employee_name` (`last_name`,`first_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `orders` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT, `order_number` varchar(40) NOT NULL, `customer_id` bigint unsigned NOT NULL,
  `appointment_id` bigint unsigned DEFAULT NULL, `quote_id` bigint unsigned DEFAULT NULL, `sales_quote_id` bigint unsigned DEFAULT NULL,
  `contract_id` bigint unsigned DEFAULT NULL, `automation_schedule_id` bigint unsigned DEFAULT NULL, `service_type` varchar(160) NOT NULL,
  `title` varchar(180) NOT NULL, `description` text, `object_type` varchar(120) DEFAULT NULL, `area_sqm` decimal(10,2) DEFAULT NULL,
  `frequency` varchar(80) DEFAULT NULL, `address` varchar(180) DEFAULT NULL, `postal_code` varchar(16) DEFAULT NULL,
  `city` varchar(120) DEFAULT NULL, `preferred_date` date DEFAULT NULL, `planned_start` datetime DEFAULT NULL, `planned_end` datetime DEFAULT NULL,
  `is_automated` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('NEU','GEPLANT','ZUGEWIESEN','IN_BEARBEITUNG','PAUSIERT','ERLEDIGT','STORNIERT') NOT NULL DEFAULT 'NEU',
  `priority` enum('NORMAL','HOCH','DRINGEND') NOT NULL DEFAULT 'NORMAL', `estimated_duration_minutes` smallint unsigned DEFAULT NULL,
  `price_net_snapshot` decimal(12,2) DEFAULT NULL, `price_tax_snapshot` decimal(12,2) DEFAULT NULL, `price_gross_snapshot` decimal(12,2) DEFAULT NULL,
  `notes` text, `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `uq_orders_number` (`order_number`), UNIQUE KEY `uq_orders_contract_planned_start` (`contract_id`,`planned_start`),
  KEY `idx_orders_customer_status` (`customer_id`,`status`,`preferred_date`),
  CONSTRAINT `fk_orders_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_assignments` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT, `order_id` bigint unsigned NOT NULL, `employee_id` bigint unsigned NOT NULL,
  `assignment_date` date NOT NULL, `start_time` time NOT NULL, `end_time` time NOT NULL,
  `status` enum('GEPLANT','IN_BEARBEITUNG','ERLEDIGT','STORNIERT') NOT NULL DEFAULT 'GEPLANT', `notes` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `uq_assignment_employee_slot` (`employee_id`,`assignment_date`,`start_time`,`end_time`),
  KEY `idx_assignments_order` (`order_id`,`assignment_date`), KEY `idx_assignments_employee_date` (`employee_id`,`assignment_date`,`start_time`),
  CONSTRAINT `fk_assignments_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_assignments_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `service_reports` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT, `report_number` varchar(40) NOT NULL, `order_id` bigint unsigned NOT NULL,
  `assignment_id` bigint unsigned NOT NULL, `customer_id` bigint unsigned NOT NULL, `employee_id` bigint unsigned NOT NULL,
  `service_date` date NOT NULL, `started_at` datetime DEFAULT NULL, `finished_at` datetime DEFAULT NULL, `summary` text,
  `internal_notes` text, `customer_notes` text,
  `status` enum('DRAFT','SUBMITTED','REVIEWED','RETURNED','SHARED','CUSTOMER_CONFIRMED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `submitted_at` datetime DEFAULT NULL, `reviewed_at` datetime DEFAULT NULL, `reviewed_by_employee_id` bigint unsigned DEFAULT NULL,
  `shared_with_customer_at` datetime DEFAULT NULL, `customer_confirmed_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `uq_p14_service_report_number` (`report_number`), KEY `idx_p14_service_report_order` (`order_id`),
  KEY `idx_p14_service_report_assignment` (`assignment_id`), KEY `idx_p14_service_report_customer` (`customer_id`),
  KEY `idx_p14_service_report_employee` (`employee_id`), KEY `idx_p14_service_report_status` (`status`),
  CONSTRAINT `fk_p14_service_report_assignment` FOREIGN KEY (`assignment_id`) REFERENCES `order_assignments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_p14_service_report_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_p14_service_report_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_p14_service_report_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `audit_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT, `actor_type` enum('ADMIN','CUSTOMER','EMPLOYEE','SYSTEM') NOT NULL,
  `actor_id` bigint unsigned DEFAULT NULL, `action` varchar(80) NOT NULL, `entity_type` varchar(64) NOT NULL,
  `entity_id` bigint unsigned DEFAULT NULL, `old_value` json DEFAULT NULL, `new_value` json DEFAULT NULL,
  `metadata` json DEFAULT NULL, `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (`id`),
  KEY `idx_p12_audit_entity` (`entity_type`,`entity_id`,`created_at`), KEY `idx_p12_audit_actor` (`actor_type`,`actor_id`,`created_at`),
  KEY `idx_p12_audit_action` (`action`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `notifications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT, `recipient_type` enum('ADMIN','CUSTOMER','EMPLOYEE') NOT NULL,
  `recipient_id` bigint unsigned DEFAULT NULL, `notification_type` varchar(64) NOT NULL, `title` varchar(180) NOT NULL,
  `body` text, `entity_type` varchar(64) DEFAULT NULL, `entity_id` bigint unsigned DEFAULT NULL, `read_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (`id`),
  KEY `idx_p12_notifications_recipient` (`recipient_type`,`recipient_id`,`read_at`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
