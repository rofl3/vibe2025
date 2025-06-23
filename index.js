const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const url = require('url');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookie = require('cookie');
const crypto = require('crypto');
const fetch = require('node-fetch');

const PORT = 3000;
const JWT_SECRET = 'your_very_strong_secret_here';
const SALT_ROUNDS = 10;

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '123123123',
    database: 'todolist'
};

async function setupDatabase() {
    const connection = await mysql.createConnection({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password
    });
    const sql = fs.readFileSync('./db.sql', 'utf8');
    const queries = sql.split(';').filter(q => q.trim());
    for (const query of queries) await connection.query(query);
    await connection.end();
}

async function sendTelegramMessage(telegramId, text) {
    const BOT_TOKEN = 'Token'; // твой токен бота
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramId,
                text: text
            })
        });
        const data = await res.json();
        if (!data.ok) {
            console.error('Telegram API error:', data);
        }
    } catch (err) {
        console.error('Failed to send Telegram message:', err);
    }
}

// Middleware
function authenticate(req, res, next) {
    const cookies = cookie.parse(req.headers.cookie || '');
    const token = cookies.token;
    if (!token) return res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' }));

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.writeHead(401).end(JSON.stringify({ error: 'Invalid token' }));
    }
}

// Register/Login
async function registerUser(username, password) {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const token = crypto.randomBytes(16).toString('hex');
    const conn = await mysql.createConnection(dbConfig);
    await conn.execute('INSERT INTO users (username, password, telegram_link_token) VALUES (?, ?, ?)', [username, hashedPassword, token]);
    await conn.end();
}

async function loginUser(username, password) {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute('SELECT * FROM users WHERE username = ?', [username]);
    await conn.end();
    if (!rows.length) return null;
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    return match ? user : null;
}

async function getTelegramId(user_id) {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute('SELECT telegram_id FROM users WHERE id = ?', [user_id]);
    await connection.end();

    const telegramId = rows[0]?.telegram_id;
    return telegramId;
}

async function retrieveListItems(userId) {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute('SELECT id, text FROM items WHERE user_id = ?', [userId]);
    await conn.end();
    return rows;
}

async function addListItem(text, userId) {
    const conn = await mysql.createConnection(dbConfig);
    const [res] = await conn.execute('INSERT INTO items (text, user_id) VALUES (?, ?)', [text, userId]);
    await conn.end();
    return { id: res.insertId, text };
}

async function removeListItem(id, userId) {
    const conn = await mysql.createConnection(dbConfig);
    await conn.execute('DELETE FROM items WHERE id = ? AND user_id = ?', [id, userId]);
    await conn.end();
}

async function updateTask(id, userId, text) {
    const conn = await mysql.createConnection(dbConfig);
    await conn.execute('UPDATE items SET text = ? WHERE id = ? AND user_id = ?', [text, id, userId]);
    await conn.end();
}

async function getTelegramToken(userId) {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute('SELECT telegram_link_token FROM users WHERE id = ?', [userId]);
    await conn.end();
    return rows[0]?.telegram_link_token;
}

// Telegram linking
async function linkTelegram(token, telegramId) {
    const conn = await mysql.createConnection(dbConfig);
    await conn.execute('UPDATE users SET telegram_id = ? WHERE telegram_link_token = ?', [telegramId, token]);
    await conn.end();
}

async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);

    // Serve index.html
    if (parsedUrl.pathname === '/' && req.method === 'GET') {
        const html = await fs.promises.readFile('./index.html', 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(html);
    }

    // Login
    if (parsedUrl.pathname === '/login' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
            const { username, password } = JSON.parse(body);
            const user = await loginUser(username, password);
            if (!user) return res.writeHead(401).end(JSON.stringify({ error: 'Invalid credentials' }));
            const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
            res.writeHead(200, {
                'Set-Cookie': cookie.serialize('token', token, { httpOnly: true, maxAge: 3600, path: '/' }),
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({ message: 'Login success' }));
        });
    }

    // Register
    else if (parsedUrl.pathname === '/register' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
            const { username, password } = JSON.parse(body);
            await registerUser(username, password);
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Registered' }));
        });
    }

    // Get Telegram token
    else if (parsedUrl.pathname === '/api/telegram_token' && req.method === 'GET') {
        authenticate(req, res, async () => {
            const token = await getTelegramToken(req.user.id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ token }));
        });
    }

    // Telegram link endpoint
    else if (parsedUrl.pathname === '/api/link_telegram' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', async () => {
            const { token, telegram_id } = JSON.parse(body);
            await linkTelegram(token, telegram_id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
    }

    // Todos
    else if (parsedUrl.pathname === '/api/todos') {
        authenticate(req, res, async () => {
            if (req.method === 'GET') {
                const items = await retrieveListItems(req.user.id);
                return res.end(JSON.stringify(items));
            }
            if (req.method === 'POST') {
                let body = '';
                req.on('data', c => body += c);
                req.on('end', async () => {
                    const { text } = JSON.parse(body);
                    const newItem = await addListItem(text, req.user.id);
                    const connection = await mysql.createConnection(dbConfig);
                    const [rows] = await connection.execute('SELECT telegram_id FROM users WHERE id = ?', [req.user.id]);
                    await connection.end();

                    const telegramId = rows[0]?.telegram_id;
                    if (telegramId) {
                        sendTelegramMessage(telegramId, `🆕 Добавлена новая задача: "${newItem.text}"`);
                    }
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(newItem));
                });
            }
        });
    }

    else if (parsedUrl.pathname.startsWith('/api/todos/') && ['DELETE', 'PUT'].includes(req.method)) {
        authenticate(req, res, async () => {
            const id = parsedUrl.pathname.split('/')[3];
            if (req.method === 'DELETE') {
                await removeListItem(id, req.user.id);
                const connection = await mysql.createConnection(dbConfig);
                const [rows] = await connection.execute('SELECT telegram_id FROM users WHERE id = ?', [req.user.id]);
                await connection.end();

                const telegramId = rows[0]?.telegram_id;
                if (telegramId) {
                    sendTelegramMessage(telegramId, `🆕 Удалена задача!`);
                }
                return res.end(JSON.stringify({ success: true }));
            }
            if (req.method === 'PUT') {
                let body = '';
                req.on('data', c => body += c);
                req.on('end', async () => {
                    const { text } = JSON.parse(body);
                    await updateTask(id, req.user.id, text);
                    const connection = await mysql.createConnection(dbConfig);
                    const [rows] = await connection.execute('SELECT telegram_id FROM users WHERE id = ?', [req.user.id]);
                    await connection.end();

                    const telegramId = rows[0]?.telegram_id;
                    if (telegramId) {
                        sendTelegramMessage(telegramId, `🆕 Отредактирована задача!`);
                    }
                    res.end(JSON.stringify({ success: true }));
                });
            }
        });
    }

    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
}

setupDatabase().then(() => {
    http.createServer(handleRequest).listen(PORT, () => console.log('Server running on port', PORT));
});
