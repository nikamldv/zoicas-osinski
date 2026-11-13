-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: 127.0.0.1    Database: zoicas_osinski
-- ------------------------------------------------------
-- Server version	8.0.46

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `appointment_customers`
--

DROP TABLE IF EXISTS `appointment_customers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `appointment_customers` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `first_name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_appointment_customer_email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `appointment_customers`
--

LOCK TABLES `appointment_customers` WRITE;
/*!40000 ALTER TABLE `appointment_customers` DISABLE KEYS */;
INSERT INTO `appointment_customers` VALUES (1,'Phase','Vier','phase4@example.test','+49123456789','2026-11-11 11:11:23','2026-11-11 11:11:23'),(2,'Race','Test','race@example.test','+49123456789','2026-11-11 11:11:33','2026-11-11 11:11:33'),(3,'Race','Test','race2@example.test','+49123456789','2026-11-11 11:12:00','2026-11-11 11:12:00');
/*!40000 ALTER TABLE `appointment_customers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `appointments`
--

DROP TABLE IF EXISTS `appointments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `appointments` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `customer_id` bigint unsigned NOT NULL,
  `portal_customer_id` bigint unsigned DEFAULT NULL,
  `service` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `object_type` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `address` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `postal_code` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `city` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `area_m2` smallint unsigned DEFAULT NULL,
  `preferred_date` date NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `duration_minutes` smallint unsigned NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci,
  `status` enum('pending','confirmed','in_progress','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_appointment_slot` (`preferred_date`,`start_time`),
  KEY `idx_appointment_date_status` (`preferred_date`,`status`),
  KEY `idx_appointment_customer` (`customer_id`),
  KEY `idx_appointments_portal_customer` (`portal_customer_id`),
  CONSTRAINT `fk_appointment_customer` FOREIGN KEY (`customer_id`) REFERENCES `appointment_customers` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_appointments_portal_customer` FOREIGN KEY (`portal_customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `appointments`
--

LOCK TABLES `appointments` WRITE;
/*!40000 ALTER TABLE `appointments` DISABLE KEYS */;
INSERT INTO `appointments` VALUES (1,1,1,'Reinigungsservice','Privathaushalt','Testweg 1','99084','Erfurt',50,'2026-12-05','10:00:00','11:00:00',60,'Test','pending','2026-11-11 11:11:23','2026-11-11 11:42:38'),(2,2,NULL,'Reinigungsservice','Privathaushalt','Testweg 1','99084','Erfurt',50,'2026-12-05','11:00:00','12:00:00',60,'','pending','2026-11-11 11:11:33','2026-11-11 11:11:33'),(3,3,NULL,'Reinigungsservice','Privathaushalt','Testweg 1','99084','Erfurt',50,'2026-12-05','09:00:00','10:00:00',60,'','pending','2026-11-11 11:12:00','2026-11-11 11:12:00');
/*!40000 ALTER TABLE `appointments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `career_applications`
--

DROP TABLE IF EXISTS `career_applications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `career_applications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `full_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `area` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'new',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_career_created_at` (`created_at`),
  KEY `idx_career_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `career_applications`
--

LOCK TABLES `career_applications` WRITE;
/*!40000 ALTER TABLE `career_applications` DISABLE KEYS */;
INSERT INTO `career_applications` VALUES (1,'farima','faaf@bab.com','028989852','Reinigung','hsfkhslghsl','new','2026-11-06 12:56:05');
/*!40000 ALTER TABLE `career_applications` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `contact_submissions`
--

DROP TABLE IF EXISTS `contact_submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `contact_submissions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `full_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `requested_service` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'new',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contact_created_at` (`created_at`),
  KEY `idx_contact_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `contact_submissions`
--

LOCK TABLES `contact_submissions` WRITE;
/*!40000 ALTER TABLE `contact_submissions` DISABLE KEYS */;
INSERT INTO `contact_submissions` VALUES (1,'nikaml','fari@gmail.com','Reinigungsservice','snkjnkasnan','new','2026-11-06 12:52:43');
/*!40000 ALTER TABLE `contact_submissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `customers`
--

DROP TABLE IF EXISTS `customers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customers` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `customer_number` varchar(40) NOT NULL,
  `first_name` varchar(80) NOT NULL,
  `last_name` varchar(80) NOT NULL,
  `email` varchar(254) NOT NULL,
  `phone` varchar(40) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `status` enum('active','inactive','blocked') NOT NULL DEFAULT 'active',
  `address` varchar(180) DEFAULT NULL,
  `postal_code` varchar(16) DEFAULT NULL,
  `city` varchar(120) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_login_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_email` (`email`),
  UNIQUE KEY `uq_customer_number` (`customer_number`),
  KEY `idx_customer_status_created` (`status`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customers`
--

LOCK TABLES `customers` WRITE;
/*!40000 ALTER TABLE `customers` DISABLE KEYS */;
INSERT INTO `customers` VALUES (1,'KU-2026-000001','TEST','CUSTOMER A','phase5-a@example.test','+49111111111','scrypt$048eb5b0565b16b3e0eff03334668fa3$56d06cf3d8c9cad3fc8facc8273e48c3c92a6ed01b055931153f1078078b22937026f696980116850ae37d583bb568a57ba7912eaaedf14eb58f6e52b7f81013','active',NULL,NULL,NULL,'2026-11-11 11:42:18','2026-11-12 11:43:27','2026-11-11 12:34:49'),(2,'KU-2026-000002','TEST','CUSTOMER B','phase5-b@example.test','+49111111111','scrypt$3c3ca1cd4479dcff2cef8b591ddea291$8e1bc4c0c2083a46271116ed5d468bbe79bbe0b272698dc8078a5c4ac74631041b78318959601cd23a551a1001e08ddbad9aef81a04a8dbe599f1a20152470db','active',NULL,NULL,NULL,'2026-11-11 11:42:18','2026-11-12 11:43:27',NULL);
/*!40000 ALTER TABLE `customers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `employee_invitations`
--

DROP TABLE IF EXISTS `employee_invitations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_invitations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `employee_id` bigint unsigned NOT NULL,
  `token_hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `accepted_at` datetime DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `created_by` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employee_invite_token` (`token_hash`),
  KEY `idx_employee_invitation_employee` (`employee_id`,`accepted_at`,`revoked_at`),
  KEY `idx_employee_invitation_expiry` (`expires_at`),
  CONSTRAINT `fk_employee_invitation_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `employee_invitations`
--

LOCK TABLES `employee_invitations` WRITE;
/*!40000 ALTER TABLE `employee_invitations` DISABLE KEYS */;
INSERT INTO `employee_invitations` VALUES (1,1,'29c93fac04af930563ac4d74cde915f78c9ddea95b2484bc74ee989979dce9f9','2026-11-15 10:24:24',NULL,'2026-11-12 10:25:00','admin','2026-11-12 09:24:23'),(2,1,'907f52ba8f84fcc2d8f98ef1748c21bba847368db94abc6ae4b1150e4d34d85f','2026-11-15 10:25:01',NULL,'2026-11-12 11:24:16','admin','2026-11-12 09:25:00'),(3,1,'0064297fb2a1b27111de625e0ca2ad9fb1765b079b371131086148d689ec4076','2026-11-15 11:24:16',NULL,'2026-11-12 11:31:03','admin','2026-11-12 10:24:16'),(4,1,'eaa24c33e8079fdcebf31d5e024b10d988119d3b5a3278e2681e0c41606e3a3e','2026-11-15 11:31:04',NULL,'2026-11-12 11:38:19','admin','2026-11-12 10:31:03'),(5,1,'82c5a1d6d11b9e5f22f5b9d53291f8f90794bba19020be933c9799d23e8d3ec1','2026-11-15 11:38:20',NULL,'2026-11-12 11:43:31','admin','2026-11-12 10:38:19'),(6,1,'366e1a1b3ff3f93cef67f596996700ef9a38269708d5b8affd6b5990706491c8','2026-11-15 11:43:32','2026-11-12 11:45:50',NULL,'admin','2026-11-12 10:43:31');
/*!40000 ALTER TABLE `employee_invitations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `employee_tasks`
--

DROP TABLE IF EXISTS `employee_tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_tasks` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `employee_id` bigint unsigned NOT NULL,
  `title` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `employee_notes` text COLLATE utf8mb4_unicode_ci,
  `customer_id` bigint unsigned DEFAULT NULL,
  `appointment_id` bigint unsigned DEFAULT NULL,
  `status` enum('OPEN','IN_PROGRESS','COMPLETED','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `priority` enum('LOW','NORMAL','HIGH','URGENT') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NORMAL',
  `scheduled_date` date DEFAULT NULL,
  `start_time` time DEFAULT NULL,
  `end_time` time DEFAULT NULL,
  `created_by` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_employee_status_date` (`employee_id`,`status`,`scheduled_date`),
  KEY `idx_task_customer` (`customer_id`),
  KEY `idx_task_appointment` (`appointment_id`),
  CONSTRAINT `fk_task_appointment` FOREIGN KEY (`appointment_id`) REFERENCES `appointments` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_task_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_task_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `employee_tasks`
--

LOCK TABLES `employee_tasks` WRITE;
/*!40000 ALTER TABLE `employee_tasks` DISABLE KEYS */;
INSERT INTO `employee_tasks` VALUES (1,2,'TEST DATA ? Phase 6 task A','TEST DATA ? Phase 6','TEST DATA ? status update',NULL,NULL,'IN_PROGRESS','NORMAL','2026-11-12',NULL,NULL,'phase6-test','2026-11-12 10:27:57','2026-11-12 10:27:58'),(2,3,'TEST DATA ? Phase 6 task B','TEST DATA ? Phase 6',NULL,NULL,NULL,'OPEN','NORMAL','2026-11-12',NULL,NULL,'phase6-test','2026-11-12 10:27:57','2026-11-12 10:27:57');
/*!40000 ALTER TABLE `employee_tasks` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `employee_work_logs`
--

DROP TABLE IF EXISTS `employee_work_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee_work_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `employee_id` bigint unsigned NOT NULL,
  `task_id` bigint unsigned DEFAULT NULL,
  `work_date` date NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `break_minutes` smallint unsigned NOT NULL DEFAULT '0',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_work_log_employee_date` (`employee_id`,`work_date`),
  KEY `idx_work_log_task` (`task_id`),
  CONSTRAINT `fk_work_log_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_work_log_task` FOREIGN KEY (`task_id`) REFERENCES `employee_tasks` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `employee_work_logs`
--

LOCK TABLES `employee_work_logs` WRITE;
/*!40000 ALTER TABLE `employee_work_logs` DISABLE KEYS */;
INSERT INTO `employee_work_logs` VALUES (1,2,1,'2026-11-12','09:00:00','10:00:00',0,'TEST DATA ? Phase 6 work log','2026-11-12 10:27:58','2026-11-12 10:27:58');
/*!40000 ALTER TABLE `employee_work_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `employees`
--

DROP TABLE IF EXISTS `employees`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employees` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `first_name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('EMPLOYEE','MANAGER','ADMIN') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'EMPLOYEE',
  `status` enum('ACTIVE','INACTIVE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
  `employee_number` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `position` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hire_date` date DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `last_login_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employee_email` (`email`),
  UNIQUE KEY `uq_employee_number` (`employee_number`),
  KEY `idx_employee_status_role` (`status`,`role`),
  KEY `idx_employee_name` (`last_name`,`first_name`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `employees`
--

LOCK TABLES `employees` WRITE;
/*!40000 ALTER TABLE `employees` DISABLE KEYS */;
INSERT INTO `employees` VALUES (1,'Farima','Nikmal','farima.nhm@gmail.com','0191919199','scrypt$67cfc757c4fff437295a2c8f261e718d$b6498604220b833e7a4c09962546d559f39c4de4fbaf4379e8b531b787cc5eb49e99e3255d68fa3bf97d5bd35845327d907232aead3c3c5cd0d96d40b8afdb06','EMPLOYEE','ACTIVE','121212','manger','2026-11-04','aaklaflkaallskvasksökvsvks','2026-11-12 10:45:50','2026-11-12 09:24:23','2026-11-12 10:45:50'),(2,'Employee','A','phase6.employee.a@invalid.local','+491111111111','scrypt$ac18f34d05988ce611f419097f60096f$fb227da5d89eaf228076f9a7319a4e9939cd125ace4a24e44accafb041cb02bb4b9d25c4181bc5a34dc75bb6f20451bf3a739cb915864ed82c920f3d700b795f','EMPLOYEE','ACTIVE','TEST-P6-A','TEST DATA ? Phase 6','2026-11-12','TEST DATA ? Phase 6 Employee A','2026-11-12 10:28:27','2026-11-12 10:26:48','2026-11-12 10:28:27'),(3,'Employee','B','phase6.employee.b@invalid.local','+492222222222','scrypt$b9eba11fa36980e4c5197a76445a2318$b779883baa1e645f1bbc35bf4d66dab2067470fc95f31c947a51d9dff503c11181643bcf943ffb9bb281d70555a4a755d1b87b667a1a1fc891f793f9624845b8','EMPLOYEE','ACTIVE','TEST-P6-B','TEST DATA ? Phase 6','2026-11-12','TEST DATA ? Phase 6 Employee B','2026-11-12 10:28:27','2026-11-12 10:26:48','2026-11-12 10:28:27');
/*!40000 ALTER TABLE `employees` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `quote_request_files`
--

DROP TABLE IF EXISTS `quote_request_files`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quote_request_files` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `quote_request_id` bigint unsigned NOT NULL,
  `original_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stored_name` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime_type` enum('image/jpeg','image/png','application/pdf') COLLATE utf8mb4_unicode_ci NOT NULL,
  `size_bytes` int unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quote_file_stored_name` (`stored_name`),
  KEY `idx_quote_file_request` (`quote_request_id`),
  CONSTRAINT `fk_quote_file_request` FOREIGN KEY (`quote_request_id`) REFERENCES `quote_requests` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quote_request_files`
--

LOCK TABLES `quote_request_files` WRITE;
/*!40000 ALTER TABLE `quote_request_files` DISABLE KEYS */;
INSERT INTO `quote_request_files` VALUES (1,2,'reinigung.jpg','0d198e1a-f93a-4af9-b256-246aa1a87065','image/jpeg',268343,'2026-11-11 10:06:38'),(2,3,'phase3-upload-test.pdf','01d3ca96-cb22-4b23-aeb6-78659e4f4c1a','application/pdf',218,'2026-11-11 10:08:51');
/*!40000 ALTER TABLE `quote_request_files` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `quote_requests`
--

DROP TABLE IF EXISTS `quote_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quote_requests` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `customer_id` bigint unsigned DEFAULT NULL,
  `first_name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company` varchar(160) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(254) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `object_type` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `address` varchar(180) COLLATE utf8mb4_unicode_ci NOT NULL,
  `postal_code` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `city` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `requested_service` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `area_m2` smallint unsigned DEFAULT NULL,
  `frequency` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `preferred_period` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `preferred_date` date DEFAULT NULL,
  `message` text COLLATE utf8mb4_unicode_ci,
  `additional_information` text COLLATE utf8mb4_unicode_ci,
  `status` enum('new','in_progress','offer_sent','accepted','declined','completed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'new',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_quote_created_at` (`created_at`),
  KEY `idx_quote_status` (`status`),
  KEY `idx_quote_email` (`email`),
  KEY `idx_quotes_customer` (`customer_id`),
  CONSTRAINT `fk_quotes_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quote_requests`
--

LOCK TABLES `quote_requests` WRITE;
/*!40000 ALTER TABLE `quote_requests` DISABLE KEYS */;
INSERT INTO `quote_requests` VALUES (1,NULL,'Test','Kunde',NULL,'test@example.com','+49 999999999','Privathaushalt','Teststra�e 1','97421','Schweinfurt','Fensterreinigung',80,'Einmalig',NULL,'2026-12-01','Testanfrage f�r Phase 3',NULL,'accepted','2026-11-11 10:06:24','2026-11-11 10:08:05'),(2,NULL,'Upload','Test',NULL,'upload@example.com','+49999999999','Büro','Testweg 2','97421','Schweinfurt','Büroreinigung',120,'Einmalig',NULL,'2026-12-02','Upload-Test Phase 3',NULL,'new','2026-11-11 10:06:38','2026-11-11 10:06:38'),(3,NULL,'Pdf','Test',NULL,'pdf@example.com','+49999999999','Privathaushalt','Testweg 4','97421','Schweinfurt','Fensterreinigung',NULL,NULL,NULL,NULL,NULL,NULL,'new','2026-11-11 10:08:50','2026-11-11 10:08:50');
/*!40000 ALTER TABLE `quote_requests` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `task_documents`
--

DROP TABLE IF EXISTS `task_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task_documents` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `task_id` bigint unsigned NOT NULL,
  `employee_id` bigint unsigned NOT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stored_file_name` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime_type` enum('image/jpeg','image/png','application/pdf') COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_size` int unsigned NOT NULL,
  `storage_path` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_task_document_stored_name` (`stored_file_name`),
  KEY `idx_task_document_task` (`task_id`),
  KEY `idx_task_document_employee` (`employee_id`),
  CONSTRAINT `fk_task_document_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_task_document_task` FOREIGN KEY (`task_id`) REFERENCES `employee_tasks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `task_documents`
--

LOCK TABLES `task_documents` WRITE;
/*!40000 ALTER TABLE `task_documents` DISABLE KEYS */;
INSERT INTO `task_documents` VALUES (1,1,2,'test.pdf','c75d31cc-f30f-4206-861c-059c2ca42f56','application/pdf',15,'employee-documents\\c75d31cc-f30f-4206-861c-059c2ca42f56.pdf','TEST DATA ? Phase 6 upload','2026-11-12 10:27:58'),(2,1,2,'test.jpg','08fa8311-5dfc-437c-b8c8-7c5f83c4051f','image/jpeg',4,'employee-documents\\08fa8311-5dfc-437c-b8c8-7c5f83c4051f.jpg','TEST DATA ? Phase 6 binary upload','2026-11-12 10:28:27'),(3,1,2,'test.png','6402ee3f-3d6f-464f-adb5-aa3af355e10c','image/png',8,'employee-documents\\6402ee3f-3d6f-464f-adb5-aa3af355e10c.png','TEST DATA ? Phase 6 binary upload','2026-11-12 10:28:27');
/*!40000 ALTER TABLE `task_documents` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'zoicas_osinski'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-12 12:49:43
