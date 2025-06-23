const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const url = require('url');
const querystring = require('querystring');

const PORT = 3000;

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
setupDatabase();

// Database connection settings
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '123123123',
    database: 'todolist',
};

async function retrieveListItems() {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'SELECT id, text FROM items ORDER BY id';
        const [rows] = await connection.execute(query);
        await connection.end();
        return rows;
    } catch (error) {
        console.error('Error retrieving list items:', error);
        throw error;
    }
}

async function addListItem(text) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'INSERT INTO items (text) VALUES (?)';
        const [result] = await connection.execute(query, [text]);
        await connection.end();
        return result.insertId;
    } catch (error) {
        console.error('Error adding list item:', error);
        throw error;
    }
}

async function removeListItem(id) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'DELETE FROM items WHERE id = ?';
        await connection.execute(query, [id]);
        await connection.end();
        return true;
    } catch (error) {
        console.error('Error removing list item:', error);
        throw error;
    }
}

async function getHtmlRows() {
    const todoItems = await retrieveListItems();
    return todoItems.map(item => `
        <tr id="row-${item.id}">
            <td>${item.id}</td>
            <td>${item.text}</td>
            <td>
                <button class="edit-btn" onclick="openEditModal(${item.id}, '${item.text.replace(/'/g, "\\'")}')">
                    Edit
                </button>
                <button class="delete-btn" onclick="removeItem(${item.id}, this.parentNode.parentNode)">
                    Delete
                </button>
            </td>
        </tr>
    `).join('');
}

async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    
    if (parsedUrl.pathname === '/' && req.method === 'GET') {
        try {
            const html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            const processedHtml = html.replace('{{rows}}', await getHtmlRows());
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(processedHtml);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading page');
        }
    }
    else if (parsedUrl.pathname === '/add' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { text } = JSON.parse(body);
                const connection = await mysql.createConnection(dbConfig);
                const [result] = await connection.execute(
                    'INSERT INTO items (text) VALUES (?)',
                    [text]
                );
                await connection.end();
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    id: result.insertId, 
                    text: text 
                }));
            } catch (error) {
                console.error(error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to add item' }));
            }
        });
    }
    else if (parsedUrl.pathname.startsWith('/remove/') && req.method === 'DELETE') {
        try {
            const id = parsedUrl.pathname.split('/')[2];
            const success = await removeListItem(id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success }));
        } catch (error) {
            console.error(error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to remove item' }));
        }
    }
    else if (parsedUrl.pathname.startsWith('/edit/') && req.method === 'PUT') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const id = parsedUrl.pathname.split('/')[2];
                const { text } = JSON.parse(body);
                const connection = await mysql.createConnection(dbConfig);
                await connection.execute(
                    'UPDATE items SET text = ? WHERE id = ?',
                    [text, id]
                );
                await connection.end();
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error(error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to update item' }));
            }
        });
    }
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));