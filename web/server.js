/**
 * QQ 农场网页服务器
 * 提供 Web API 和静态文件服务，集成挂机功能
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

// 导入核心模块
const { getUserState, networkEvents, connect, cleanup, getWs } = require('../src/network');
const { CONFIG } = require('../src/config');
const { checkFarm, startFarmCheckLoop, stopFarmCheckLoop } = require('../src/farm');
const { startFriendCheckLoop, stopFriendCheckLoop } = require('../src/friend');
const { initTaskSystem, cleanupTaskSystem } = require('../src/task');
const { startSellLoop, stopSellLoop, debugSellFruits } = require('../src/warehouse');
const { processInviteCodes } = require('../src/invite');
const { getQQFarmCodeByScan, requestLoginCode, queryScanStatus, getAuthCode } = require('../src/qqQrLogin');
const { loadProto } = require('../src/proto');
const { initStatusBar, cleanupStatusBar, setStatusPlatform } = require('../src/status');
const { emitRuntimeHint } = require('../src/utils');
const { initFileLogger } = require('../src/logger');

const app = express();
const PORT = 9401;

// 初始化日志
initFileLogger();

// 挂机状态
let botRunning = false;
let loginCode = '';

// ========== 数据存储 ==========

const DATA_DIR = path.join(__dirname, 'data');
const USER_DATA_FILE = path.join(DATA_DIR, 'user.json');
const STATS_DATA_FILE = path.join(DATA_DIR, 'stats.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 默认统计数据
const defaultStats = {
    harvestCount: 0,
    plantCount: 0,
    waterCount: 0,
    weedCount: 0,
    insectCount: 0,
    fertilizeCount: 0,
    stealCount: 0,
    helpCount: 0,
    sellCount: 0,
    sellGold: 0,
    taskCount: 0,
    lastUpdate: null
};

// 读取数据
function readData(filePath, defaultData = {}) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error(`[数据] 读取失败 ${filePath}:`, e.message);
    }
    return defaultData;
}

// 保存数据
function saveData(filePath, data) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`[数据] 保存失败 ${filePath}:`, e.message);
    }
}

// 获取用户数据
function getUserData() {
    return readData(USER_DATA_FILE, {});
}

// 保存用户数据
function saveUserData(data) {
    saveData(USER_DATA_FILE, { ...data, lastUpdate: Date.now() });
}

// 获取统计数据
function getStatsData() {
    return readData(STATS_DATA_FILE, defaultStats);
}

// 保存统计数据
function saveStatsData(stats) {
    saveData(STATS_DATA_FILE, { ...stats, lastUpdate: Date.now() });
}

// 更新统计数据
function updateStats(action, count = 1) {
    const stats = getStatsData();

    switch (action) {
        case 'harvest': stats.harvestCount += count; break;
        case 'plant': stats.plantCount += count; break;
        case 'water': stats.waterCount += count; break;
        case 'weed': stats.weedCount += count; break;
        case 'insect': stats.insectCount += count; break;
        case 'fertilize': stats.fertilizeCount += count; break;
        case 'steal': stats.stealCount += count; break;
        case 'help': stats.helpCount += count; break;
        case 'sell': stats.sellCount += count; break;
        case 'sellGold': stats.sellGold += count; break;
        case 'task': stats.taskCount += count; break;
    }

    saveStatsData(stats);
    broadcastEvent('statsUpdated', stats);
}

// ========== 日志统计拦截 ==========

const originalLog = console.log;
const logPattern = /\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.+)/;

console.log = (...args) => {
    const msg = args.join(' ');
    const match = msg.match(logPattern);

    if (match) {
        const tag = match[2];
        const logMsg = match[3];

        // 解析日志并更新统计
        // 收获: 收获15
        if (tag === '农场' || tag === '好友') {
            const harvestMatch = logMsg.match(/收获(\d+)/);
            if (harvestMatch) updateStats('harvest', parseInt(harvestMatch[1]) || 1);

            const plantMatch = logMsg.match(/种植(\d+)/);
            if (plantMatch) updateStats('plant', parseInt(plantMatch[1]) || 1);

            const waterMatch = logMsg.match(/浇水(\d+)/);
            if (waterMatch) updateStats('water', parseInt(waterMatch[1]) || 1);

            const weedMatch = logMsg.match(/除草(\d+)/);
            if (weedMatch) updateStats('weed', parseInt(weedMatch[1]) || 1);

            const insectMatch = logMsg.match(/除虫(\d+)/);
            if (insectMatch) updateStats('insect', parseInt(insectMatch[1]) || 1);

            const fertilizeMatch = logMsg.match(/施肥.*?(\d+)\/(\d+)/);
            if (fertilizeMatch) updateStats('fertilize', parseInt(fertilizeMatch[1]) || 1);

            const stealMatch = logMsg.match(/偷(\d+)/);
            if (stealMatch) updateStats('steal', parseInt(stealMatch[1]) || 1);
        }

        // 帮忙
        if (tag === '好友') {
            if (logMsg.includes('帮忙')) updateStats('help', 1);
        }

        // 出售
        if (tag === '仓库') {
            const sellMatch = logMsg.match(/出售\s*(\d+)\s*种.*?(\d+)\s*个.*?(\d+)\s*金币/);
            if (sellMatch) {
                updateStats('sell', parseInt(sellMatch[1]) || 1);
                updateStats('sellGold', parseInt(sellMatch[3]) || 0);
            }
        }

        // 任务
        if (tag === '任务') {
            if (logMsg.includes('领取')) updateStats('task', 1);
        }

        // 保存到日志数组
        addLog('INFO', tag, logMsg);
    }

    originalLog(...args);
};

// ============ 挂机控制 ============

async function startBot(code, platform = 'qq') {
    if (botRunning) {
        throw new Error('挂机已在运行中');
    }

    loginCode = code;
    CONFIG.platform = platform;

    // 加载 proto 定义
    await loadProto();

    // 初始化
    setStatusPlatform(CONFIG.platform);
    emitRuntimeHint(true);

    return new Promise((resolve, reject) => {
        // 连接并登录
        connect(code, async () => {
            botRunning = true;

            // 启动各功能模块
            await processInviteCodes();
            startFarmCheckLoop();
            startFriendCheckLoop();
            initTaskSystem();

            // 启动时立即检查一次背包
            setTimeout(() => debugSellFruits(), 5000);
            startSellLoop(60000);

            // 获取用户状态
            const state = getUserState();
            console.log(`[网页] 挂机已启动 - ${state.name} (Lv.${state.level})`);

            // 保存用户数据
            saveUserData({
                gid: state.gid,
                name: state.name,
                level: state.level,
                platform: CONFIG.platform
            });

            // 通知前端
            broadcastEvent('botStarted', { platform: CONFIG.platform });
            broadcastEvent('status', state);

            resolve({ success: true, data: state });
        });
    });
}

async function stopBot() {
    if (!botRunning) {
        return;
    }

    botRunning = false;

    // 停止各功能模块
    stopFarmCheckLoop();
    stopFriendCheckLoop();
    cleanupTaskSystem();
    stopSellLoop();
    cleanupStatusBar();
    cleanup();

    const ws = getWs();
    if (ws) ws.close();

    broadcastEvent('botStopped', {});
    console.log('[网页] 挂机已停止');
}

function getBotStatus() {
    return {
        running: botRunning,
        platform: CONFIG.platform,
        hasCode: !!loginCode
    };
}

// ============ 中间件 ============

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============ 日志存储 ============

const logs = [];
const MAX_LOGS = 500;

function addLog(level, tag, msg) {
    const logEntry = {
        time: new Date().toLocaleTimeString(),
        level,
        tag,
        msg
    };
    logs.push(logEntry);
    if (logs.length > MAX_LOGS) {
        logs.shift();
    }
}

// ============ SSE 事件推送 ============

const clients = new Set();

function broadcastEvent(type, data) {
    const message = JSON.stringify({ type, data });
    clients.forEach(client => {
        try {
            client.res.write(`data: ${message}\n\n`);
        } catch (e) {
            clients.delete(client);
        }
    });
}

// 监听网络事件并广播
networkEvents.on('landsChanged', (lands) => {
    broadcastEvent('landsChanged', { count: lands.length });
});

networkEvents.on('friendApplicationReceived', (applications) => {
    broadcastEvent('friendApplication', { count: applications.length });
});

// ============ API 路由 ============

// 获取挂机状态
app.get('/api/bot/status', (req, res) => {
    res.json({
        success: true,
        data: getBotStatus()
    });
});

// 启动挂机
app.post('/api/bot/start', async (req, res) => {
    try {
        const { code, platform } = req.body;
        if (!code) {
            return res.json({ success: false, error: '请提供登录 code' });
        }
        const result = await startBot(code, platform || 'qq');
        res.json(result);
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// QQ 扫码登录 - 获取二维码
app.post('/api/bot/qr-code', async (req, res) => {
    try {
        if (botRunning) {
            return res.json({ success: false, error: '挂机已在运行中' });
        }
        CONFIG.platform = 'qq';

        const { loginCode: lc, url } = await requestLoginCode();

        res.json({
            success: true,
            data: {
                loginCode: lc,
                url,
                qrImageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`
            }
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// QQ 扫码登录 - 查询扫码状态
app.get('/api/bot/qr-status/:loginCode', async (req, res) => {
    try {
        const { loginCode } = req.params;
        const status = await queryScanStatus(loginCode);

        if (status.status === 'OK') {
            // 扫码成功，获取授权码并启动挂机
            const authCode = await getAuthCode(status.ticket);
            await startBot(authCode, 'qq');

            res.json({
                success: true,
                data: { status: 'OK', message: '登录成功' }
            });
        } else if (status.status === 'Used') {
            res.json({
                success: true,
                data: { status: 'Used', message: '二维码已失效' }
            });
        } else if (status.status === 'Error') {
            res.json({
                success: true,
                data: { status: 'Error', message: '查询失败' }
            });
        } else {
            res.json({
                success: true,
                data: { status: 'Wait', message: '等待扫码' }
            });
        }
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 停止挂机
app.post('/api/bot/stop', async (req, res) => {
    try {
        stopBot();
        res.json({ success: true, data: { message: '挂机已停止' } });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 获取用户状态
app.get('/api/status', (req, res) => {
    const state = getUserState();
    res.json({
        success: true,
        data: {
            gid: state.gid,
            name: state.name,
            level: state.level,
            gold: state.gold,
            exp: state.exp,
            platform: CONFIG.platform
        }
    });
});

// 获取配置
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        data: {
            platform: CONFIG.platform,
            farmCheckInterval: CONFIG.farmCheckInterval,
            friendCheckInterval: CONFIG.friendCheckInterval,
            forceLowestLevelCrop: CONFIG.forceLowestLevelCrop
        }
    });
});

// 更新配置
app.post('/api/config', (req, res) => {
    try {
        const { farmCheckInterval, friendCheckInterval, forceLowestLevelCrop } = req.body;

        if (farmCheckInterval !== undefined) {
            CONFIG.farmCheckInterval = Math.max(1000, farmCheckInterval);
        }
        if (friendCheckInterval !== undefined) {
            CONFIG.friendCheckInterval = Math.max(1000, friendCheckInterval);
        }
        if (forceLowestLevelCrop !== undefined) {
            CONFIG.forceLowestLevelCrop = forceLowestLevelCrop;
        }

        res.json({ success: true, data: { message: '配置已更新' } });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 手动巡田
app.post('/api/farm/check', async (req, res) => {
    try {
        if (!botRunning) {
            return res.json({ success: false, error: '挂机未运行' });
        }
        await checkFarm();
        res.json({ success: true, data: { message: '巡田完成' } });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 获取日志
app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json({
        success: true,
        data: {
            logs: logs.slice(-limit)
        }
    });
});

// 清空日志
app.post('/api/logs/clear', (req, res) => {
    logs.length = 0;
    res.json({ success: true, data: { message: '日志已清空' } });
});

// ========== 统计 API ==========

// 获取统计数据
app.get('/api/stats', (req, res) => {
    const stats = getStatsData();
    const userData = getUserData();

    res.json({
        success: true,
        data: {
            ...stats,
            user: userData
        }
    });
});

// 重置统计数据
app.post('/api/stats/reset', (req, res) => {
    saveStatsData({ ...defaultStats, lastUpdate: Date.now() });
    broadcastEvent('statsUpdated', defaultStats);
    res.json({ success: true, data: { message: '统计数据已重置' } });
});

// SSE 端点 - 支持 HTTPS 和反向代理
app.get('/api/events', (req, res) => {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 禁用 Nginx 缓冲
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const clientId = Date.now();
    clients.add({ id: clientId, res });

    // 发送初始状态
    res.write(`data: ${JSON.stringify({ type: 'botStatus', data: getBotStatus() })}\n\n`);

    // 发送统计数据
    const stats = getStatsData();
    res.write(`data: ${JSON.stringify({ type: 'statsUpdated', data: stats })}\n\n`);

    // 定时发送心跳，保持连接活跃（对 HTTPS/代理很重要）
    const heartbeatInterval = setInterval(() => {
        try {
            res.write(`: heartbeat\n\n`); // SSE 注释格式的心跳
        } catch (e) {
            clearInterval(heartbeatInterval);
            clients.forEach(client => {
                if (client.id === clientId) {
                    clients.delete(client);
                }
            });
        }
    }, 30000); // 每 30 秒发送一次心跳

    req.on('close', () => {
        clearInterval(heartbeatInterval);
        clients.forEach(client => {
            if (client.id === clientId) {
                clients.delete(client);
            }
        });
    });

    req.on('error', () => {
        clearInterval(heartbeatInterval);
        clients.forEach(client => {
            if (client.id === clientId) {
                clients.delete(client);
            }
        });
    });
});

// ============ 启动服务器 ============

if (require.main === module) {
    // 加载已保存的用户数据
    const userData = getUserData();
    if (userData.name) {
        console.log(`[数据] 已加载用户数据: ${userData.name} (Lv.${userData.level})`);
    }

    // 加载统计数据
    const stats = getStatsData();
    console.log(`[数据] 统计数据: 收获${stats.harvestCount}次 | 种植${stats.plantCount}次 | 偷菜${stats.stealCount}次`);

    app.listen(PORT, () => {
        console.log(`[网页] 服务器启动: http://localhost:${PORT}`);
        console.log('[网页] 请在浏览器中打开网页，然后点击"开始挂机"按钮');
    });
}

module.exports = { app, broadcastEvent, startBot, stopBot };
