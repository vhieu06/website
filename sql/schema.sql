-- Tạo database nếu chưa có
CREATE DATABASE IF NOT EXISTS website_db;
USE website_db;

-- Bảng users với trường balance cho số dư
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  balance DECIMAL(15,2) DEFAULT 0
);

-- Bảng predictions lưu thông tin cược
CREATE TABLE IF NOT EXISTS predictions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  bet_amount DECIMAL(15,2) NOT NULL,
  choice ENUM('CHẴN', 'LẺ') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Bảng game_state để lưu phiên hiện tại
CREATE TABLE IF NOT EXISTS game_state (
  id INT PRIMARY KEY,
  current_round INT NOT NULL
);

-- Thêm dòng mặc định nếu chưa có
INSERT INTO game_state (id, current_round)
SELECT 1, 1
WHERE NOT EXISTS (SELECT 1 FROM game_state WHERE id = 1);
-- Bảng lưu yêu cầu nạp thẻ chờ admin duyệt
CREATE TABLE IF NOT EXISTS card_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  card_type VARCHAR(20) NOT NULL,
  amount INT NOT NULL,
  pin VARCHAR(100) NOT NULL,
  serial VARCHAR(100) NOT NULL,
  status ENUM('pending','approved') DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME NULL
);
ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;
UPDATE users SET is_admin = TRUE WHERE username = 'admin';
ALTER TABLE users ADD COLUMN banned BOOLEAN DEFAULT FALSE;
ALTER TABLE card_requests ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP;

