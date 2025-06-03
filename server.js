const express = require('express');
const mysql = require('mysql2');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 👉 SESSION middleware (phải đặt trước route!)
app.use(session({
  secret: 'random-secret-key', // đổi chuỗi này khi triển khai thực tế
  resave: false,
  saveUninitialized: false
}));

// 👉 Body parsers (cũng phải đặt trước route)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Kết nối MySQL
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'website_db'
});

db.connect((err) => {
  if (err) {
    console.error('Lỗi kết nối MySQL: ', err);
    process.exit(1);
  }
  console.log('Kết nối MySQL thành công!');
});

// Middleware bảo vệ admin
function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.is_admin) {
    return res.status(403).json({ success: false, message: "Không có quyền admin" });
  }
  next();
}

// Trạng thái game
let gameState = { round: 1, countdown: 60, bettingLocked: false, currentNumber: null };
let currentBets = [];

db.query('SELECT current_round FROM game_state WHERE id = 1', (err, result) => {
  if (!err && result.length > 0) {
    gameState.round = result[0].current_round;
  }
});

io.on('connection', (socket) => {
  socket.on('joinRoom', (userId) => {
    socket.join(userId.toString());
  });
});

setInterval(() => {
  gameState.countdown--;
  gameState.bettingLocked = gameState.countdown <= 10;
  io.emit('gameState', gameState);

  if (gameState.countdown <= 0) {
    let randomNumber = Math.floor(Math.random() * 51);
    let formattedNumber = randomNumber < 10 ? '0' + randomNumber : '' + randomNumber;
    gameState.currentNumber = formattedNumber;

    currentBets.forEach(bet => {
      let isEven = (randomNumber % 2 === 0);
      let win = (bet.choice === 'CHẴN' && isEven) || (bet.choice === 'LẺ' && !isEven);

      if (win) {
        let winAmount = bet.betAmount * 1.9;
        db.query('UPDATE users SET balance = balance + ? WHERE id = ?', [winAmount, bet.userId], (err) => {
          if (!err) {
            db.query('SELECT balance FROM users WHERE id = ?', [bet.userId], (err, rows) => {
              if (!err && rows.length > 0) {
                io.to(bet.userId.toString()).emit('balanceUpdate', rows[0].balance);
              }
            });
          }
        });
      }
    });

    io.emit('roundResult', { round: gameState.round, number: formattedNumber });
    gameState.round++;
    db.query('UPDATE game_state SET current_round = ? WHERE id = 1', [gameState.round]);
    gameState.countdown = 60;
    gameState.bettingLocked = false;
    gameState.currentNumber = null;
    currentBets = [];
  }
}, 1000);

// ROUTES

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  db.query("INSERT INTO users (username, password, balance) VALUES (?, ?, 10000000)", [username, password], (err) => {
    if (err) return res.json({ success: false, message: "Lỗi khi đăng ký" });
    res.json({ success: true, message: "Đăng ký thành công" });
  });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.query("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, results) => {
    if (err) return res.json({ success: false, message: "Lỗi server" });
    if (results.length > 0) {
      req.session.user = results[0];
      return res.json({ success: true, user: results[0] });
    } else {
      return res.json({ success: false, message: "Sai tài khoản hoặc mật khẩu" });
    }
  });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.post('/bet', (req, res) => {
  const { userId, betAmount, choice } = req.body;
  db.query("SELECT balance FROM users WHERE id = ?", [userId], (err, results) => {
    if (err || results.length === 0) return res.status(500).json({ success: false });
    const balance = results[0].balance;
    if (betAmount > balance) return res.json({ success: false, message: "Số dư không đủ" });

    db.query("UPDATE users SET balance = balance - ? WHERE id = ?", [betAmount, userId], (err) => {
      if (err) return res.status(500).json({ success: false });
      db.query("SELECT balance FROM users WHERE id = ?", [userId], (err, resultBalance) => {
        if (err) return res.status(500).json({ success: false });

        const newBalance = resultBalance[0].balance;
        currentBets.push({ userId, betAmount, choice });

        db.query("INSERT INTO predictions (user_id, bet_amount, choice) VALUES (?, ?, ?)",
          [userId, betAmount, choice]);

        let totalEven = 0, totalOdd = 0;
        currentBets.forEach(bet => {
          if (bet.choice === 'CHẴN') totalEven += bet.betAmount;
          else if (bet.choice === 'LẺ') totalOdd += bet.betAmount;
        });

        io.emit('betTotals', { totalEven, totalOdd });
        res.json({ success: true, newBalance });
      });
    });
  });
});

app.post('/api/napthe', (req, res) => {
  const { username, card_type, amount, pin, serial } = req.body;
  if (!username || !card_type || !amount || !pin || !serial) {
    return res.status(400).json({ success: false, message: "Thiếu thông tin." });
  }

  db.query(`INSERT INTO card_requests (username, card_type, amount, pin, serial) VALUES (?, ?, ?, ?, ?)`,
    [username, card_type, amount, pin, serial], (err) => {
      if (err) return res.json({ success: false, message: 'Lỗi ghi dữ liệu nạp thẻ' });
      res.json({ success: true, message: 'Đã gửi yêu cầu nạp, admin sẽ duyệt thủ công.' });
    });
});

app.get('/api/admin/card-requests', requireAdmin, (req, res) => {
  db.query("SELECT * FROM card_requests WHERE status = 'pending'", (err, results) => {
    if (err) return res.status(500).json([]);
    res.json(results);
  });
});

app.post('/api/admin/approve', requireAdmin, (req, res) => {
  const { id, username, amount } = req.body;

  db.query("UPDATE users SET balance = balance + ? WHERE username = ?", [amount * 10000, username], (err) => {
    if (err) return res.status(500).json({ success: false });

    db.query("SELECT id, balance FROM users WHERE username = ?", [username], (err2, result) => {
      if (!err2 && result.length > 0) {
        const user = result[0];
        io.to(user.id.toString()).emit('balanceUpdate', user.balance);

        // ✅ Chỉ trả kết quả sau khi socket đã gửi xong
        db.query("UPDATE card_requests SET status = 'approved', approved_at = NOW() WHERE id = ?", [id], () => {
          res.json({ success: true });
        });
      } else {
        res.status(500).json({ success: false, message: "Không tìm thấy người dùng" });
      }
    });
  });
});



app.get('/api/admin/users', requireAdmin, (req, res) => {
  db.query("SELECT id, username, balance, is_admin, banned FROM users", (err, results) => {
    if (err) return res.status(500).json([]);
    res.json(results);
  });
});

app.post('/api/admin/ban', requireAdmin, (req, res) => {
  const { id } = req.body;
  db.query("UPDATE users SET banned = 1 WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true });
  });
});

app.post('/api/admin/add-gold', requireAdmin, (req, res) => {
  const { id, amount } = req.body;
  db.query("UPDATE users SET balance = balance + ? WHERE id = ?", [amount, id], (err) => {
    if (err) return res.status(500).json({ success: false });
    res.json({ success: true });
  });
});

app.get('/api/napthe/history/:username', (req, res) => {
  const { username } = req.params;
  db.query("SELECT * FROM card_requests WHERE username = ? ORDER BY created_at DESC", [username], (err, results) => {
    if (err) return res.status(500).json([]);
    res.json(results);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server đang chạy ở cổng ${port}`);
});
