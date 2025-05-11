// Check and install required dependencies
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Function to check if a package is installed
function isPackageInstalled(packageName) {
    try {
        require.resolve(packageName);
        return true;
    } catch (e) {
        return false;
    }
}

// Function to install missing packages
function installMissingPackages() {
    console.log('🔍 Checking for required packages...');
    
    const requiredPackages = ['ws', 'nodemailer', 'mysql2'];
    const missingPackages = [];
    
    for (const pkg of requiredPackages) {
        if (!isPackageInstalled(pkg)) {
            missingPackages.push(pkg);
        }
    }
    
    if (missingPackages.length > 0) {
        console.log(`📦 Installing missing packages: ${missingPackages.join(', ')}`);
        try {
            execSync(`npm install ${missingPackages.join(' ')}`, { stdio: 'inherit' });
            console.log('✅ All required packages installed successfully');
        } catch (error) {
            console.error('❌ Error installing packages:', error.message);
            console.log('Please run manually: npm install ws nodemailer mysql2');
            process.exit(1);
        }
    } else {
        console.log('✅ All required packages are already installed');
    }
}

// Check if package.json exists, if not create it
function ensurePackageJson() {
    const packageJsonPath = path.join(__dirname, 'package.json');
    
    if (!fs.existsSync(packageJsonPath)) {
        console.log('📄 Creating package.json file...');
        
        const packageJson = {
            "name": "websocket-server",
            "version": "1.0.0",
            "description": "WebSocket server for chat and notifications",
            "main": "websocket-server1.js",
            "dependencies": {
                "ws": "^8.13.0",
                "nodemailer": "^6.9.3",
                "mysql2": "^3.4.0"
            },
            "scripts": {
                "start": "node websocket-server1.js"
            }
        };
        
        try {
            fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
            console.log('✅ package.json created successfully');
        } catch (error) {
            console.error('❌ Error creating package.json:', error.message);
        }
    }
}

// Run initialization
ensurePackageJson();
installMissingPackages();

const WebSocket = require('ws');
const nodemailer = require('nodemailer');

let mysql = null;
try {
    mysql = require('mysql2/promise');
} catch (error) {
    console.log('MySQL module not available. Email fetching from database will be disabled.');
}
const wss = new WebSocket.Server({ port: 8080 });

// Email configuration handleAuthentication
const transporter = nodemailer.createTransport({
    host: 'smtp.mail.ru',
    port: 465,
    secure: true, // используем SSL
    auth: {
        user: 'sdghhhkhgfxfzdewfrty@mail.ru',
        pass: 'uAcE5sRpGvCyMqZ1bDn3' // Пароль приложения Mail.ru (замените на реальный)
    }
});

// Проверка соединения с SMTP-сервером при запуске
transporter.verify(function(error, success) {
    if (error) {
        console.error('❌ Ошибка подключения к SMTP-серверу Mail.ru:', error);
    } else {
        console.log('✅ Соединение с SMTP-сервером Mail.ru установлено успешно');
    }
});

// Database connection configuration
const dbConfig = {
    host: 'localhost',
    user: 'root',      // replace with your database username
    password: 'p-329472_altnchat',      // replace with your database password
    database: 'socialite' // replace with your database name
};

// Create database connection pool if MySQL is available
let pool = null;
if (mysql) {
    try {
        pool = mysql.createPool(dbConfig);
        console.log('MySQL connection pool created successfully');
    } catch (error) {
        console.error('Error creating MySQL connection pool:', error);
    }
}

// Function to get user email from database
async function getUserEmailFromDB(userId) {
    if (!pool) {
        console.log('Cannot get email from database: MySQL connection pool not available');
        return null;
    }
    
    try {
        const connection = await pool.getConnection();
        const [rows] = await connection.execute('SELECT email FROM users WHERE id = ?', [userId]);
        connection.release();
        
        if (rows.length > 0) {
            console.log(`Retrieved email for user ${userId} from database: ${rows[0].email}`);
            return rows[0].email;
        } else {
            console.log(`No email found in database for user ${userId}`);
            return null;
        }
    } catch (error) {
        console.error(`Error retrieving email for user ${userId} from database:`, error);
        return null;
    }
}

// Функция для получения имени пользователя по ID
async function getUserNameById(userId) {
    try {
        if (!pool) {
            console.error('❌ Соединение с базой данных недоступно');
            return null;
        }
        
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                'SELECT CONCAT(firstname, " ", lastname) as fullname FROM users WHERE id = ?',
                [userId]
            );
            
            connection.release();
            
            if (rows.length > 0) {
                return rows[0].fullname;
            }
            return null;
        } catch (error) {
            connection.release();
            throw error;
        }
    } catch (error) {
        console.error('Ошибка при получении имени пользователя:', error);
        return null;
    }
}

// Email sending function
function sendEmailNotification(recipient, subject, message) {
    // Skip if no recipient
    if (!recipient) {
        console.log('Cannot send email: No recipient specified');
        return Promise.reject(new Error('No recipient specified'));
    }

    const mailOptions = {
        from: {
            name: 'Уведомления сайта',
            address: 'sdghhhkhgfxfzdewfrty@mail.ru'
        },
        to: recipient,
        subject: subject,
        html: message
    };

    console.log(`📧 Отправка письма на ${recipient} с темой "${subject}"`);

    return new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('❌ Ошибка отправки email:', error);
                reject(error);
            } else {
                console.log('✅ Email отправлен:', info.response);
                resolve(info);
            }
        });
    });
}

const clients = new Map(); // userId -> ws
const userStatuses = new Map(); // userId -> isOnline
const userEmails = new Map(); // userId -> email

// Обработчик подключения нового клиента
wss.on('connection', function connection(ws) {
    console.log('🔄 New WebSocket connection established');
    
    // Используем Map для хранения клиентов
    if (!global.clients) {
        global.clients = new Map();
    }
    
    // Устанавливаем обработчик сообщений
    ws.on('message', function incoming(message) {
        try {
            // Преобразуем сообщение в объект JavaScript, либо используем его как есть
            let messageData;
            
            if (typeof message === 'string') {
                messageData = JSON.parse(message);
            } else {
                // Если message не строка, пробуем преобразовать его в строку
                try {
                    const messageString = message.toString();
                    messageData = JSON.parse(messageString);
                } catch (parseError) {
                    console.error('❌ Не удалось преобразовать сообщение в объект:', parseError);
                    return;
                }
            }
            
            console.log('📩 Получено сообщение:', messageData.type || 'unknown type');
            
            // Обработка авторизации пользователя
            if (messageData.type === 'auth') {
                const userId = messageData.user_id;
                if (userId) {
                    // Сохраняем соединение пользователя
                    clients.set(userId.toString(), ws);
                    ws.userId = userId.toString();
                    console.log(`👤 Пользователь ${userId} авторизован. Активных соединений: ${clients.size}`);
                    
                    // Отмечаем пользователя как онлайн
                    userStatuses.set(userId.toString(), true);
                    broadcastStatus(userId.toString(), true);
                }
            }
            // Обработка звонков Jitsi
            else if (messageData.type === 'jitsi_video_call' || messageData.type === 'jitsi_audio_call') {
                const recipientId = messageData.recipient_id.toString();
                const recipientWs = clients.get(recipientId);
                
                console.log(`📞 Запрос на ${messageData.type === 'jitsi_video_call' ? 'видеозвонок' : 'аудиозвонок'} от ${messageData.sender_id} к ${recipientId}`);
                
                if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                    // Пересылаем уведомление о звонке получателю
                    recipientWs.send(JSON.stringify(messageData));
                    console.log(`✅ Уведомление о звонке отправлено пользователю ${recipientId}`);
                } else {
                    // Отправляем отправителю уведомление, что получатель не в сети
                    const senderWs = clients.get(messageData.sender_id.toString());
                    if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                        senderWs.send(JSON.stringify({
                            type: 'call_error',
                            error: 'recipient_offline',
                            message: 'Получатель не в сети',
                            timestamp: new Date().toISOString()
                        }));
                    }
                    console.log(`❌ Получатель ${recipientId} не в сети или соединение закрыто`);
                }
            }
            // Обработка отклонения звонка
            else if (messageData.type === 'call_declined' || messageData.type === 'call_missed') {
                const recipientId = messageData.recipient_id.toString();
                const recipientWs = clients.get(recipientId);
                
                console.log(`📞 ${messageData.type === 'call_declined' ? 'Отклонение' : 'Пропуск'} звонка от ${messageData.sender_id} к ${recipientId}`);
                
                if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                    // Пересылаем уведомление об отклонении звонка
                    recipientWs.send(JSON.stringify(messageData));
                    console.log(`✅ Уведомление о ${messageData.type === 'call_declined' ? 'отклонении' : 'пропуске'} звонка отправлено пользователю ${recipientId}`);
                }
            }
            // Добавляем ссылку на WebSocket в сообщение для других типов сообщений
            else {
                messageData.ws = ws;
                
                // Обрабатываем сообщение через существующий обработчик
                handleMessage(messageData);
            }
        } catch (error) {
            console.error('❌ Ошибка при обработке входящего сообщения:', error);
        }
    });
    
    // Добавляем обработчик ошибок
    ws.on('error', function(error) {
        console.error('❌ WebSocket error:', error);
    });
    
    // Обработчик закрытия соединения
    ws.on('close', function() {
        console.log('❌ WebSocket connection closed');
        
        // Если соединение было аутентифицировано, уведомляем других пользователей
        if (ws.userId) {
            console.log(`👤 User ${ws.userId} disconnected`);
            
            // Помечаем пользователя как оффлайн
            userStatuses.set(ws.userId, false);
            broadcastStatus(ws.userId, false);
            
            // Удаляем соединение из списка клиентов
            if (clients.has(ws.userId)) {
                clients.delete(ws.userId);
            }
            if (global.clients.has(ws.userId)) {
                global.clients.delete(ws.userId);
            }
        }
    });
    
    // Инициализация клиента для ping/pong
    ws.isAlive = true;
    ws.on('pong', heartbeat);
});

function broadcastStatus(userId, isOnline) {
    if (!userId || typeof isOnline !== 'boolean') {
        console.error('Invalid status update parameters:', { userId, isOnline });
        return;
    }

    console.log('Broadcasting status update:', {
        userId,
        isOnline,
        timestamp: new Date().toISOString()
    });

    const message = {
        type: 'status_update',
        userId: parseInt(userId),
        isOnline: isOnline
    };

    let successCount = 0;
    let failCount = 0;

    // Добавляем дедупликацию клиентов
    const uniqueClients = new Map(clients);

    uniqueClients.forEach((clientWs, clientId) => {
        if (clientWs && clientWs.readyState === WebSocket.OPEN) {
            try {
                clientWs.send(JSON.stringify(message));
                successCount++;
                console.log(`Status update sent to client ${clientId}:`, {
                    recipientId: clientId,
                    messageType: 'status_update',
                    success: true
                });
            } catch (error) {
                failCount++;
                console.error(`Error sending status to client ${clientId}:`, error);
            }
        } else {
            failCount++;
            console.log(`Failed to send status to client ${clientId} - connection not open`);
            // Удаляем неактивные соединения
            clients.delete(clientId);
        }
    });

    console.log('Status broadcast complete:', {
        userId,
        isOnline,
        successCount,
        failCount,
        totalClients: clients.size
    });
}

console.log('🚀 WebSocket server running on port 8080');

// Периодический вывод статистики
setInterval(() => {
    console.log('📊 Server status:', {
        timestamp: new Date().toISOString(),
        connectedClients: clients.size,
        onlineUsers: Array.from(userStatuses.entries())
            .filter(([_, status]) => status).length,
        totalTrackedUsers: userStatuses.size
    });
}, 30000);

// Проверка активных соединений каждые 30 секунд
setInterval(() => {
    const now = Date.now();
    clients.forEach((ws, userId) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.log('🔍 Found stale connection for user:', userId);
            userStatuses.set(userId, false);
            broadcastStatus(userId, false);
            clients.delete(userId);
        }
    });

    console.log('📊 Active connections check:', {
        timestamp: new Date().toISOString(),
        connectedClients: clients.size,
        onlineUsers: Array.from(userStatuses.entries()).filter(([_, status]) => status).length
    });
}, 30000);

// Проверка и загрузка email-адресов для активных пользователей
setInterval(async () => {
    console.log('📧 Checking for missing emails...');
    const usersWithoutEmail = [];
    
    for (const [userId, ws] of clients.entries()) {
        if (ws && ws.readyState === WebSocket.OPEN && !userEmails.has(userId)) {
            usersWithoutEmail.push(userId);
        }
    }
    
    if (usersWithoutEmail.length > 0) {
        console.log(`Found ${usersWithoutEmail.length} users without email, trying to fetch from database...`);
        
        for (const userId of usersWithoutEmail) {
            try {
                const email = await getUserEmailFromDB(userId);
                if (email) {
                    userEmails.set(userId, email);
                    console.log(`✅ Added email for user ${userId}: ${email}`);
                }
            } catch (error) {
                console.error(`❌ Error fetching email for user ${userId}:`, error);
            }
        }
    } else {
        console.log('All active users have emails stored.');
    }
}, 60000); // Check every minute

// Добавим проверку соединений
function heartbeat() {
    this.isAlive = true;
}

const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) {
            if (ws.userId) {
                userStatuses.set(ws.userId, false);
                broadcastStatus(ws.userId, false);
            }
            return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', function close() {
    clearInterval(interval);
});

// Функция для обработки запроса на аудиозвонок
function handleAudioCallRequest(data) {
    console.log('Обработка запроса на аудиозвонок:', data);
    
    const recipientId = parseInt(data.recipientId);
    const senderId = parseInt(data.senderId);
    
    // Проверяем, подключен ли получатель
    if (clients.has(recipientId)) {
        console.log(`Отправка запроса на аудиозвонок пользователю ${recipientId} от пользователя ${senderId}`);
        
        // Отправляем запрос на аудиозвонок получателю
        const recipientWs = clients.get(recipientId);
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({
                type: 'audio_call_request',
                senderId: senderId,
                senderName: data.senderName
            });
            console.log('Отправляемое сообщение:', message);
            recipientWs.send(message);
            console.log(`Запрос на аудиозвонок отправлен пользователю ${recipientId}`);
        } else {
            console.log(`Соединение с пользователем ${recipientId} не открыто, отправляем уведомление отправителю`);
            if (clients.has(senderId)) {
                clients.get(senderId).send(JSON.stringify({
                    type: 'audio_call_error',
                    error: 'recipient_unavailable',
                    message: 'Пользователь недоступен'
                }));
            }
        }
    } else {
        console.log(`Пользователь ${recipientId} не в сети, отправляем уведомление отправителю`);
        
        // Отправляем уведомление отправителю о том, что получатель не в сети
        if (clients.has(senderId)) {
            clients.get(senderId).send(JSON.stringify({
                type: 'audio_call_error',
                error: 'recipient_offline',
                message: 'Пользователь не в сети'
            }));
        }
    }
}

// Функция для обработки принятия видеозвонка
function handleVideoCallAccepted(data) {
    console.log('Обработка принятия видеозвонка:', data);
    
    const recipientId = data.recipientId;
    const senderId = data.senderId;
    
    // Проверяем, подключен ли получатель
    if (clients.has(recipientId)) {
        console.log(`Отправка уведомления о принятии видеозвонка пользователю ${recipientId}`);
        
        // Отправляем уведомление о принятии видеозвонка получателю
        clients.get(recipientId).send(JSON.stringify({
            type: 'video_call_accepted',
            senderId: senderId
        }));
    } else {
        console.log(`Пользователь ${recipientId} не в сети`);
    }
}

// Функция для обработки отклонения видеозвонка
function handleVideoCallRejected(data) {
    console.log('Обработка отклонения видеозвонка:', data);
    
    const recipientId = data.recipientId;
    const senderId = data.senderId;
    
    // Проверяем, подключен ли получатель
    if (clients.has(recipientId)) {
        console.log(`Отправка уведомления об отклонении видеозвонка пользователю ${recipientId}`);
        
        // Отправляем уведомление об отклонении видеозвонка получателю
        clients.get(recipientId).send(JSON.stringify({
            type: 'video_call_rejected',
            senderId: senderId
        }));
    } else {
        console.log(`Пользователь ${recipientId} не в сети`);
    }
}

// Функция для обработки завершения видеозвонка
function handleVideoCallEnd(data) {
    console.log('Обработка завершения видеозвонка:', data);
    
    const recipientId = data.recipientId;
    const senderId = data.senderId;
    
    // Проверяем, подключен ли получатель
    if (clients.has(recipientId)) {
        console.log(`Отправка уведомления о завершении видеозвонка пользователю ${recipientId}`);
        
        // Отправляем уведомление о завершении видеозвонка получателю
        clients.get(recipientId).send(JSON.stringify({
            type: 'video_call_end',
            senderId: senderId
        }));
    } else {
        console.log(`Пользователь ${recipientId} не в сети`);
    }
}

// Функция для обработки предложения SDP для видеозвонка
function handleVideoCallOffer(data) {
    console.log('Обработка предложения SDP для видеозвонка:', data);
    
    const recipientId = data.recipientId;
    const senderId = data.senderId;
    
    // Проверяем, подключен ли получатель
    if (clients.has(recipientId)) {
        console.log(`Отправка предложения SDP для видеозвонка пользователю ${recipientId}`);
        
        // Отправляем предложение SDP для видеозвонка получателю
        clients.get(recipientId).send(JSON.stringify({
            type: 'video_call_offer',
            senderId: senderId,
            sdp: data.sdp
        }));
    } else {
        console.log(`Пользователь ${recipientId} не в сети`);
    }
}

// Функция для обработки ответа SDP для видеозвонка
function handleVideoCallAnswer(data) {
    console.log('Обработка ответа SDP для видеозвонка:', data);
    
    const recipientId = data.recipientId;
    const senderId = data.senderId;
    
    // Проверяем, подключен ли получатель
    if (clients.has(recipientId)) {
        console.log(`Отправка ответа SDP для видеозвонка пользователю ${recipientId}`);
        
        // Отправляем ответ SDP для видеозвонка получателю
        clients.get(recipientId).send(JSON.stringify({
            type: 'video_call_answer',
            senderId: senderId,
            sdp: data.sdp
        }));
    } else {
        console.log(`Пользователь ${recipientId} не в сети`);
    }
}

// Функция для проверки и отправки уведомлений о событиях на сегодня
async function checkTodayEvents() {
    console.log('Проверка сегодняшних событий и отправка уведомлений...');
    
    // Проверка подключения к БД
    if (!pool) {
        console.error('❌ Нет подключения к базе данных');
        throw new Error('Нет подключения к базе данных');
    }
    
    try {
        // Получение текущей даты в формате YYYY-MM-DD
        const today = new Date().toISOString().split('T')[0];
        
        // Получаем соединение из пула
        const connection = await pool.getConnection();
        
        try {
            // Сначала проверяем существование таблицы event_notification_log
            const [tables] = await connection.query(`
                SELECT TABLE_NAME FROM information_schema.tables 
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            `, [dbConfig.database, 'event_notification_log']);
            
            // Если таблица не существует, создаем её
            if (tables.length === 0) {
                console.log('Таблица event_notification_log не существует. Создаём...');
                await connection.query(`
                    CREATE TABLE event_notification_log (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        event_id INT NOT NULL,
                        user_id INT NOT NULL,
                        days_before INT NOT NULL DEFAULT 0,
                        sent_at DATETIME NOT NULL,
                        success TINYINT(1) NOT NULL DEFAULT 0,
                        INDEX (event_id),
                        INDEX (user_id),
                        INDEX (days_before),
                        INDEX (sent_at)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                `);
                console.log('✅ Таблица event_notification_log успешно создана');
            }
            
            // Запрос для получения событий на сегодня и пользователей, зарегистрированных на них
            const [events] = await connection.execute(`
                SELECT e.id, e.title, e.location, e.description, 
                       u.id as user_id, u.username, u.email 
                FROM events e
                JOIN event_participants ep ON e.id = ep.event_id
                JOIN users u ON ep.user_id = u.id
                WHERE DATE(e.event_date) = ? AND e.status = 'active' AND e.is_active = 1
            `, [today]);
            
            console.log(`Найдено ${events.length} записей о пользователях, зарегистрированных на сегодняшние события`);
            
            // Если есть события на сегодня с зарегистрированными участниками
            if (events.length > 0) {
                // Группировка по пользователям и событиям для избежания дублирования
                const notifications = {};
                
                events.forEach(row => {
                    const key = `${row.user_id}_${row.id}`;
                    if (!notifications[key]) {
                        notifications[key] = {
                            email: row.email,
                            username: row.username,
                            userId: row.user_id,
                            eventId: row.id,
                            eventTitle: row.title,
                            eventLocation: row.location,
                            eventDescription: row.description
                        };
                    }
                });
                
                // Отправка уведомлений
                for (const key in notifications) {
                    const notification = notifications[key];
                    
                    // Проверяем, отправлялось ли уже уведомление сегодня
                    const [sentNotifications] = await connection.execute(`
                        SELECT id FROM event_notification_log 
                        WHERE event_id = ? 
                        AND user_id = ? 
                        AND days_before = 0
                        AND sent_at >= DATE(NOW())
                    `, [notification.eventId, notification.userId]);
                    
                    // Если уведомление уже было отправлено сегодня, пропускаем
                    if (sentNotifications.length > 0) {
                        console.log(`Уведомление для события ${notification.eventId} пользователю ${notification.username} уже было отправлено сегодня`);
                        continue;
                    }
                    
                    const notificationSubject = `Событие сегодня: ${notification.eventTitle}`;
                    const notificationHtmlMessage = `
                        <h2>Напоминание о событии сегодня</h2>
                        <p>Здравствуйте, ${notification.username}!</p>
                        <p>Напоминаем, что сегодня состоится событие, на которое вы зарегистрированы:</p>
                        <div style="margin: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 5px;">
                            <h3>${notification.eventTitle}</h3>
                            <p><strong>Место:</strong> ${notification.eventLocation}</p>
                            <p>${notification.eventDescription}</p>
                        </div>
                        <p>Не пропустите!</p>
                        <p>С уважением,<br>Команда сайта</p>
                    `;
                    
                    try {
                        // Отправка email уведомления
                        await sendEmailNotification(notification.email, notificationSubject, notificationHtmlMessage);
                        console.log(`✅ Отправлено уведомление пользователю ${notification.username} (${notification.email}) о событии "${notification.eventTitle}"`);
                        
                        // Записываем в лог отправленных уведомлений
                        await connection.execute(`
                            INSERT INTO event_notification_log 
                            (event_id, user_id, days_before, sent_at, success) 
                            VALUES (?, ?, 0, NOW(), 1)
                        `, [notification.eventId, notification.userId]);
                    } catch (error) {
                        console.error(`❌ Ошибка отправки уведомления на ${notification.email}:`, error);
                        
                        // Записываем неудачную попытку в лог
                        await connection.execute(`
                            INSERT INTO event_notification_log 
                            (event_id, user_id, days_before, sent_at, success) 
                            VALUES (?, ?, 0, NOW(), 0)
                        `, [notification.eventId, notification.userId]);
                    }
                }
            }
        } finally {
            // Возвращаем соединение в пул
            connection.release();
        }
    } catch (error) {
        console.error('Ошибка при проверке сегодняшних событий:', error);
        // Не прерываем выполнение сервера при ошибке проверки событий
        console.log('Сервер продолжает работу несмотря на ошибку проверки событий');
    }
}

// Запуск автоматической проверки событий при старте сервера
setTimeout(() => {
    console.log('Запуск первичной проверки событий на сегодня...');
    checkTodayEvents();
    
    // Установка интервала для регулярной проверки событий (каждые 30 минут)
    const eventCheckInterval = setInterval(checkTodayEvents, 30 * 60 * 1000);
    
    // Очистка интервала при закрытии сервера
    wss.on('close', function close() {
        console.log('WebSocket сервер закрывается, очистка интервалов');
        clearInterval(eventCheckInterval);
        clearInterval(interval);
    });
}, 5000); // Даем 5 секунд на инициализацию сервера

// Функция для проверки событий и отправки уведомлений
async function checkEventsAndSendNotifications(daysToCheck = [0, 1, 2, 3]) {
    console.log('🔍 Начинается проверка событий на даты:', daysToCheck);
    
    // Результаты отправки
    const result = {
        total: 0,
        details: {}
    };
    
    // Для каждого из дней инициализируем счетчик
    daysToCheck.forEach(days => {
        result.details[days] = 0;
    });

    // Проверка подключения к БД
    if (!pool) {
        console.error('❌ Нет подключения к базе данных');
        throw new Error('Нет подключения к базе данных');
    }
    
    // Получаем соединение с БД
    const connection = await pool.getConnection();
    
    try {
        console.log('✅ Соединение с БД установлено');
        
        // Для каждого дня из списка
        for (const daysBeforeEvent of daysToCheck) {
            // Получаем дату события
            const eventDate = new Date();
            eventDate.setDate(eventDate.getDate() + parseInt(daysBeforeEvent));
            const eventDateString = eventDate.toISOString().split('T')[0]; // YYYY-MM-DD
            
            console.log(`📅 Проверка событий на дату: ${eventDateString} (за ${daysBeforeEvent} дн. до события)`);
            
            // 1. Сначала получаем данные о том, кто идет на события из таблицы event_going
            console.log('🔄 Запрос к таблице event_going для получения списка участников...');
            const [eventGoingData] = await connection.execute(`
                SELECT eg.event_id, eg.user_id, eg.created_at 
                FROM event_going eg
                WHERE eg.created_at IS NOT NULL
                ORDER BY eg.created_at DESC
            `);
            
            console.log(`📊 Получено ${eventGoingData.length} записей о посещении событий`);
            
            if (eventGoingData.length === 0) {
                console.log('⚠️ Нет записей о посещении событий');
                continue;
            }
            
            // Собираем уникальные ID событий
            const eventIds = [...new Set(eventGoingData.map(record => record.event_id))];
            console.log(`📋 Найдены ID событий: ${eventIds.join(', ')}`);
            
            // Получаем информацию о датах событий для отладки
            const [eventDates] = await connection.execute(`
                SELECT id, title, event_date, DATE(event_date) as event_date_only
                FROM events
                WHERE id IN (${eventIds.join(',')})
            `);
            console.log('📅 Даты найденных событий:', eventDates);
            
            // 2. Получаем данные о событиях из таблицы events
            console.log('🔄 Запрос к таблице events для получения информации о событиях...');
            const [eventsData] = await connection.execute(`
                SELECT e.id, e.title, e.event_date, e.event_end_date, e.location, e.description 
                FROM events e
                WHERE e.id IN (${eventIds.join(',')})
                AND DATE(e.event_date) = DATE(?)
                AND e.event_date >= NOW()
                ORDER BY e.event_date ASC
            `, [eventDateString]);
            
            console.log(`📊 Найдено ${eventsData.length} событий на дату ${eventDateString}`);
            
            if (eventsData.length === 0) {
                console.log(`⚠️ Нет активных событий на дату ${eventDateString}`);
                continue;
            }
            
            // Создаем карту событий для быстрого поиска
            const eventsMap = new Map();
            eventsData.forEach(event => {
                eventsMap.set(event.id, event);
            });
            
            // 3. Находим уникальных пользователей, которые посещают эти события
            const userEventPairs = [];
            eventGoingData.forEach(record => {
                if (eventsMap.has(record.event_id)) {
                    userEventPairs.push({
                        userId: record.user_id,
                        eventId: record.event_id
                    });
                }
            });
            
            console.log(`📊 Найдено ${userEventPairs.length} пар участник-событие`);
            
            // 4. Получаем данные о пользователях
            if (userEventPairs.length === 0) {
                console.log('⚠️ Нет пользователей для уведомления');
                continue;
            }
            
            const userIds = [...new Set(userEventPairs.map(pair => pair.userId))];
            console.log(`🔄 Запрос к таблице users для получения информации о ${userIds.length} пользователях...`);
            
            const [usersData] = await connection.execute(`
                SELECT u.id, u.username, u.email, u.firstname, u.lastname
                FROM users u
                WHERE u.id IN (${userIds.map(() => '?').join(',')})
            `, userIds);
            
            console.log(`📊 Получены данные для ${usersData.length} пользователей`);
            
            // Создаем карту пользователей для быстрого поиска
            const usersMap = new Map();
            usersData.forEach(user => {
                usersMap.set(user.id, user);
            });
            
            console.log('🔄 Формирование уведомлений...');
            
            // 5. Для каждой пары пользователь-событие проверяем, нужно ли отправлять уведомление
            for (const pair of userEventPairs) {
                const user = usersMap.get(pair.userId);
                const event = eventsMap.get(pair.eventId);
                
                if (!user || !event) {
                    console.log(`⚠️ Пропуск: не найдены данные пользователя ${pair.userId} или события ${pair.eventId}`);
                    continue;
                }
                
                console.log(`👤 Обработка уведомления для пользователя ${user.username} о событии "${event.title}"`);
                
                // Проверяем, отправлялось ли уже уведомление за последние 24 часа
                const [sentNotifications] = await connection.execute(`
                    SELECT id FROM event_notification_log 
                    WHERE event_id = ? 
                    AND user_id = ? 
                    AND days_before = ?
                    AND sent_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
                `, [event.id, user.id, daysBeforeEvent]);
                
                if (sentNotifications.length > 0) {
                    console.log(`📌 Уведомление для события ${event.id} пользователю ${user.id} за ${daysBeforeEvent} дн. уже было отправлено ранее`);
                    continue;
                }
                
                console.log(`📧 Подготовка к отправке уведомления о событии "${event.title}" пользователю ${user.username} <${user.email}> за ${daysBeforeEvent} дн.`);
                
                // Подготовка данных события для уведомления
                const eventDate = new Date(event.event_date);
                const endDate = event.event_end_date ? new Date(event.event_end_date) : null;
                
                // Форматирование даты и времени события
                const formattedDate = eventDate.toLocaleDateString('ru-RU');
                const formattedTime = eventDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                const formattedEndTime = endDate ? endDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
                
                // Создание относительного времени с учетом дней до события
                let relativeTime = '';
                switch (daysBeforeEvent) {
                    case 0:
                        relativeTime = `Сегодня в ${formattedTime}`;
                        break;
                    case 1:
                        relativeTime = `Завтра в ${formattedTime}`;
                        break;
                    case 2:
                        relativeTime = `Послезавтра в ${formattedTime}`;
                        break;
                    default:
                        relativeTime = `Через ${daysBeforeEvent} дн. в ${formattedTime}`;
                }
                
                // Формируем сообщение в зависимости от оставшегося времени
                let urgencyMessage = '';
                let subjectPrefix = '';
                let accentColor = '#4a76a8'; // Базовый синий цвет сайта
                
                switch (parseInt(daysBeforeEvent)) {
                    case 0:
                        urgencyMessage = "Внимание! Событие начнётся сегодня. Не пропустите!";
                        subjectPrefix = "СЕГОДНЯ! ";
                        accentColor = '#e74c3c'; // Красный для срочных уведомлений
                        break;
                    case 1:
                        urgencyMessage = "Скоро начало! Событие начнётся завтра. Подготовьтесь заранее.";
                        subjectPrefix = "ЗАВТРА! ";
                        accentColor = '#f39c12'; // Оранжевый для предстоящих событий
                        break;
                    case 2:
                        urgencyMessage = "Приближается событие! Осталось 2 дня. Проверьте свои планы.";
                        accentColor = '#3498db'; // Синий
                        break;
                    case 3:
                        urgencyMessage = "Не забудьте о предстоящем событии через 3 дня.";
                        accentColor = '#2980b9'; // Тёмно-синий
                        break;
                    default:
                        urgencyMessage = "Напоминаем о предстоящем событии.";
                }
                
                // Формирование ссылки на событие
                const eventUrl = `http://localhost/phpsite/event.php?id=${event.id}`;
                
                // Заголовок письма
                const subject = `${subjectPrefix}Напоминание о событии: ${event.title} - ${relativeTime}`;
                
                // Информация о времени события, включая время окончания, если доступно
                let timeInfo = `<div class='event-info'>
                    <div class='event-info-label'>Время:</div>
                    <div class='event-info-value'>${formattedTime}`;

                if (formattedEndTime) {
                    timeInfo += ` - ${formattedEndTime}`;
                }

                timeInfo += `</div></div>`;
                
                // Создаем HTML-шаблон письма
                const htmlMessage = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset='UTF-8'>
                    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
                    <title>Напоминание о событии</title>
                    <style>
                        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');
                        
                        body { 
                            font-family: 'Roboto', Arial, sans-serif; 
                            line-height: 1.6; 
                            color: #333; 
                            margin: 0;
                            padding: 0;
                            background-color: #f5f5f5;
                        }
                        .container { 
                            max-width: 600px; 
                            margin: 0 auto; 
                            padding: 20px;
                        }
                        .email-wrapper {
                            border-radius: 8px;
                            overflow: hidden;
                            box-shadow: 0 3px 10px rgba(0,0,0,0.1);
                        }
                        .header { 
                            background-color: ${accentColor}; 
                            color: white; 
                            padding: 15px 20px; 
                            text-align: center;
                        }
                        .header h1 {
                            margin: 0;
                            font-size: 24px;
                            font-weight: 500;
                        }
                        .content { 
                            background-color: white; 
                            padding: 30px; 
                        }
                        .greeting {
                            font-size: 18px;
                            margin-bottom: 20px;
                        }
                        .event-details { 
                            margin: 25px 0;
                            background-color: #f9f9f9; 
                            padding: 20px; 
                            border-radius: 8px; 
                            border-left: 4px solid ${accentColor};
                        }
                        .event-title {
                            font-size: 22px;
                            margin-top: 0;
                            color: ${accentColor};
                        }
                        .footer { 
                            margin-top: 30px; 
                            font-size: 13px; 
                            color: #777; 
                            text-align: center;
                            padding: 20px;
                            background-color: #f9f9f9;
                            border-top: 1px solid #eee;
                        }
                        .button { 
                            display: inline-block; 
                            background-color: ${accentColor}; 
                            color: white !important; 
                            text-decoration: none; 
                            padding: 12px 25px; 
                            border-radius: 5px; 
                            margin-top: 25px;
                            font-weight: 500;
                            text-align: center;
                            transition: background-color 0.3s;
                        }
                        .event-info { 
                            display: flex; 
                            margin-bottom: 15px;
                            align-items: baseline;
                        }
                        .event-info-label { 
                            font-weight: 500; 
                            width: 100px;
                            color: #555;
                        }
                        .event-info-value {
                            flex: 1;
                        }
                        .urgency { 
                            color: ${daysBeforeEvent <= 1 ? '#e74c3c' : accentColor}; 
                            font-weight: 500; 
                            margin: 25px 0;
                            padding: 10px 15px;
                            background-color: ${daysBeforeEvent <= 1 ? '#ffeeee' : '#f8f9fa'};
                            border-radius: 4px;
                            font-size: 16px;
                        }
                        .description {
                            line-height: 1.7;
                            color: #555;
                        }
                    </style>
                </head>
                <body>
                    <div class='container'>
                        <div class='email-wrapper'>
                            <div class='header'>
                                <h1>Напоминание о событии</h1>
                            </div>
                            <div class='content'>
                                <p class='greeting'>Здравствуйте, ${user.firstname || user.username}!</p>
                                <p>Напоминаем, что вы зарегистрированы на событие:</p>
                                
                                <div class='event-details'>
                                    <h2 class='event-title'>${event.title}</h2>
                                    <div class='event-info'>
                                        <div class='event-info-label'>Дата:</div>
                                        <div class='event-info-value'>${formattedDate}</div>
                                    </div>
                                    ${timeInfo}
                                    <div class='event-info'>
                                        <div class='event-info-label'>Место:</div>
                                        <div class='event-info-value'>${event.location}</div>
                                    </div>
                                    <div class='description'>${event.description}</div>
                                </div>
                                
                                <div class='urgency'>${urgencyMessage}</div>
                                
                                <center><a href='${eventUrl}' class='button'>Перейти на страницу события</a></center>
                            </div>
                            <div class='footer'>
                                <p>Это автоматическое напоминание. Пожалуйста, не отвечайте на это письмо.</p>
                                <p>Для отмены подписки на напоминания о событиях, перейдите в настройки вашего профиля.</p>
                            </div>
                        </div>
                    </div>
                </body>
                </html>`;
                
                try {
                    console.log(`📧 Отправка email на ${user.email}...`);
                    // Отправляем email-уведомление
                    await sendEmailNotification(user.email, subject, htmlMessage);
                    console.log(`✅ Уведомление о событии успешно отправлено на ${user.email}`);
                    result.total++;
                    result.details[daysBeforeEvent]++;
                    
                    // Записываем в лог отправленных уведомлений
                    await connection.execute(`
                        INSERT INTO event_notification_log 
                        (event_id, user_id, days_before, sent_at, success) 
                        VALUES (?, ?, ?, NOW(), 1)
                    `, [event.id, user.id, daysBeforeEvent]);
                    
                    console.log(`✅ Запись добавлена в event_notification_log: событие ${event.id}, пользователь ${user.id}`);
                } catch (error) {
                    console.error(`❌ Ошибка отправки уведомления на ${user.email}:`, error);
                    
                    // Записываем неудачную попытку в лог
                    await connection.execute(`
                        INSERT INTO event_notification_log 
                        (event_id, user_id, days_before, sent_at, success) 
                        VALUES (?, ?, ?, NOW(), 0)
                    `, [event.id, user.id, daysBeforeEvent]);
                    
                    console.log(`⚠️ Запись о неудачной отправке добавлена в event_notification_log`);
                }
                
                // Небольшая пауза между отправками
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        
        console.log(`📊 Итого отправлено уведомлений: ${result.total}`);
        
        return result;
    } catch (error) {
        console.error('❌ Ошибка при проверке событий и отправке уведомлений:', error);
        throw error;
    } finally {
        // Возвращаем соединение в пул
        connection.release();
        console.log('🔄 Соединение с БД закрыто');
    }
}

// Настройка автоматического расписания проверки событий
console.log('📅 Настройка автоматического расписания проверки событий...');

// Функция для определения времени следующего запуска
function calculateNextRunTime(hour, minute) {
    const now = new Date();
    const nextRun = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        hour,
        minute,
        0
    );
    
    // Если указанное время уже прошло сегодня, планируем на завтра
    if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
    }
    
    return nextRun;
}

// Функция для запуска проверки в определенное время
function scheduleEventCheck(hour, minute) {
    try {
        const nextRun = calculateNextRunTime(hour, minute);
        const timeUntilNextRun = nextRun - new Date();
        
        console.log(`📆 Следующая проверка событий запланирована на ${nextRun.toLocaleString('ru-RU')}`);
        console.log(`⏱️ До следующей проверки: ${Math.floor(timeUntilNextRun / 1000 / 60)} минут`);
        
        // Устанавливаем таймер на следующий запуск
        setTimeout(() => {
            console.log(`🔔 Запуск автоматической проверки событий в ${new Date().toLocaleString('ru-RU')}`);
            
            // Оборачиваем вызов в try-catch для обеспечения продолжения работы программы в случае ошибок
            try {
                // Проверяем, что пул соединений с БД доступен
                if (pool) {
                    checkEventsAndSendNotifications([0, 1, 2, 3])
                        .then(result => {
                            console.log('✅ Автоматическая проверка событий выполнена успешно:', result);
                        })
                        .catch(error => {
                            console.error('❌ Ошибка при автоматической проверке событий:', error);
                        })
                        .finally(() => {
                            // В любом случае планируем следующую проверку
                            scheduleEventCheck(hour, minute);
                        });
                } else {
                    console.error('❌ Невозможно выполнить проверку событий: пул соединений с БД недоступен');
                    scheduleEventCheck(hour, minute);
                }
            } catch (e) {
                console.error('❌ Критическая ошибка при запуске проверки событий:', e);
                scheduleEventCheck(hour, minute);
            }
        }, timeUntilNextRun);
    } catch (e) {
        console.error('❌ Ошибка планирования проверки событий:', e);
        // В случае критической ошибки повторяем попытку через 1 час
        setTimeout(() => {
            scheduleEventCheck(hour, minute);
        }, 60 * 60 * 1000); 
    }
}

// Запланируем проверки на разное время дня
// 08:00 - утреннее напоминание
scheduleEventCheck(8, 0);
// 12:00 - дневное напоминание
scheduleEventCheck(12, 0);
// 18:00 - вечернее напоминание
scheduleEventCheck(18, 0);

// Также запустим немедленную проверку при старте сервера с небольшой задержкой
setTimeout(() => {
    console.log('🚀 Запуск начальной проверки событий...');
    
    try {
        // Проверяем, что пул соединений с БД доступен
        if (pool) {
            checkEventsAndSendNotifications([0, 1, 2, 3])
                .then(result => {
                    console.log('✅ Начальная проверка событий выполнена успешно:', result);
                })
                .catch(error => {
                    console.error('❌ Ошибка при начальной проверке событий:', error);
                    
                    // Если произошла ошибка, пробуем еще раз через 30 минут
                    console.log('⏰ Запланирован повторный запуск проверки через 30 минут');
                    setTimeout(() => {
                        console.log('🔄 Повторный запуск проверки событий...');
                        try {
                            if (pool) {
                                checkEventsAndSendNotifications([0, 1, 2, 3])
                                    .then(result => {
                                        console.log('✅ Повторная проверка событий выполнена успешно:', result);
                                    })
                                    .catch(secondError => {
                                        console.error('❌ Ошибка при повторной проверке событий:', secondError);
                                    });
                            }
                        } catch (e) {
                            console.error('❌ Критическая ошибка при повторной проверке:', e);
                        }
                    }, 30 * 60 * 1000); // 30 минут
                });
        } else {
            console.error('❌ Невозможно выполнить начальную проверку: пул соединений с БД недоступен');
            
            // Если БД недоступна, пробуем еще раз через 10 минут
            console.log('⏰ Запланирован повторный запуск проверки через 10 минут');
            setTimeout(() => {
                console.log('🔄 Повторный запуск проверки...');
                try {
                    if (pool) {
                        checkEventsAndSendNotifications([0, 1, 2, 3])
                            .then(result => {
                                console.log('✅ Повторная проверка событий выполнена успешно:', result);
                            })
                            .catch(err => {
                                console.error('❌ Ошибка при повторной проверке событий:', err);
                            });
                    } else {
                        console.error('❌ База данных все еще недоступна');
                    }
                } catch (e) {
                    console.error('❌ Критическая ошибка при повторной проверке:', e);
                }
            }, 10 * 60 * 1000); // 10 минут
        }
    } catch (e) {
        console.error('❌ Критическая ошибка при запуске начальной проверки:', e);
    }
}, 15000); // Увеличиваем задержку до 15 секунд для полной инициализации сервера

console.log('🔄 Автоматические проверки событий настроены на 08:00, 12:00 и 18:00 ежедневно');

// Функция для отправки уведомлений о предстоящих событиях
async function sendUpcomingEvents(ws, days = 3) {
    console.log('🔍 Получение предстоящих событий за следующие', days, 'дней');
    
    if (!pool) {
        throw new Error('База данных недоступна');
    }
    
    try {
        const connection = await pool.getConnection();
        
        try {
            // Получаем ID пользователя из соединения
            const userId = ws.userId;
            
            if (!userId) {
                throw new Error('ID пользователя не найден');
            }
            
            console.log(`👤 Поиск событий для пользователя ID: ${userId}`);
            
            // Получаем предстоящие события пользователя через таблицу event_going
            const [events] = await connection.execute(`
                SELECT e.id, e.title, e.event_date, e.event_end_date, e.location, e.description,
                       DATEDIFF(e.event_date, NOW()) as days_until,
                       eg.created_at as registration_date
                FROM events e
                JOIN event_going eg ON e.id = eg.event_id
                WHERE eg.user_id = ?
                  AND e.event_date > NOW()
                  AND e.event_date <= DATE_ADD(NOW(), INTERVAL ? DAY)
                  AND e.status = 'active'
                  AND e.is_active = 1
                ORDER BY e.event_date ASC
            `, [userId, days]);
            
            console.log(`📊 Найдено ${events.length} предстоящих событий для пользователя ${userId}`);
            
            // Преобразуем данные для отправки
            const formattedEvents = events.map(event => {
                const eventDate = new Date(event.event_date);
                const endDate = event.event_end_date ? new Date(event.event_end_date) : null;
                
                return {
                    id: event.id,
                    title: event.title,
                    date: eventDate.toISOString(),
                    end_date: endDate ? endDate.toISOString() : null,
                    formatted_date: formatDate(eventDate),
                    formatted_time: formatTime(eventDate),
                    formatted_end_time: endDate ? formatTime(endDate) : null,
                    location: event.location,
                    description: event.description,
                    days_until: event.days_until,
                    relative_time: getRelativeTimeText(event.days_until),
                    registration_date: event.registration_date
                };
            });
            
            console.log(`📤 Отправка данных о ${formattedEvents.length} событиях клиенту...`);
            
            // Отправляем данные клиенту
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'upcoming_events',
                    events: formattedEvents,
                    count: formattedEvents.length
                }));
                console.log('✅ Данные о предстоящих событиях успешно отправлены');
            } else {
                console.log('⚠️ WebSocket соединение закрыто, данные не отправлены');
            }
            
            return { sent: true, count: formattedEvents.length };
        } finally {
            connection.release();
            console.log('🔄 Соединение с БД закрыто');
        }
    } catch (error) {
        console.error('❌ Ошибка при получении предстоящих событий:', error);
        throw error;
    }
}

// Вспомогательная функция для форматирования даты
function formatDate(date) {
    return date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

// Вспомогательная функция для форматирования времени
function formatTime(date) {
    return date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Вспомогательная функция для получения относительного времени
function getRelativeTimeText(daysUntil) {
    switch (parseInt(daysUntil)) {
        case 0:
            return 'Сегодня';
        case 1:
            return 'Завтра';
        case 2:
            return 'Послезавтра';
        default:
            return `Через ${daysUntil} дн.`;
    }
}

// Функция для отправки уведомлений о предстоящих событиях
async function sendEventNotifications() {
    console.log('🔔 Отправка уведомлений о событиях пользователям онлайн');
    
    if (!pool) {
        console.error('❌ База данных недоступна');
        return { success: false, error: 'База данных недоступна' };
    }
    
    try {
        const connection = await pool.getConnection();
        
        try {
            // Получение всех онлайн пользователей
            const onlineUsers = Array.from(clients.keys());
            
            if (onlineUsers.length === 0) {
                console.log('Нет пользователей онлайн');
                return { success: true, count: 0 };
            }
            
            console.log(`Найдено ${onlineUsers.length} пользователей онлайн`);
            
            // Для каждого онлайн пользователя
            let notificationsSent = 0;
            
            for (const userId of onlineUsers) {
                const ws = clients.get(userId);
                
                if (ws && ws.readyState === WebSocket.OPEN) {
                    // Получаем события пользователя на ближайшие 3 дня
                    const [events] = await connection.execute(`
                        SELECT e.id, e.title, e.event_date, e.event_end_date, e.location, e.description,
                               DATEDIFF(e.event_date, NOW()) as days_until
                        FROM events e
                        JOIN event_participants ep ON e.id = ep.event_id
                        WHERE ep.user_id = ?
                          AND e.event_date > NOW()
                          AND e.event_date <= DATE_ADD(NOW(), INTERVAL 3 DAY)
                          AND e.status = 'active'
                          AND e.is_active = 1
                        ORDER BY e.event_date ASC
                        LIMIT 5
                    `, [userId]);
                    
                    if (events.length > 0) {
                        // Преобразуем данные для отправки
                        const formattedEvents = events.map(event => {
                            const eventDate = new Date(event.event_date);
                            const endDate = event.event_end_date ? new Date(event.event_end_date) : null;
                            
                            return {
                                id: event.id,
                                title: event.title,
                                date: eventDate.toISOString(),
                                end_date: endDate ? endDate.toISOString() : null,
                                formatted_date: formatDate(eventDate),
                                formatted_time: formatTime(eventDate),
                                formatted_end_time: endDate ? formatTime(endDate) : null,
                                location: event.location,
                                description: event.description,
                                days_until: event.days_until,
                                relative_time: getRelativeTimeText(event.days_until)
                            };
                        });
                        
                        // Отправляем уведомление о предстоящих событиях
                        ws.send(JSON.stringify({
                            type: 'event_notifications',
                            events: formattedEvents,
                            count: formattedEvents.length
                        }));
                        
                        notificationsSent++;
                        console.log(`✅ Отправлено уведомление о ${formattedEvents.length} событиях пользователю ${userId}`);
                    }
                }
            }
            
            console.log(`📊 Всего отправлено уведомлений: ${notificationsSent}`);
            return { success: true, count: notificationsSent };
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('❌ Ошибка при отправке уведомлений о событиях:', error);
        return { success: false, error: error.message };
    }
}

// Отправка уведомлений о событиях раз в час
setInterval(sendEventNotifications, 60 * 60 * 1000);

// Функция для ручной отправки уведомлений о событиях
wss.sendEventNotifications = sendEventNotifications;

// Функция для поиска клиента по userId
function findClientByUserId(userId) {
    return clients.get(userId);
}

// Функция для обработки WebRTC сообщений (аудиозвонки)
async function handleWebRTCMessage(data) {
    try {
        console.log('Обработка WebRTC сообщения:', JSON.stringify(data));
        
        // Проверяем, является ли это групповым звонком
        if (data.groupId) {
            // Обработка группового звонка
            await handleGroupWebRTCMessage(data);
            return;
        }
        
        // Определяем отправителя сообщения (может приходить в разных полях)
        const senderId = parseInt(data.sender_id || data.from || (data.ws ? data.ws.userId : undefined));
        
        // Определяем получателя сообщения (может приходить в разных форматах)
        let receiverId;
        
        if (data.receiver_id) {
            // Если receiver_id является объектом, попробуем извлечь ID из него
            if (typeof data.receiver_id === 'object') {
                receiverId = parseInt(data.receiver_id.senderId || data.receiver_id.id);
            } else {
                // Иначе используем как есть
                receiverId = parseInt(data.receiver_id);
            }
        } else {
            // Пробуем альтернативные поля
            receiverId = parseInt(data.to || data.recipient_id);
        }
        
        // Особая обработка для проверки доступности пользователя
        if (data.subtype === 'check_availability') {
            console.log(`📊 Проверка доступности пользователя ${receiverId} от ${senderId}`);
            
            // Находим WebSocket соединение получателя
            const receiverClient = findClientByUserId(receiverId);
            const senderClient = findClientByUserId(senderId);
            
            if (senderClient && senderClient.readyState === WebSocket.OPEN) {
                // Отправляем статус доступности
                const availabilityResponse = {
                    type: 'user_availability',
                    sender_id: receiverId,
                    receiver_id: senderId,
                    is_available: !!(receiverClient && receiverClient.readyState === WebSocket.OPEN),
                    reason: receiverClient ? null : 'user_offline'
                };
                
                senderClient.send(JSON.stringify(availabilityResponse));
                console.log(`✅ Отправлен статус доступности: ${availabilityResponse.is_available}`);
            }
            
            return; // Прерываем дальнейшую обработку
        }
        
        if (!senderId) {
            console.error('❌ Не определен отправитель WebRTC сообщения:', data);
            return;
        }
        
        if (!receiverId) {
            console.error('❌ Не определен получатель WebRTC сообщения:', data);
            return;
        }
        
        console.log(`📊 Перенаправление ${data.subtype} от ${senderId} к ${receiverId}`);
        
        // Находим WebSocket соединение получателя
        const receiverWs = findClientByUserId(receiverId);
        
        if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
            // Получаем дополнительную информацию о пользователе-отправителе из БД
            let senderName = 'Пользователь';
            let senderAvatar = 'assets/images/default-avatar.png';

            try {
                // Получаем имя пользователя из БД
                const fullName = await getUserNameById(senderId);
                if (fullName) {
                    senderName = fullName;
                    console.log(`✅ Получено имя пользователя ${senderId}: "${senderName}"`);
                } else {
                    console.log(`⚠️ Имя пользователя ${senderId} не найдено, используем значение по умолчанию`);
                }
            } catch (error) {
                console.error(`❌ Ошибка при получении имени пользователя ${senderId}:`, error);
            }

            try {
                // Получаем аватар пользователя из БД
                const avatarPath = await getUserAvatarById(senderId);
                if (avatarPath) {
                    senderAvatar = avatarPath;
                    console.log(`✅ Получен аватар пользователя ${senderId}: "${senderAvatar}"`);
                } else {
                    console.log(`⚠️ Аватар пользователя ${senderId} не найден, используем значение по умолчанию`);
                }
            } catch (error) {
                console.error(`❌ Ошибка при получении аватара пользователя ${senderId}:`, error);
            }
            
            // Подготавливаем сообщение с правильным форматом и добавляем информацию об отправителе
            const message = {
                type: data.type,
                subtype: data.subtype,
                sender_id: senderId,
                data: data.data || {}
            };
            
            // Явно добавляем информацию о звонящем в сообщение
            message.data.caller_name = senderName;
            message.data.caller_avatar = senderAvatar;
            
            console.log('📨 Отправка сообщения получателю с данными пользователя:', JSON.stringify(message));
            
            // Отправляем сообщение получателю
            receiverWs.send(JSON.stringify(message));
            console.log(`✅ Сообщение ${data.subtype} успешно перенаправлено от ${senderId} к ${receiverId}`);
            
            // Отправляем подтверждение отправителю
            const senderWs = findClientByUserId(senderId);
            if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                const confirmationMessage = {
                    type: 'signaling_delivered',
                    originalType: data.subtype,
                    to: receiverId
                };
                senderWs.send(JSON.stringify(confirmationMessage));
            }
        } else {
            console.error(`❌ Получатель ${receiverId} не в сети или соединение не открыто`);
            
            // Уведомляем отправителя о недоступности получателя
            const senderWs = findClientByUserId(senderId);
            if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                const errorMessage = {
                    type: 'signaling_error',
                    originalType: data.subtype,
                    to: receiverId,
                    error: 'recipient_offline'
                };
                senderWs.send(JSON.stringify(errorMessage));
            }
        }
    } catch (error) {
        console.error('❌ Ошибка при обработке WebRTC сообщения:', error, data);
    }
}

// Функция для обработки WebRTC сообщений в групповых звонках
async function handleGroupWebRTCMessage(data) {
    try {
        const { type, subtype, from, to, groupId, offer, answer, candidate } = data;
        
        console.log(`📡 Обработка группового WebRTC сообщения типа ${subtype || type} от ${from} к ${to} в группе ${groupId}`);
        
        // Если сообщение предназначено конкретному пользователю
        if (to) {
            // Находим получателя
            const receiverWs = findClientByUserId(to);
            if (!receiverWs || receiverWs.readyState !== WebSocket.OPEN) {
                console.error(`❌ Получатель ${to} не в сети или соединение не открыто`);
                
                // Уведомляем отправителя о недоступности получателя
                const senderWs = findClientByUserId(from);
                if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                    const errorMessage = {
                        type: 'signaling_error',
                        originalType: subtype || type,
                        to: to,
                        groupId: groupId,
                        error: 'recipient_offline'
                    };
                    senderWs.send(JSON.stringify(errorMessage));
                }
                return;
            }
            
            // Получаем информацию об отправителе для добавления в сообщение
            let senderName = 'Пользователь';
            let senderAvatar = 'assets/images/default-avatar.png';
            
            try {
                const fullName = await getUserNameById(from);
                if (fullName) {
                    senderName = fullName;
                }
            } catch (error) {
                console.error(`❌ Ошибка при получении имени пользователя ${from}:`, error);
            }
            
            try {
                const avatarPath = await getUserAvatarById(from);
                if (avatarPath) {
                    senderAvatar = avatarPath;
                }
            } catch (error) {
                console.error(`❌ Ошибка при получении аватара пользователя ${from}:`, error);
            }
            
            // Подготавливаем сообщение с дополнительной информацией
            const enrichedData = {
                ...data,
                sender_name: senderName,
                sender_avatar: senderAvatar
            };
            
            // Отправляем сообщение получателю
            receiverWs.send(JSON.stringify(enrichedData));
            console.log(`✅ Групповое сообщение ${subtype || type} успешно перенаправлено от ${from} к ${to} в группе ${groupId}`);
            
            // Отправляем подтверждение отправителю
            const senderWs = findClientByUserId(from);
            if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                const confirmationMessage = {
                    type: 'group_signaling_delivered',
                    originalType: subtype || type,
                    to: to,
                    groupId: groupId
                };
                senderWs.send(JSON.stringify(confirmationMessage));
            }
        } 
        // Если сообщение предназначено для всех участников группы
        else if (data.participants) {
            console.log(`📢 Рассылка группового сообщения всем участникам в группе ${groupId}`);
            
            // Получаем информацию об отправителе
            let senderName = 'Пользователь';
            let senderAvatar = 'assets/images/default-avatar.png';
            
            try {
                const fullName = await getUserNameById(from);
                if (fullName) {
                    senderName = fullName;
                }
            } catch (error) {
                console.error(`❌ Ошибка при получении имени пользователя ${from}:`, error);
            }
            
            try {
                const avatarPath = await getUserAvatarById(from);
                if (avatarPath) {
                    senderAvatar = avatarPath;
                }
            } catch (error) {
                console.error(`❌ Ошибка при получении аватара пользователя ${from}:`, error);
            }
            
            // Подготавливаем сообщение с дополнительной информацией
            const enrichedData = {
                ...data,
                sender_name: senderName,
                sender_avatar: senderAvatar
            };
            
            // Отправляем сообщение всем участникам, кроме отправителя
            let deliveredCount = 0;
            for (const participantId of data.participants) {
                // Пропускаем отправителя
                if (parseInt(participantId) === parseInt(from)) {
                    continue;
                }
                
                const participantWs = findClientByUserId(parseInt(participantId));
                if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                    participantWs.send(JSON.stringify(enrichedData));
                    deliveredCount++;
                }
            }
            
            console.log(`✅ Групповое сообщение разослано ${deliveredCount} участникам в группе ${groupId}`);
            
            // Отправляем подтверждение отправителю
            const senderWs = findClientByUserId(from);
            if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                const confirmationMessage = {
                    type: 'group_broadcast_delivered',
                    originalType: subtype || type,
                    groupId: groupId,
                    deliveredCount: deliveredCount
                };
                senderWs.send(JSON.stringify(confirmationMessage));
            }
        } else {
            console.error('❌ Групповое WebRTC сообщение не содержит получателя или список участников:', data);
        }
    } catch (error) {
        console.error('❌ Ошибка при обработке группового WebRTC сообщения:', error);
    }
}

// Функция для получения аватара пользователя по ID
async function getUserAvatarById(userId) {
    try {
        if (!pool) {
            console.error('❌ Соединение с базой данных недоступно');
            return null;
        }
        
        const connection = await pool.getConnection();
        
        try {
            const [rows] = await connection.execute(
                'SELECT avatar FROM users WHERE id = ?',
                [userId]
            );
            
            if (rows.length > 0) {
                return rows[0].avatar;
            }
            
            return null;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error(`❌ Ошибка при получении аватара пользователя ${userId}:`, error);
        return null;
    }
}

// Функция для обработки запроса на видеозвонок
function handleVideoCallRequest(data) {
    try {
        const recipientId = parseInt(data.recipientId || data.to);
        const senderId = parseInt(data.senderId || data.from);
        
        if (!recipientId || !senderId) {
            console.error('❌ Недопустимые данные для запроса видеозвонка:', data);
            return;
        }
        
        console.log(`📹 Обработка запроса на видеозвонок от ${senderId} к ${recipientId}`);
        
        // Преобразуем запрос в WebRTC формат
        const webrtcMessage = {
            type: 'webrtc_message',
            subtype: 'video_call_offer',
            sender_id: senderId,
            receiver_id: recipientId,
            data: {
                sdp: data.sdp,
                caller_name: data.senderName || 'Пользователь'
            }
        };
        
        // Перенаправляем сообщение
        handleWebRTCMessage(webrtcMessage);
    } catch (error) {
        console.error('❌ Ошибка при обработке запроса на видеозвонок:', error);
    }
}

// Функция для обработки запроса на аудиозвонок
function handleAudioCallRequest(data) {
    try {
        const recipientId = parseInt(data.recipientId || data.to);
        const senderId = parseInt(data.senderId || data.from);
        
        if (!recipientId || !senderId) {
            console.error('❌ Недопустимые данные для запроса аудиозвонка:', data);
            return;
        }
        
        console.log(`🔊 Обработка запроса на аудиозвонок от ${senderId} к ${recipientId}`);
        
        // Преобразуем запрос в WebRTC формат
        const webrtcMessage = {
            type: 'webrtc_message',
            subtype: 'audio_call_offer',
            sender_id: senderId,
            receiver_id: recipientId,
            data: {
                sdp: data.sdp,
                caller_name: data.senderName || 'Пользователь'
            }
        };
        
        // Перенаправляем сообщение
        handleWebRTCMessage(webrtcMessage);
    } catch (error) {
        console.error('❌ Ошибка при обработке запроса на аудиозвонок:', error);
    }
}

// Обновляем функцию handleMessage для обработки аутентификации
function handleMessage(ws, message) {
    try {
        const data = JSON.parse(message);
        console.log(`📩 Получено сообщение типа ${data.type}`);
        
        switch (data.type) {
            case 'authentication':
            case 'init':
                handleAuthentication(ws, data);
                break;
            case 'group_call_invitation':
                handleGroupCallInvitation(data);
                break;       
            case 'chat_message':
                handleChatMessage(data);
                break;
                
            case 'gift_message':
                handleGiftMessage(data);
                break;
                
            case 'audio_call_request':
                handleAudioCallRequest(data);
                break;
                
            case 'video_call_request':
                handleVideoCallRequest(data);
                break;
                
            case 'webrtc_message':
                handleWebRTCMessage(data);
                break;
                
            case 'typing_status':
                handleTypingStatus(data);
                break;
                
            case 'status_update':
                handleStatusUpdate(data);
                break;
                
            case 'user_warning':
                handleUserWarning(data);
                break;
                // ... существующий код ...

// В функции handleMessage добавьте или обновите обработчики для WebRTC сообщений:
case 'offer':
    case 'answer':
    case 'ice-candidate':
        const recipientId = parseInt(messageData.to);
        const senderId = parseInt(messageData.from);
        const recipientWs = clients.get(recipientId);
        
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            console.log(`📨 Forwarding ${messageData.type} from ${senderId} to ${recipientId}`);
            
            // Добавляем дополнительную информацию для отладки
            const message = {
                ...messageData,
                timestamp: new Date().toISOString()
            };
            
            try {
                recipientWs.send(JSON.stringify(message));
                console.log(`✅ Successfully forwarded ${messageData.type}`);
            } catch (error) {
                console.error(`❌ Error forwarding ${messageData.type}:`, error);
            }
        } else {
            console.log(`⚠️ Cannot forward ${messageData.type}: recipient ${recipientId} not connected`);
        }
        break;
    
    // Добавьте также обработчики для аудио звонков:
    case 'audio_call_request':
        const audioCallRecipientId = parseInt(messageData.recipientId);
        const audioCallSenderId = parseInt(messageData.senderId);
        const audioCallRecipientWs = clients.get(audioCallRecipientId);
        
        console.log('Processing audio call request:', {
            from: audioCallSenderId,
            to: audioCallRecipientId
        });
    
        if (audioCallRecipientWs && audioCallRecipientWs.readyState === WebSocket.OPEN) {
            // Check if recipient is already in a call
            if (activeСalls.has(audioCallRecipientId)) {
                ws.send(JSON.stringify({
                    type: 'audio_call_rejected',
                    reason: 'user_busy',
                    recipientId: audioCallRecipientId,
                    senderId: audioCallSenderId
                }));
                return;
            }
    
            // Save call information
            activeСalls.set(audioCallRecipientId, {
                callerId: audioCallSenderId,
                timestamp: Date.now(),
                type: 'audio'
            });
            activeСalls.set(audioCallSenderId, {
                callerId: audioCallRecipientId,
                timestamp: Date.now(),
                type: 'audio'
            });
    
            // Forward request to recipient
            audioCallRecipientWs.send(JSON.stringify({
                type: 'audio_call_request',
                senderId: audioCallSenderId,
                senderName: messageData.senderName || 'Unknown User',
                sdp: messageData.sdp
            }));
            
            console.log('Audio call request forwarded to:', audioCallRecipientId);
        } else {
            ws.send(JSON.stringify({
                type: 'audio_call_rejected',
                reason: 'user_offline',
                recipientId: audioCallRecipientId,
                senderId: audioCallSenderId
            }));
        }
        break;
    
    case 'audio_call_accepted':
        const audioAcceptedSenderId = parseInt(messageData.recipientId);
        const audioAcceptedRecipientId = parseInt(messageData.senderId);
        const audioAcceptedSenderWs = clients.get(audioAcceptedSenderId);
        
        console.log('Audio call accepted:', {
            from: audioAcceptedRecipientId,
            to: audioAcceptedSenderId
        });
        
        if (audioAcceptedSenderWs && audioAcceptedSenderWs.readyState === WebSocket.OPEN) {
            audioAcceptedSenderWs.send(JSON.stringify({
                type: 'audio_call_accepted',
                senderId: audioAcceptedRecipientId,
                sdp: messageData.sdp
            }));
        }
        break;
    
    case 'audio_call_rejected':
        const audioRejectedSenderId = parseInt(messageData.recipientId);
        const audioRejectedRecipientId = parseInt(messageData.senderId);
        const audioRejectedSenderWs = clients.get(audioRejectedSenderId);
        
        // Clean up call information
        activeСalls.delete(audioRejectedSenderId);
        activeСalls.delete(audioRejectedRecipientId);
        
        if (audioRejectedSenderWs && audioRejectedSenderWs.readyState === WebSocket.OPEN) {
            audioRejectedSenderWs.send(JSON.stringify({
                type: 'audio_call_rejected',
                senderId: audioRejectedRecipientId,
                reason: messageData.reason || 'declined'
            }));
        }
        break;
    
    case 'audio_call_end':
        const audioEndUserId = parseInt(messageData.senderId);
        const audioEndPeerId = parseInt(messageData.recipientId);
        
        // Clean up call information
        activeСalls.delete(audioEndUserId);
        activeСalls.delete(audioEndPeerId);
        
        const audioEndPeerWs = clients.get(audioEndPeerId);
        if (audioEndPeerWs && audioEndPeerWs.readyState === WebSocket.OPEN) {
            audioEndPeerWs.send(JSON.stringify({
                type: 'audio_call_end',
                senderId: audioEndUserId
            }));
        }
        break;
    
    // ... остальной код ...
                
            // Добавляем обработчики для групповых звонков
            case 'initGroupCall':
                handleInitGroupCall(data);
                break;
                
            case 'joinGroupCall':
                handleJoinGroupCall(data);
                break;
                
            case 'leaveGroupCall':
                handleLeaveGroupCall(data);
                break;
                
            case 'declineGroupCall':
                handleDeclineGroupCall(data);
                break;
                
            case 'initGroupVideoCall':
                handleInitGroupVideoCall(data);
                break;
                
            case 'leaveGroupVideoCall':
                handleLeaveGroupVideoCall(data);
                break;
                
            case 'ice_candidate':
                // Обрабатываем ICE-кандидатов так же, как WebRTC сообщения
                handleWebRTCMessage({
                    type: 'webrtc_message',
                    subtype: 'ice_candidate',
                    sender_id: data.sender_id || data.senderId,
                    receiver_id: data.recipient_id || data.recipientId,
                    data: {
                        candidate: data.candidate
                    }
                });
                break;
                
            // Остальные обработчики остаются без изменений
            case 'video_call_rejected':
                // Обрабатываем отклонение видеозвонка
                handleWebRTCMessage({
                    type: 'webrtc_message',
                    subtype: 'video_call_rejected',
                    sender_id: data.sender_id || data.senderId,
                    receiver_id: data.recipient_id || data.recipientId,
                    data: {
                        reason: data.reason || 'call_rejected'
                    }
                });
                break;
                
            case 'video_call_end':
                // Обрабатываем завершение видеозвонка
                handleWebRTCMessage({
                    type: 'webrtc_message',
                    subtype: 'video_call_end',
                    sender_id: data.sender_id || data.senderId,
                    receiver_id: data.recipient_id || data.recipientId,
                    data: {}
                });
                break;
                
            default:
                console.warn(`⚠️ Неизвестный тип сообщения: ${data.type}`);
        }
    } catch (error) {
        console.error('❌ Ошибка при обработке сообщения:', error);
    }
}

// Экспорт функции для инициализации сервера
module.exports = {
    initialize: function() {
        // Инициализируем WebSocket сервер
        initializeWebSocketServer();
        
        // Регистрируем обработчики сообщений
        messageHandlers = {
            'authentication': handleAuthentication,
            'check_user_availability': handleUserAvailabilityCheck,
            'chat_message': handleChatMessage,
            'gift_message': handleGiftMessage,
            'audio_call_request': handleAudioCallRequest,
            'video_call_request': handleVideoCallRequest,
            'webrtc_message': handleWebRTCMessage,
            'typing_status': handleTypingStatus,
            'status_update': handleStatusUpdate,
            'ice_candidate': function(data) {
                handleWebRTCMessage({
                    type: 'webrtc_message',
                    subtype: 'ice_candidate',
                    sender_id: data.sender_id || data.senderId,
                    receiver_id: data.recipient_id || data.recipientId,
                    data: { candidate: data.candidate }
                });
            },
            'video_call_rejected': function(data) {
                handleWebRTCMessage({
                    type: 'webrtc_message',
                    subtype: 'video_call_rejected',
                    sender_id: data.sender_id || data.senderId,
                    receiver_id: data.recipient_id || data.recipientId,
                    data: { reason: data.reason || 'call_rejected' }
                });
            },
            'video_call_end': function(data) {
                handleWebRTCMessage({
                    type: 'webrtc_message',
                    subtype: 'video_call_end',
                    sender_id: data.sender_id || data.senderId,
                    receiver_id: data.recipient_id || data.recipientId,
                    data: {}
                });
            },
            'user_warning': handleUserWarning
        };
        
        return wss;
    }
};

// Функция для обработки сообщений чата
// Функция для обработки сообщений чата
async function handleChatMessage(data) {
    console.log('🔄 Обработка сообщения чата:', JSON.stringify(data));
    
    try {
        // Проверяем наличие обязательных полей
        if (!data.sender_id || !data.recipient_id) {
            console.error('❌ Неверный формат сообщения чата. Отсутствуют обязательные поля:');
            console.error('sender_id:', data.sender_id);
            console.error('recipient_id:', data.recipient_id);
            
            // Отправляем ответ с ошибкой, если есть WebSocket соединение
            if (data.ws && data.ws.readyState === WebSocket.OPEN) {
                data.ws.send(JSON.stringify({
                    type: 'error',
                    error: 'Missing required fields',
                    details: 'Отсутствуют обязательные поля sender_id и/или recipient_id'
                }));
            }
            return;
        }
        
        // Проверяем соединение с БД
        if (!pool) {
            console.error('❌ Соединение с базой данных недоступно');
            return;
        }
        
        const connection = await pool.getConnection();
        
        try {
            // Подготавливаем данные для сохранения с проверкой на undefined
            const messageToSave = {
                sender_id: data.sender_id,
                recipient_id: data.recipient_id,
                message_text: data.message_text || '',
                message_type: data.message_type || 'text',
                image_url: data.message_type === 'image' ? (data.image_url || null) : null,
                video_url: data.message_type === 'video' ? (data.video_url || data.file_url || null) : null,
                file_url: data.message_type === 'file' ? (data.file_url || null) : null,
                file_name: data.file_name || null
            };
            
            // Сохраняем сообщение в базу данных
            const [result] = await connection.execute(
                `INSERT INTO messages 
                (sender_id, recipient_id, message_text, message_type, image_url, video_url, file_url, file_name, created_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    messageToSave.sender_id,
                    messageToSave.recipient_id,
                    messageToSave.message_text,
                    messageToSave.message_type,
                    messageToSave.image_url,
                    messageToSave.video_url,
                    messageToSave.file_url,
                    messageToSave.file_name
                ]
            );
            
            // Получаем полную информацию о сообщении
            const [savedMessageData] = await connection.execute(
                `SELECT m.*, u.username as sender_username, u.avatar as sender_avatar 
                FROM messages m 
                JOIN users u ON m.sender_id = u.id 
                WHERE m.id = ?`,
                [result.insertId]
            );
            
            if (!savedMessageData.length) {
                throw new Error('Не удалось получить данные сохраненного сообщения');
            }
            
            const savedMessage = savedMessageData[0];
            
            // Отправляем подтверждение отправителю
            const senderWs = clients.get(data.sender_id);
            if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                senderWs.send(JSON.stringify({
                    type: 'message_saved',
                    message_id: savedMessage.id,
                    temp_id: data.temp_id,
                    created_at: savedMessage.created_at
                }));
            }
            
            // Отправляем сообщение получателю, если он онлайн
            const recipientWs = clients.get(data.recipient_id);
            if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                recipientWs.send(JSON.stringify({
                    type: 'chat_message',
                    id: savedMessage.id,
                    sender_id: data.sender_id,
                    recipient_id: data.recipient_id,
                    message_text: savedMessage.message_text,
                    message_type: savedMessage.message_type,
                    image_url: savedMessage.image_url,
                    video_url: savedMessage.video_url,
                    file_url: savedMessage.file_url,
                    file_name: savedMessage.file_name,
                    created_at: savedMessage.created_at,
                    is_read: 0,
                    sender_username: savedMessage.sender_username,
                    sender_avatar: savedMessage.sender_avatar
                }));
                
                console.log(`✅ Сообщение отправлено получателю ${data.recipient_id}`);
            } else {
                console.log(`⚠️ Получатель ${data.recipient_id} не в сети`);
            }
            
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('❌ Ошибка при обработке сообщения чата:', error);
    }
}

// Функция для обработки запросов статуса message_saved пользователя
async function handleUserAvailabilityCheck(ws, data) {
    try {
        console.log(`📊 Запрос статуса пользователя: ${data.userId}`);
        
        if (!data.userId) {
            console.error('❌ Отсутствует ID пользователя в запросе статуса');
            return;
        }
        
        // Проверяем статус пользователя
        const isOnline = clients.has(data.userId.toString());
        
        console.log(`👤 Статус пользователя ${data.userId}: ${isOnline ? 'онлайн' : 'оффлайн'}`);
        
        // Отправляем ответ запрашивающему клиенту
        const response = {
            type: 'status_update',
            userId: data.userId,
            isOnline: isOnline,
            timestamp: new Date().toISOString()
        };
        
        ws.send(JSON.stringify(response));
        
        // Также обновляем статус в БД, если пользователь онлайн
        if (isOnline) {
            if (pool) {
                try {
                    const connection = await pool.getConnection();
                    try {
                        await connection.execute(
                            'UPDATE users SET last_activity = NOW() WHERE id = ?',
                            [data.userId]
                        );
                    } finally {
                        connection.release();
                    }
                } catch (dbError) {
                    console.error('❌ Ошибка обновления last_activity в БД:', dbError);
                }
            }
        }
    } catch (error) {
        console.error('❌ Ошибка при обработке запроса статуса пользователя:', error);
    }
}

// Добавляем функцию для обработки аутентификации
function handleAuthentication(ws, data) {
    try {
        if (!data.userId) {
            console.error('❌ Отсутствует userId в сообщении аутентификации');
            return;
        }
        
        const userId = parseInt(data.userId);
        
        console.log('👤 Аутентификация пользователя:', userId);
        
        // Сохраняем userId в объекте ws
        ws.userId = userId;
        
        // Сохраняем соединение в Map клиентов
        clients.set(userId, ws);
        
        // Устанавливаем статус "онлайн"
        userStatuses.set(userId, true);
        
        // Отправляем подтверждение аутентификации клиенту
        ws.send(JSON.stringify({
            type: 'auth_success',
            userId: userId,
            timestamp: new Date().toISOString()
        }));
        
        // Оповещаем всех о подключении пользователя
        broadcastStatus(userId, true);
        
        console.log('✅ Пользователь аутентифицирован:', {
            userId: userId,
            totalClients: clients.size,
            onlineUsers: Array.from(userStatuses.entries())
                .filter(([_, status]) => status).length
        });
        
        // Обновляем статус в БД, если подключение доступно
        if (pool) {
            try {
                (async () => {
                    const connection = await pool.getConnection();
                    try {
                        await connection.execute(
                            'UPDATE users SET is_online = 1, last_seen = NOW() WHERE id = ?',
                            [userId]
                        );
                        console.log('✅ Статус пользователя обновлен в БД:', userId);
                    } catch (error) {
                        console.error('❌ Ошибка обновления статуса пользователя в БД:', error);
                    } finally {
                        connection.release();
                    }
                })();
            } catch (error) {
                console.error('❌ Ошибка при работе с БД:', error);
            }
        }
    } catch (error) {
        console.error('❌ Ошибка при аутентификации пользователя:', error);
    }
}

// Add handler function for user warnings
function handleUserWarning(data) {
    try {
        console.log('📝 Обработка уведомления о предупреждении пользователя:', data);
        
        // Check if recipient is specified
        if (!data.userId) {
            console.error('❌ Отсутствует ID получателя предупреждения');
            return;
        }
        
        const userId = parseInt(data.userId);
        
        // Check if user is online
        const recipientWs = clients.get(userId);
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            console.log(`✅ Отправка уведомления о предупреждении пользователю ${userId}`);
            
            // Forward the warning notification to the user
            recipientWs.send(JSON.stringify({
                type: 'user_warning',
                warning: data
            }));
        } else {
            console.log(`⚠️ Пользователь ${userId} не в сети, уведомление не отправлено`);
            // User is offline, will see notification when they log in
        }
        
        // Attempt to send an email if no WebSocket is available
        if (data.email && (!recipientWs || recipientWs.readyState !== WebSocket.OPEN)) {
            sendWarningEmail(data);
        }
    } catch (error) {
        console.error('❌ Ошибка при обработке предупреждения пользователя:', error);
    }
}

// Function to send warning email
function sendWarningEmail(data) {
    try {
        if (!data.email || !data.userName || !data.reason) {
            console.error('❌ Недостаточно данных для отправки email с предупреждением');
            return;
        }
        
        const duration_text = (data.duration == 0) ? 'Permanent' : data.duration + ' day(s)';
        const expiry_text = (data.duration == 0) ? 'This warning does not expire' : 'This warning expires in ' + data.duration + ' days';
        
        // Create HTML message
        const message = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset='UTF-8'>
            <meta name='viewport' content='width=device-width, initial-scale=1.0'>
            <title>Warning Notice</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    margin: 0;
                    padding: 0;
                }
                .container {
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                    border: 1px solid #ddd;
                    border-radius: 5px;
                }
                .header {
                    background-color: #f8d7da;
                    color: #721c24;
                    padding: 15px;
                    margin-bottom: 20px;
                    border-radius: 5px;
                    border-left: 5px solid #f5c6cb;
                }
                .content {
                    padding: 15px;
                }
                .footer {
                    margin-top: 30px;
                    padding-top: 10px;
                    border-top: 1px solid #ddd;
                    font-size: 12px;
                    color: #666;
                }
                h2 {
                    color: #721c24;
                }
                .warning-details {
                    background-color: #f8f9fa;
                    padding: 15px;
                    border-radius: 5px;
                    margin: 15px 0;
                }
                .warning-reason {
                    font-weight: bold;
                    font-size: 16px;
                    color: #721c24;
                }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='header'>
                    <h2>Warning Notice</h2>
                </div>
                <div class='content'>
                    <p>Dear ${data.userName},</p>
                    
                    <p>Your account has received a warning from one of our administrators. Please review the details below and ensure that you follow our community guidelines.</p>
                    
                    <div class='warning-details'>
                        <p><strong>Reason:</strong> <span class='warning-reason'>${data.reason}</span></p>
                        <p><strong>Details:</strong> ${data.details || 'No details provided'}</p>
                        <p><strong>Duration:</strong> ${duration_text}</p>
                        <p><strong>Expiry:</strong> ${expiry_text}</p>
                        <p><strong>Issued by:</strong> ${data.adminName || 'Administrator'}</p>
                        <p><strong>Issued on:</strong> ${new Date().toLocaleDateString()}</p>
                    </div>
                    
                    <p>Please note that multiple warnings may result in account restrictions or suspension.</p>
                    
                    <p>If you believe this warning was issued in error, please contact our support team for assistance.</p>
                    
                    <p>Thank you for your cooperation.</p>
                </div>
                <div class='footer'>
                    <p>This is an automated message. Please do not reply to this email.</p>
                    <p>&copy; ${new Date().getFullYear()} Our Website. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>`;
        
        // Send the email
        sendEmailNotification(data.email, 'Warning Notice - Account Action Required', message)
            .then(() => {
                console.log(`✅ Email с предупреждением успешно отправлен на ${data.email}`);
            })
            .catch(error => {
                console.error(`❌ Ошибка отправки email с предупреждением:`, error);
            });
    } catch (error) {
        console.error('❌ Ошибка при создании email с предупреждением:', error);
    }
}

// Функция для обработки индикатора набора текста
function handleTypingStatus(data) {
    try {
        console.log('💬 Обработка статуса набора текста:', data);
        
        // Проверяем, что есть идентификаторы отправителя и получателя
        if (!data.sender_id || !data.recipient_id) {
            console.error('❌ Недостаточно данных для обработки статуса набора текста');
            return;
        }
        
        const senderId = parseInt(data.sender_id);
        const recipientId = parseInt(data.recipient_id);
        
        // Находим соединение получателя
        const recipientWs = clients.get(recipientId);
        
        // Если получатель в сети, отправляем ему статус набора текста
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            console.log(`📤 Отправка статуса набора текста пользователю ${recipientId}`);
            
            recipientWs.send(JSON.stringify({
                type: 'typing_status',
                sender_id: senderId,
                recipient_id: recipientId,
                is_typing: data.is_typing || false
            }));
        } else {
            console.log(`⚠️ Получатель ${recipientId} не в сети, статус набора текста не отправлен`);
        }
    } catch (error) {
        console.error('❌ Ошибка при обработке статуса набора текста:', error);
    }
}

// Функция для обработки обновления статуса пользователя
function handleStatusUpdate(data) {
    try {
        console.log('👤 Обработка обновления статуса пользователя:', data);
        
        // Проверяем, что есть ID пользователя и статус
        if (!data.userId || typeof data.isOnline !== 'boolean') {
            console.error('❌ Недостаточно данных для обновления статуса пользователя');
            return;
        }
        
        const userId = parseInt(data.userId);
        const isOnline = data.isOnline;
        
        // Обновляем статус в нашем хранилище
        userStatuses.set(userId, isOnline);
        
        // Оповещаем всех о новом статусе
        broadcastStatus(userId, isOnline);
        
        // Обновляем статус в БД, если подключение доступно
        if (pool) {
            (async () => {
                try {
                    const connection = await pool.getConnection();
                    try {
                        await connection.execute(
                            'UPDATE users SET is_online = ?, last_seen = NOW() WHERE id = ?',
                            [isOnline ? 1 : 0, userId]
                        );
                        console.log(`✅ Статус пользователя ${userId} обновлен в БД: ${isOnline ? 'online' : 'offline'}`);
                    } finally {
                        connection.release();
                    }
                } catch (error) {
                    console.error('❌ Ошибка обновления статуса пользователя в БД:', error);
                }
            })();
        }
    } catch (error) {
        console.error('❌ Ошибка при обработке обновления статуса пользователя:', error);
    }
}

// Функция для отправки уведомления о событии через WebSocket
async function sendEventWebSocketNotification(userId, event) {
    try {
        // Находим клиента по userId
        const client = clients.get(userId);
        if (!client) {
            console.log(`Клиент ${userId} не найден для отправки уведомления`);
            return;
        }

        // Формируем сообщение
        const message = {
            type: 'event_notification',
            event: {
                id: event.id,
                title: event.title,
                event_date: event.event_date,
                location: event.location,
                description: event.description
            }
        };

        // Отправляем сообщение
        client.send(JSON.stringify(message));
        console.log(`Уведомление о событии отправлено пользователю ${userId}:`, message);
    } catch (error) {
        console.error('Ошибка отправки WebSocket уведомления:', error);
    }
}

// В функции checkEventsForDate добавляем отправку WebSocket уведомлений
async function checkEventsForDate(date, daysUntil) {
    try {
        // ... existing code ...

        // После получения информации о событиях
        for (const event of events) {
            for (const userId of event.userIds) {
                // Проверяем, не было ли уже отправлено уведомление
                const notificationKey = `event_${event.id}_${userId}_${daysUntil}`;
                if (!sentNotifications.has(notificationKey)) {
                    // Отправляем email уведомление
                    await sendEmailNotification(userId, event);
                    
                    // Отправляем WebSocket уведомление
                    await sendEventWebSocketNotification(userId, event);
                    
                    sentNotifications.add(notificationKey);
                }
            }
        }
    } catch (error) {
        console.error('Ошибка при проверке событий:', error);
    }
}

// Функция для отправки уведомлений о событиях через WebSocket
async function sendEventNotifications(events, userId) {
    try {
        // Проверяем, есть ли подключенный клиент для этого пользователя
        const client = connectedClients.get(userId);
        if (!client) {
            console.log(`Клиент не найден для пользователя ${userId}`);
            return;
        }

        // Форматируем события для отправки
        const formattedEvents = events.map(event => ({
            id: event.id,
            title: event.title,
            date: event.event_date,
            location: event.location,
            description: event.description,
            priority: getEventPriority(event.event_date)
        }));

        // Отправляем уведомления через WebSocket
        client.send(JSON.stringify({
            type: 'event_notifications',
            events: formattedEvents
        }));

        console.log(`Отправлено ${formattedEvents.length} уведомлений пользователю ${userId}`);
    } catch (error) {
        console.error('Ошибка при отправке уведомлений через WebSocket:', error);
    }
}

// Функция для определения приоритета события
function getEventPriority(eventDate) {
    const now = new Date();
    const event = new Date(eventDate);
    const diffDays = Math.ceil((event - now) / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 1) return 'high';
    if (diffDays <= 3) return 'medium';
    return 'low';
}

// Обновляем функцию checkEvents
async function checkEvents() {
    try {
        console.log('🚀 Запуск начальной проверки событий...');
        
        // Получаем даты для проверки (сегодня и следующие 3 дня)
        const dates = [0, 1, 2, 3].map(days => {
            const date = new Date();
            date.setDate(date.getDate() + days);
            return date.toISOString().split('T')[0];
        });
        
        console.log('🔍 Начинается проверка событий на даты:', dates);
        
        // Устанавливаем соединение с БД
        const connection = await pool.getConnection();
        console.log('✅ Соединение с БД установлено');
        
        let totalNotifications = 0;
        const details = {};
        
        // Проверяем каждую дату
        for (const date of dates) {
            const daysUntil = dates.indexOf(date);
            console.log(`📅 Проверка событий на дату: ${date} (за ${daysUntil} дн. до события)`);
            
            // Получаем список участников для этой даты
            const [eventGoingRows] = await connection.execute(
                `SELECT eg.*, e.title, e.event_date, e.location, e.description 
                 FROM event_going eg 
                 JOIN events e ON eg.event_id = e.id 
                 WHERE DATE(e.event_date) = ?`,
                [date]
            );
            
            if (eventGoingRows.length === 0) {
                console.log(`⚠️ Нет активных событий на дату ${date}`);
                continue;
            }
            
            // Получаем уникальные ID пользователей
            const userIds = [...new Set(eventGoingRows.map(row => row.user_id))];
            
            // Получаем информацию о пользователях
            const [users] = await connection.execute(
                'SELECT id, username, email FROM users WHERE id IN (?)',
                [userIds]
            );
            
            console.log(`📊 Найдено ${eventGoingRows.length} пар участник-событие`);
            console.log(`📧 Запрос к таблице users для получения информации о ${users.length} пользователях...`);
            
            // Формируем уведомления для каждого пользователя
            for (const user of users) {
                const userEvents = eventGoingRows.filter(row => row.user_id === user.id);
                
                for (const event of userEvents) {
                    // Проверяем, не было ли уже отправлено уведомление
                    const [existingNotification] = await connection.execute(
                        `SELECT id FROM event_notification_log 
                         WHERE user_id = ? AND event_id = ? AND days_until = ? 
                         AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
                        [user.id, event.event_id, daysUntil]
                    );
                    
                    if (existingNotification.length > 0) {
                        console.log(`📌 Уведомление для события ${event.event_id} пользователю ${user.id} за ${daysUntil} дн. уже было отправлено ранее`);
                        continue;
                    }
                    
                    // Отправляем уведомление через WebSocket
                    await sendEventNotifications([event], user.id);
                    
                    // Логируем отправку уведомления
                    await connection.execute(
                        `INSERT INTO event_notification_log (user_id, event_id, days_until, created_at) 
                         VALUES (?, ?, ?, NOW())`,
                        [user.id, event.event_id, daysUntil]
                    );
                    
                    totalNotifications++;
                    details[daysUntil] = (details[daysUntil] || 0) + 1;
                }
            }
        }
        
        console.log(`📊 Итого отправлено уведомлений: ${totalNotifications}`);
        connection.release();
        
        return {
            total: totalNotifications,
            details
        };
    } catch (error) {
        console.error('Ошибка при проверке событий:', error);
        throw error;
    }
}

// Function to handle gift messages
function handleGiftMessage(data) {
    try {
        const recipientId = parseInt(data.recipient_id);
        const senderId = parseInt(data.sender_id);
        
        if (!recipientId || !senderId) {
            console.error('❌ Invalid data for gift message:', data);
            return;
        }
        
        console.log(`🎁 Processing gift message from ${senderId} to ${recipientId}`);
        
        // Find recipient client
        const recipientClient = findClientByUserId(recipientId);
        
        if (recipientClient) {
            // Get sender information
            getUserNameById(senderId).then(senderName => {
                // Send notification to recipient
                const notification = {
                    type: 'gift_notification',
                    sender_id: senderId,
                    sender_name: senderName || 'Пользователь',
                    data: data.data || {}
                };
                
                recipientClient.send(JSON.stringify(notification));
                console.log(`🎁 Gift notification sent to user ${recipientId}`);
                
                // Send email notification if user is offline
                if (recipientClient.readyState !== WebSocket.OPEN) {
                    getUserEmailFromDB(recipientId).then(email => {
                        if (email) {
                            const subject = 'Новый подарок';
                            const message = `Пользователь ${senderName || 'Пользователь'} отправил вам подарок. Войдите, чтобы посмотреть.`;
                            sendEmailNotification(email, subject, message);
                            console.log(`📧 Gift email notification sent to ${email}`);
                        }
                    }).catch(error => {
                        console.error('❌ Error getting recipient email:', error);
                    });
                }
            }).catch(error => {
                console.error('❌ Error getting sender name:', error);
            });
        } else {
            console.log(`⚠️ Recipient ${recipientId} not found or offline`);
            
            // Store notification for when they come online
            // (Implementation depends on your notification system)
        }
    } catch (error) {
        console.error('❌ Error processing gift message:', error);
    }
}

// Обработчик сообщений о подарках
function handleGiftMessage(message) {
    console.log('Handling gift message:', message);
    
    // Проверяем наличие необходимых полей
    if (!message.sender_id || !message.recipient_id) {
        console.error('Missing required fields in gift message');
        return;
    }
    
    // Получаем ID отправителя и получателя
    const senderId = parseInt(message.sender_id);
    const recipientId = parseInt(message.recipient_id);
    
    // Находим соединения получателя
    const recipientConnections = clients.filter(client => client.userId === recipientId);
    
    // Если есть соединения получателя, отправляем уведомление
    if (recipientConnections.length > 0) {
        console.log(`Found ${recipientConnections.length} connections for recipient ${recipientId}`);
        
        // Создаем сообщение для получателя
        const notificationMessage = {
            type: 'gift_notification',
            sender_id: senderId,
            sender_name: message.sender_name || 'Неизвестный отправитель',
            timestamp: new Date().toISOString(),
            message: 'Вам отправили подарок!',
            files: message.files || []
        };
        
        // Отправляем уведомление всем соединениям получателя
        recipientConnections.forEach(client => {
            client.ws.send(JSON.stringify(notificationMessage));
            console.log(`Sent gift notification to client ${client.userId}`);
        });
    } else {
        console.log(`Recipient ${recipientId} is offline, sending email notification`);
        
        // Отправляем уведомление по почте, если пользователь офлайн
        sendEmailNotification(recipientId, {
            type: 'gift',
            sender_id: senderId,
            message: 'Вам отправили подарок!'
        });
    }
}

// В функции handleMessage добавляем обработку сообщений о подарках
// В функции handleMessage добавляем обработку сообщений о подарках
function handleMessage(message) {
    try {
        // Проверяем тип сообщения и преобразуем его соответствующим образом
        let messageData;
        
        if (typeof message === 'string') {
            // Если сообщение - строка, парсим его как JSON
            messageData = JSON.parse(message);
        } else if (typeof message === 'object') {
            // Если сообщение уже является объектом, используем его напрямую
            messageData = message;
        } else {
            // Неизвестный тип сообщения
            console.error('❌ Неизвестный тип сообщения:', typeof message);
            return;
        }
        
        // Определяем тип сообщения
        const messageType = messageData.type || 'unknown';
        
        console.log(`Получено сообщение типа: ${messageType}`);
        
        // Обработка разных типов сообщений
        switch (messageType) {
            case 'gift':
                handleGiftMessage(messageData);
                break;
            case 'group_call_invitation':
                // Исправлено: используем messageData вместо data
                handleGroupCallInvitation(messageData);
                break;   
            case 'webrtc_message':
                handleWebRTCMessage(messageData);
                break;
            
            // ... остальной код без изменений ...
            
            case 'authentication':
            case 'init':
                handleAuthentication(messageData.ws, messageData);
                break;
                
            case 'chat_message':
                handleChatMessage(messageData);
                break;
                
            case 'audio_call_request':
                handleAudioCallRequest(messageData);
                break;
                
            case 'video_call_request':
                handleVideoCallRequest(messageData);
                break;
                
            case 'typing_status':
                handleTypingStatus(messageData);
                break;
                
            case 'status_update':
                handleStatusUpdate(messageData);
                break;
                
            case 'user_warning':
                handleUserWarning(messageData);
                break;
                // ... существующий код ...

// В функции handleMessage добавьте или обновите обработчики для WebRTC сообщений:
case 'offer':
    case 'answer':
    case 'ice-candidate':
        const recipientId = parseInt(messageData.to);
        const senderId = parseInt(messageData.from);
        const recipientWs = clients.get(recipientId);
        
        if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            console.log(`📨 Forwarding ${messageData.type} from ${senderId} to ${recipientId}`);
            
            // Добавляем дополнительную информацию для отладки
            const message = {
                ...messageData,
                timestamp: new Date().toISOString()
            };
            
            try {
                recipientWs.send(JSON.stringify(message));
                console.log(`✅ Successfully forwarded ${messageData.type}`);
            } catch (error) {
                console.error(`❌ Error forwarding ${messageData.type}:`, error);
            }
        } else {
            console.log(`⚠️ Cannot forward ${messageData.type}: recipient ${recipientId} not connected`);
        }
        break;
    
    // Добавьте также обработчики для аудио звонков:
    case 'audio_call_request':
        const audioCallRecipientId = parseInt(messageData.recipientId);
        const audioCallSenderId = parseInt(messageData.senderId);
        const audioCallRecipientWs = clients.get(audioCallRecipientId);
        
        console.log('Processing audio call request:', {
            from: audioCallSenderId,
            to: audioCallRecipientId
        });
    
        if (audioCallRecipientWs && audioCallRecipientWs.readyState === WebSocket.OPEN) {
            // Check if recipient is already in a call
            if (activeСalls.has(audioCallRecipientId)) {
                ws.send(JSON.stringify({
                    type: 'audio_call_rejected',
                    reason: 'user_busy',
                    recipientId: audioCallRecipientId,
                    senderId: audioCallSenderId
                }));
                return;
            }
    
            // Save call information jitsi
            activeСalls.set(audioCallRecipientId, {
                callerId: audioCallSenderId,
                timestamp: Date.now(),
                type: 'audio'
            });
            activeСalls.set(audioCallSenderId, {
                callerId: audioCallRecipientId,
                timestamp: Date.now(),
                type: 'audio'
            });
    
            // Forward request to recipient
            audioCallRecipientWs.send(JSON.stringify({
                type: 'audio_call_request',
                senderId: audioCallSenderId,
                senderName: messageData.senderName || 'Unknown User',
                sdp: messageData.sdp
            }));
            
            console.log('Audio call request forwarded to:', audioCallRecipientId);
        } else {
            ws.send(JSON.stringify({
                type: 'audio_call_rejected',
                reason: 'user_offline',
                recipientId: audioCallRecipientId,
                senderId: audioCallSenderId
            }));
        }
        break;
    
    case 'audio_call_accepted':
        const audioAcceptedSenderId = parseInt(messageData.recipientId);
        const audioAcceptedRecipientId = parseInt(messageData.senderId);
        const audioAcceptedSenderWs = clients.get(audioAcceptedSenderId);
        
        console.log('Audio call accepted:', {
            from: audioAcceptedRecipientId,
            to: audioAcceptedSenderId
        });
        
        if (audioAcceptedSenderWs && audioAcceptedSenderWs.readyState === WebSocket.OPEN) {
            audioAcceptedSenderWs.send(JSON.stringify({
                type: 'audio_call_accepted',
                senderId: audioAcceptedRecipientId,
                sdp: messageData.sdp
            }));
        }
        break;
    
    case 'audio_call_rejected':
        const audioRejectedSenderId = parseInt(messageData.recipientId);
        const audioRejectedRecipientId = parseInt(messageData.senderId);
        const audioRejectedSenderWs = clients.get(audioRejectedSenderId);
        
        // Clean up call information
        activeСalls.delete(audioRejectedSenderId);
        activeСalls.delete(audioRejectedRecipientId);
        
        if (audioRejectedSenderWs && audioRejectedSenderWs.readyState === WebSocket.OPEN) {
            audioRejectedSenderWs.send(JSON.stringify({
                type: 'audio_call_rejected',
                senderId: audioRejectedRecipientId,
                reason: messageData.reason || 'declined'
            }));
        }
        break;
    
    case 'audio_call_end':
        const audioEndUserId = parseInt(messageData.senderId);
        const audioEndPeerId = parseInt(messageData.recipientId);
        
        // Clean up call information
        activeСalls.delete(audioEndUserId);
        activeСalls.delete(audioEndPeerId);
        
        const audioEndPeerWs = clients.get(audioEndPeerId);
        if (audioEndPeerWs && audioEndPeerWs.readyState === WebSocket.OPEN) {
            audioEndPeerWs.send(JSON.stringify({
                type: 'audio_call_end',
                senderId: audioEndUserId
            }));
        }
        break;
    
    // ... остальной код ...
                
            // Добавляем обработчики для групповых звонков
            case 'initGroupCall':
                handleInitGroupCall(messageData);
                break;
                
            case 'joinGroupCall':
                handleJoinGroupCall(messageData);
                break;
                
            case 'leaveGroupCall':
                handleLeaveGroupCall(messageData);
                break;
                
            case 'declineGroupCall':
                handleDeclineGroupCall(messageData);
                break;
                
            case 'initGroupVideoCall':
                handleInitGroupVideoCall(messageData);
                break;
                
            case 'leaveGroupVideoCall':
                handleLeaveGroupVideoCall(messageData);
                break;
                
            case 'ice_candidate':
                // Обрабатываем ICE-кандидатов как WebRTC сообщения
                handleWebRTCMessage({
                    type: 'webrtc_message',
                    subtype: 'ice_candidate',
                    sender_id: messageData.sender_id || messageData.senderId,
                    receiver_id: messageData.recipient_id || messageData.recipientId,
                    data: {
                        candidate: messageData.candidate
                    }
                });
                break;
                
            case 'video_call_rejected':
                // Обрабатываем отклонение видеозвонка
                handleWebRTCMessage({
                    type: 'webrtc_message',
                    subtype: 'video_call_rejected',
                    sender_id: messageData.sender_id || messageData.senderId,
                    receiver_id: messageData.recipient_id || messageData.recipientId,
                    data: {
                        reason: messageData.reason || 'call_rejected'
                    }
                });
                break;
            
            case 'check_availability':
                // Обработка проверки доступности пользователя
                handleUserAvailabilityCheck(messageData.ws, messageData);
                break;
                
            default:
                console.log(`Неизвестный тип сообщения: ${messageType}`);
                break;
        }
    } catch (error) {
        console.error('❌ Ошибка при обработке сообщения:', error);
    }
}// Функция для обработки инициализации группового звонка
// Структуры данных для групповых звонков
// ... existing code ...
// Функция для обработки приглашений на групповой звонок
// ... existing code ...

function handleGroupCallInvitation(data) {
    try {
        console.log('Обработка приглашения на групповой звонок:', data);
        
        // Проверяем наличие необходимых данных
        if (!data.groupId || !data.initiatorId) {
            console.error('❌ Недостаточно данных для приглашения на групповой звонок:', data);
            return;
        }
        
        // Используем roomId из данных или создаем новый
        const roomId = data.roomId || `group_${data.groupId}_${Date.now()}`;
        
        // Получаем ID инициатора как число
        const initiatorId = parseInt(data.initiatorId);
        
        // Счетчик отправленных приглашений
        let invitationsSent = 0;
        let failedInvitations = [];
        
        console.log(`🔍 Всего подключенных клиентов: ${clients.size}`);
        
        // Перебираем всех подключенных пользователей
        clients.forEach((clientWs, clientId) => {
            // Пропускаем инициатора
            if (clientId === initiatorId) {
                console.log(`⏭️ Пропускаем инициатора: ${initiatorId}`);
                return;
            }
            
            console.log(`👤 Проверка клиента ${clientId}, статус: ${clientWs ? clientWs.readyState : 'не существует'}`);
            
            // Проверяем, что соединение открыто
            if (clientWs && clientWs.readyState === WebSocket.OPEN) {
                try {
                    console.log(`📤 Отправка приглашения пользователю ${clientId}`);
                    
                    // Отправляем приглашение с добавлением аватарок
                    clientWs.send(JSON.stringify({
                        type: 'group_call_invitation',
                        roomId: roomId,
                        groupId: data.groupId,
                        groupName: data.groupName || 'Групповой звонок',
                        groupAvatar: data.groupAvatar || 'assets/images/group/default-avatar.jpg',
                        groupCover: data.groupCover || 'assets/images/group/default-cover.jpg',
                        initiatorId: initiatorId,
                        initiatorName: data.initiatorName || 'Пользователь',
                        initiatorAvatar: data.initiatorAvatar || 'assets/images/avatars/default.jpg',
                        callType: data.callType || (data.isAudioOnly ? 'audio' : 'video'),
                        isAudioOnly: data.isAudioOnly || data.callType === 'audio',
                        joinUrl: data.joinUrl || `join-room.php?room=${roomId}&group=${data.groupId}`
                    }));
                    
                    invitationsSent++;
                    console.log(`✅ Успешно отправлено приглашение пользователю ${clientId}`);
                } catch (err) {
                    console.error(`❌ Ошибка при отправке приглашения пользователю ${clientId}:`, err);
                    failedInvitations.push(clientId);
                }
            } else {
                console.log(`⚠️ Клиент ${clientId} не в сети или соединение закрыто`);
                failedInvitations.push(clientId);
            }
        });
        
        console.log(`📊 Итоги: отправлено ${invitationsSent} приглашений, не удалось отправить ${failedInvitations.length} приглашений`);
        if (failedInvitations.length > 0) {
            console.log(`⚠️ Не удалось отправить приглашения пользователям: ${failedInvitations.join(', ')}`);
        }
        
        // Отправляем подтверждение инициатору через clients Map напрямую
        const initiatorWs = clients.get(initiatorId);
        if (initiatorWs && initiatorWs.readyState === WebSocket.OPEN) {
            try {
                initiatorWs.send(JSON.stringify({
                    type: 'group_call_initiated',
                    roomId: roomId,
                    groupId: data.groupId,
                    invitationsSent: invitationsSent
                }));
                console.log(`✅ Отправлено подтверждение инициатору ${initiatorId}`);
            } catch (err) {
                console.error(`❌ Ошибка при отправке подтверждения инициатору ${initiatorId}:`, err);
            }
        } else {
            console.log(`⚠️ Инициатор ${initiatorId} не в сети или соединение закрыто`);
        }
    } catch (error) {
        console.error('❌ Ошибка при обработке приглашения на групповой звонок:', error);
    }
}

// ... existing code ...

// Функция для обработки инициализации группового звонка
function handleInitGroupCall(data) {
    console.log('📞 Processing group call initiation:', {
        groupId: data.groupId,
        initiator: data.initiator,
        participants: data.participants
    });

    // Сохраняем информацию о звонке для инициатора
    const initiatorWs = clients.get(parseInt(data.initiator.id));
    if (initiatorWs) {
        initiatorWs.groupCall = data.groupId;
        initiatorWs.userInfo = data.initiator;
    }

    // Отправляем уведомление всем участникам, кроме инициатора
    if (Array.isArray(data.participants)) {
        // Создаем массив для отслеживания успешных отправок
        let notificationsSent = 0;
        const totalParticipants = data.participants.length;
        
        data.participants.forEach(participantId => {
            const currentParticipantId = parseInt(participantId);
            const initiatorId = parseInt(data.initiator.id);
            
            if (currentParticipantId === initiatorId) {
                console.log(`Skipping notification for initiator: ${initiatorId}`);
                return;
            }

            const participantWs = clients.get(currentParticipantId);
            if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                console.log(`📨 Sending call notification to participant: ${currentParticipantId}`);
                participantWs.send(JSON.stringify({
                    type: 'incomingGroupCall',
                    groupId: data.groupId,
                    groupName: data.groupName,
                    initiator: data.initiator
                }));
                notificationsSent++;
            } else {
                console.log(`⚠️ Participant ${currentParticipantId} is not connected`);
            }
        });
        
        // Отправляем инициатору информацию о количестве отправленных уведомлений
        if (initiatorWs && initiatorWs.readyState === WebSocket.OPEN) {
            initiatorWs.send(JSON.stringify({
                type: 'callNotificationStatus',
                sent: notificationsSent,
                total: totalParticipants - 1, // Исключаем инициатора
                groupId: data.groupId
            }));
        }
    }
}

// Функция для обработки присоединения к групповому звонку
function handleJoinGroupCall(data) {
    console.log('📞 Processing join group call:', {
        groupId: data.groupId,
        userId: data.userId,
        userInfo: data.userInfo
    });

    // Получаем всех текущих участников звонка
    const activeParticipants = [];
    
    // Сначала собираем информацию о существующих участниках
    clients.forEach((ws, clientId) => {
        if (ws.groupCall === data.groupId && ws.userInfo) {
            activeParticipants.push(ws.userInfo);
        }
    });

    // Добавляем нового участника
    const joiningWs = clients.get(parseInt(data.userId));
    if (joiningWs) {
        joiningWs.groupCall = data.groupId;
        joiningWs.userInfo = data.userInfo;
        
        if (!activeParticipants.some(p => p.id === data.userInfo.id)) {
            activeParticipants.push(data.userInfo);
        }

        // Отправляем participantJoined всем существующим участникам
        activeParticipants.forEach(participant => {
            if (participant.id !== data.userId) {
                const participantWs = clients.get(parseInt(participant.id));
                if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                    // Уведомляем существующего участника о новом
                    participantWs.send(JSON.stringify({
                        type: 'participantJoined',
                        groupId: data.groupId,
                        userInfo: data.userInfo
                    }));

                    // Уведомляем нового участника о существующем
                    joiningWs.send(JSON.stringify({
                        type: 'participantJoined',
                        groupId: data.groupId,
                        userInfo: participant
                    }));
                }
            }
        });
    }

    // Отправляем обновленный список всем участникам
    clients.forEach((ws, clientId) => {
        if (ws.groupCall === data.groupId && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'callParticipantsUpdate',
                groupId: data.groupId,
                participants: activeParticipants
            }));
        }
    });
}

// Функция для обработки выхода из группового звонка
function handleLeaveGroupCall(data) {
    console.log('📞 Processing leave group call:', {
        groupId: data.groupId,
        userId: data.userId
    });
    
    const leavingUserId = parseInt(data.userId);
    const leavingUserWs = clients.get(leavingUserId);
    
    if (leavingUserWs) {
        // Удаляем информацию о звонке
        leavingUserWs.groupCall = null;
    }
    
    // Получаем обновленный список участников
    const remainingParticipants = [];
    clients.forEach((ws, clientId) => {
        if (ws.groupCall === data.groupId && ws.userInfo && clientId !== leavingUserId) {
            remainingParticipants.push(ws.userInfo);
        }
    });
    
    // Уведомляем всех оставшихся участников
    clients.forEach((ws, clientId) => {
        if (ws.groupCall === data.groupId && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'participantLeft',
                groupId: data.groupId,
                userId: leavingUserId,
                participants: remainingParticipants
            }));
        }
    });
}

// Функция для обработки отклонения группового звонка
function handleDeclineGroupCall(data) {
    console.log('📞 Processing decline group call:', {
        groupId: data.groupId,
        userId: data.userId,
        initiatorId: data.initiatorId
    });
    
    // Отправляем уведомление инициатору звонка
    const initiatorWs = clients.get(parseInt(data.initiatorId));
    if (initiatorWs && initiatorWs.readyState === WebSocket.OPEN) {
        initiatorWs.send(JSON.stringify({
            type: 'callDeclined',
            groupId: data.groupId,
            userId: data.userId
        }));
    }
}

// Функция для обработки инициализации группового видеозвонка
function handleInitGroupVideoCall(data) {
    console.log('📞 Processing group video call initiation:', {
        groupId: data.groupId,
        initiator: data.initiator,
        participants: data.participants
    });

    // Сохраняем информацию о звонке для инициатора
    const videoInitiatorWs = clients.get(parseInt(data.initiator.id));
    if (videoInitiatorWs) {
        videoInitiatorWs.groupVideoCall = data.groupId;
        videoInitiatorWs.userInfo = data.initiator;
    }

    // Отправляем уведомление всем участникам, кроме инициатора
    if (Array.isArray(data.participants)) {
        // Создаем массив для отслеживания успешных отправок
        let videoNotificationsSent = 0;
        const totalVideoParticipants = data.participants.length;
        
        data.participants.forEach(participantId => {
            const currentParticipantId = parseInt(participantId);
            const initiatorId = parseInt(data.initiator.id);
            
            if (currentParticipantId === initiatorId) {
                console.log(`Skipping video call notification for initiator: ${initiatorId}`);
                return;
            }

            const participantWs = clients.get(currentParticipantId);
            if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                console.log(`📨 Sending video call notification to participant: ${currentParticipantId}`);
                participantWs.send(JSON.stringify({
                    type: 'incomingGroupVideoCall',
                    groupId: data.groupId,
                    groupName: data.groupName,
                    initiator: data.initiator
                }));
                videoNotificationsSent++;
            } else {
                console.log(`⚠️ Participant ${currentParticipantId} is not connected for video call`);
            }
        });
        
        // Отправляем инициатору информацию о количестве отправленных уведомлений
        if (videoInitiatorWs && videoInitiatorWs.readyState === WebSocket.OPEN) {
            videoInitiatorWs.send(JSON.stringify({
                type: 'videoCallNotificationStatus',
                sent: videoNotificationsSent,
                total: totalVideoParticipants - 1, // Исключаем инициатора
                groupId: data.groupId
            }));
        }
    }
}

// Функция для обработки выхода из группового видеозвонка
function handleLeaveGroupVideoCall(data) {
    console.log('📞 Processing leave group video call:', {
        groupId: data.groupId,
        userId: data.userId
    });
    
    const leavingVideoUserId = parseInt(data.userId);
    const leavingVideoUserWs = clients.get(leavingVideoUserId);
    
    if (leavingVideoUserWs) {
        // Удаляем информацию о звонке
        leavingVideoUserWs.groupVideoCall = null;
    }
    
    // Получаем обновленный список участников
    const remainingVideoParticipants = [];
    clients.forEach((ws, clientId) => {
        if (ws.groupVideoCall === data.groupId && ws.userInfo && clientId !== leavingVideoUserId) {
            remainingVideoParticipants.push(ws.userInfo);
        }
    });
    
    // Уведомляем всех оставшихся участников
    clients.forEach((ws, clientId) => {
        if (ws.groupVideoCall === data.groupId && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'videoParticipantLeft',
                groupId: data.groupId,
                userId: leavingVideoUserId,
                participants: remainingVideoParticipants
            }));
        }
    });
}

// ... existing code ...
