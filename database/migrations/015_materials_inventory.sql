-- Phase 15 design: Material- und Verbrauchsmanagement.
-- DISCOVERY DESIGN ONLY: do not execute until Phase 15 implementation is approved.
-- Additive migration. It creates no duplicate finance, invoice or document data.
USE zoicas_osinski;

CREATE TABLE IF NOT EXISTS materials (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    material_number VARCHAR(40) NOT NULL,
    name VARCHAR(180) NOT NULL,
    description TEXT NULL,
    unit ENUM('STUECK','LITER','KILOGRAMM','METER','PACKUNG') NOT NULL,
    minimum_stock DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    default_unit_cost DECIMAL(12,4) NULL,
    status ENUM('ACTIVE','INACTIVE','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_p15_material_number (material_number),
    KEY idx_p15_material_status (status),
    KEY idx_p15_material_name (name),
    CONSTRAINT chk_p15_material_minimum_stock CHECK (minimum_stock >= 0),
    CONSTRAINT chk_p15_material_default_cost CHECK (default_unit_cost IS NULL OR default_unit_cost >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_material_requirements (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id BIGINT UNSIGNED NOT NULL,
    material_id BIGINT UNSIGNED NOT NULL,
    planned_quantity DECIMAL(12,3) NOT NULL,
    status ENUM('PLANNED','ORDERED','READY','CANCELLED') NOT NULL DEFAULT 'PLANNED',
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_p15_order_material_requirement (order_id, material_id),
    KEY idx_p15_requirement_material_status (material_id, status),
    KEY idx_p15_requirement_order_status (order_id, status),
    CONSTRAINT fk_p15_requirement_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p15_requirement_material FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT,
    CONSTRAINT chk_p15_requirement_quantity CHECK (planned_quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS material_stock_movements (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    movement_number VARCHAR(40) NOT NULL,
    material_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NULL,
    service_report_id BIGINT UNSIGNED NULL,
    employee_id BIGINT UNSIGNED NULL,
    movement_type ENUM('RECEIPT','CONSUMPTION','RETURN','ADJUSTMENT_IN','ADJUSTMENT_OUT') NOT NULL,
    quantity DECIMAL(12,3) NOT NULL,
    unit_cost_snapshot DECIMAL(12,4) NULL,
    movement_date DATE NOT NULL,
    status ENUM('RECORDED','APPROVED','CANCELLED') NOT NULL DEFAULT 'RECORDED',
    reference VARCHAR(180) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_p15_stock_movement_number (movement_number),
    KEY idx_p15_stock_material_date (material_id, movement_date),
    KEY idx_p15_stock_order_date (order_id, movement_date),
    KEY idx_p15_stock_service_report (service_report_id),
    KEY idx_p15_stock_employee_date (employee_id, movement_date),
    KEY idx_p15_stock_status_date (status, movement_date),
    CONSTRAINT fk_p15_stock_material FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p15_stock_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p15_stock_service_report FOREIGN KEY (service_report_id) REFERENCES service_reports(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p15_stock_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
    CONSTRAINT chk_p15_stock_quantity CHECK (quantity > 0),
    CONSTRAINT chk_p15_stock_cost CHECK (unit_cost_snapshot IS NULL OR unit_cost_snapshot >= 0),
    CONSTRAINT chk_p15_stock_consumption_context CHECK (
        movement_type NOT IN ('CONSUMPTION','RETURN') OR (order_id IS NOT NULL AND employee_id IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cross-table ownership must be enforced in addition to individual FKs:
-- if a movement references a service report, its order and employee must match.
DELIMITER $$
CREATE TRIGGER trg_p15_stock_movement_validate_insert
BEFORE INSERT ON material_stock_movements
FOR EACH ROW
BEGIN
    DECLARE report_matches INT DEFAULT 0;
    IF NEW.service_report_id IS NOT NULL THEN
        SELECT COUNT(*) INTO report_matches
        FROM service_reports r
        WHERE r.id = NEW.service_report_id
          AND (NEW.order_id IS NULL OR r.order_id = NEW.order_id)
          AND (NEW.employee_id IS NULL OR r.employee_id = NEW.employee_id);
        IF report_matches <> 1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Material movement service report relationship is invalid.';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_p15_stock_movement_validate_update
BEFORE UPDATE ON material_stock_movements
FOR EACH ROW
BEGIN
    DECLARE report_matches INT DEFAULT 0;
    IF NEW.service_report_id IS NOT NULL THEN
        SELECT COUNT(*) INTO report_matches
        FROM service_reports r
        WHERE r.id = NEW.service_report_id
          AND (NEW.order_id IS NULL OR r.order_id = NEW.order_id)
          AND (NEW.employee_id IS NULL OR r.employee_id = NEW.employee_id);
        IF report_matches <> 1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Material movement service report relationship is invalid.';
        END IF;
    END IF;
END$$
DELIMITER ;

-- No GRANT statement is included in Phase 15.1. Database permissions must be
-- reviewed and approved during implementation; this discovery phase changes none.
