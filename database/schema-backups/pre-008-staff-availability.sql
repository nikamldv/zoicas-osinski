-- Pre-008 backup manifest (Phase 7 baseline)
-- Generated before adding Phase 8 availability structures.
-- Existing operational structures intentionally preserved:
--   employees, orders, order_assignments, employee_work_logs, task_documents
-- Restore source for the Phase 7 order layer: ../migrations/007_order_management.sql
-- Restore source for the Phase 7 document link: ../migrations/007b_order_documentation.sql
-- No existing table is altered or dropped by 008_staff_availability.sql.
USE zoicas_osinski;

-- Phase 8 is additive. These statements document the existing foreign-key surface
-- relied upon before applying the migration.
SELECT table_name, constraint_name
FROM information_schema.table_constraints
WHERE table_schema = DATABASE()
  AND constraint_type = 'FOREIGN KEY'
  AND table_name IN ('employees','orders','order_assignments','employee_work_logs','task_documents')
ORDER BY table_name, constraint_name;
