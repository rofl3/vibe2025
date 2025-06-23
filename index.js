const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const url = require('url');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookie = require('cookie');

const PORT = 3000;
const JWT_SECRET = 'your_very_strong_secret_here';
const SALT_ROUNDS = 10;

// Database configuration
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '123123123',
    database: 'todolist'
};

async function setupDatabase() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '123123123'
  });

  // Читаем SQL-файл
  const sql = fs.readFileSync('./db.sql', 'utf8');
  
  // Разбиваем на отдельные запросы
  const queries = sql.split(';').filter(query => query.trim() !== '');

  // Выполняем каждый запрос по очереди
  for (const query of queries) {
    await connection.query(query);
  }

  console.log("✅ База данных создана!");
  await connection.end();
}

// Auth middleware
function authenticate(req, res, next) {
    const cookies = cookie.parse(req.headers.cookie || '');
    const token = cookies.token;
    
    if (!token) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid token' }));
    }
}

// Auth functions
async function registerUser(username, password) {
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const connection = await mysql.createConnection(dbConfig);
    const [result] = await connection.execute(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [username, hashedPassword]
    );
    await connection.end();
    return result.insertId;
}

async function loginUser(username, password) {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
        'SELECT * FROM users WHERE username = ?',
        [username]
    );
    await connection.end();

    if (rows.length === 0) return null;

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    return isMatch ? user : null;
}

// Todo functions
async function retrieveListItems(userId) {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
        'SELECT id, text FROM items WHERE user_id = ? ORDER BY id',
        [userId]
    );
    await connection.end();
    return rows;
}

async function addListItem(text, userId) {
    const connection = await mysql.createConnection(dbConfig);
    const [result] = await connection.execute(
        'INSERT INTO items (text, user_id) VALUES (?, ?)',
        [text, userId]
    );
    await connection.end();
    return { id: result.insertId, text };
}

async function removeListItem(id, userId) {
    const connection = await mysql.createConnection(dbConfig);
    await connection.execute(
        'DELETE FROM items WHERE id = ? AND user_id = ?',
        [id, userId]
    );
    await connection.end();
}

// Server request handler
async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);

    // Public routes
    if (parsedUrl.pathname === '/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { username, password } = JSON.parse(body);
                const user = await loginUser(username, password);
                
                if (!user) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Invalid credentials' }));
                }

                const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });

                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Set-Cookie': cookie.serialize('token', token, {
                        httpOnly: true,
                        maxAge: 60 * 60,
                        sameSite: 'strict',
                        path: '/'
                    })
                });
                res.end(JSON.stringify({ message: 'Login successful' }));
            } catch (error) {
                console.error(error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Login failed' }));
            }
        });
    }
    else if (parsedUrl.pathname === '/register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { username, password } = JSON.parse(body);
                await registerUser(username, password);
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Registration successful' }));
            } catch (error) {
                console.error(error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Registration failed' }));
            }
        });
    }
    // Protected routes
    else if (parsedUrl.pathname === '/' && req.method === 'GET') {
        try {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading page');
        }
    }
    else if (parsedUrl.pathname === '/api/todos' && req.method === 'GET') {
        authenticate(req, res, async () => {
            try {
                const items = await retrieveListItems(req.user.id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(items));
            } catch (error) {
                console.error(error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to fetch todos' }));
            }
        });
    }
    else if (parsedUrl.pathname === '/api/todos' && req.method === 'POST') {
        authenticate(req, res, async () => {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const { text } = JSON.parse(body);
                    const newItem = await addListItem(text, req.user.id);
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(newItem));
                } catch (error) {
                    console.error(error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Failed to add todo' }));
                }
            });
        });
    }
    else if (parsedUrl.pathname.startsWith('/api/todos/') && req.method === 'DELETE') {
        authenticate(req, res, async () => {
            try {
                const id = parsedUrl.pathname.split('/')[3];
                await removeListItem(id, req.user.id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error(error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to remove todo' }));
            }
        });
    }
    else if (parsedUrl.pathname.startsWith('/api/todos/') && req.method === 'PUT') {
        authenticate(req, res, async () => {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const id = parsedUrl.pathname.split('/')[3];
                    const { text } = JSON.parse(body);
                    
                    const connection = await mysql.createConnection(dbConfig);
                    await connection.execute(
                        'UPDATE items SET text = ? WHERE id = ? AND user_id = ?',
                        [text, id, req.user.id]
                    );
                    await connection.end();
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (error) {
                    console.error(error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Failed to update task' }));
                }
            });
        });
    }
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
}

// Initialize database and start server
setupDatabase().then(() => {
    const server = http.createServer(handleRequest);
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});