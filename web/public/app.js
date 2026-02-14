/**
 * QQ 农场控制台 - 前端逻辑
 */

const API_BASE = '';

// DOM 元素
const elements = {
    // 登录相关
    loginCard: document.getElementById('loginCard'),
    userCard: document.getElementById('userCard'),
    btnShowQr: document.getElementById('btnShowQr'),
    btnCancelQr: document.getElementById('btnCancelQr'),
    qrContainer: document.getElementById('qrContainer'),
    qrCode: document.getElementById('qrCode'),
    btnCodeLogin: document.getElementById('btnCodeLogin'),
    codeInput: document.getElementById('codeInput'),
    platformSelect: document.getElementById('platformSelect'),
    // 用户信息
    userName: document.getElementById('userName'),
    userLevel: document.getElementById('userLevel'),
    userGold: document.getElementById('userGold'),
    userExp: document.getElementById('userExp'),
    // 统计
    statHarvest: document.getElementById('statHarvest'),
    statPlant: document.getElementById('statPlant'),
    statWater: document.getElementById('statWater'),
    statWeed: document.getElementById('statWeed'),
    statInsect: document.getElementById('statInsect'),
    statFertilize: document.getElementById('statFertilize'),
    statSteal: document.getElementById('statSteal'),
    statHelp: document.getElementById('statHelp'),
    statSell: document.getElementById('statSell'),
    statSellGold: document.getElementById('statSellGold'),
    statTask: document.getElementById('statTask'),
    btnResetStats: document.getElementById('btnResetStats'),
    // 控制
    farmInterval: document.getElementById('farmInterval'),
    friendInterval: document.getElementById('friendInterval'),
    forceLowest: document.getElementById('forceLowest'),
    btnSaveConfig: document.getElementById('btnSaveConfig'),
    btnCheckFarm: document.getElementById('btnCheckFarm'),
    btnStopBot: document.getElementById('btnStopBot'),
    // 日志
    logContainer: document.getElementById('logContainer'),
    btnClearLogs: document.getElementById('btnClearLogs'),
    // 状态
    botStatus: document.getElementById('botStatus'),
    botStatusText: document.getElementById('botStatusText'),
    connText: document.getElementById('connText'),
    statusDot: document.querySelector('#botStatus .status-dot')
};

// 状态
let eventSource = null;
let isConnected = false;
let botRunning = false;
let qrPollingTimer = null;
let currentLoginCode = '';

// ========== API 请求 ==========

async function apiRequest(url, options = {}) {
    try {
        const response = await fetch(API_BASE + url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });
        return await response.json();
    } catch (error) {
        console.error('API 请求失败:', error);
        return { success: false, error: error.message };
    }
}

// ========== 挂机控制 ==========

// 显示二维码
async function handleShowQr() {
    elements.btnShowQr.disabled = true;
    elements.btnShowQr.textContent = '获取中...';

    const result = await apiRequest('/api/bot/qr-code', { method: 'POST' });

    elements.btnShowQr.disabled = false;
    elements.btnShowQr.innerHTML = '<span class="icon">📱</span>QQ 扫码登录';

    if (result.success) {
        currentLoginCode = result.data.loginCode;

        // 显示二维码
        elements.qrCode.innerHTML = `<img src="${result.data.qrImageUrl}" alt="QQ 扫码登录">`;
        elements.qrContainer.classList.remove('hidden');

        // 开始轮询扫码状态
        startQrPolling(result.data.loginCode);
    } else {
        showToast('获取二维码失败: ' + result.error);
    }
}

// 轮询扫码状态
function startQrPolling(loginCode) {
    stopQrPolling();

    qrPollingTimer = setInterval(async () => {
        const result = await apiRequest(`/api/bot/qr-status/${loginCode}`);

        if (!result.success) {
            stopQrPolling();
            elements.qrContainer.classList.add('hidden');
            showToast('扫码查询失败: ' + result.error);
            return;
        }

        const { status, message } = result.data;

        if (status === 'OK') {
            stopQrPolling();
            elements.qrContainer.classList.add('hidden');
            showToast('登录成功！');
            updateBotStatus(true);
        } else if (status === 'Used') {
            stopQrPolling();
            elements.qrContainer.classList.add('hidden');
            showToast('二维码已失效，请重试');
        } else if (status === 'Error') {
            stopQrPolling();
            elements.qrContainer.classList.add('hidden');
            showToast('扫码查询失败，请重试');
        }
    }, 2000);
}

// 停止轮询
function stopQrPolling() {
    if (qrPollingTimer) {
        clearInterval(qrPollingTimer);
        qrPollingTimer = null;
    }
    currentLoginCode = '';
}

// 取消扫码
function handleCancelQr() {
    stopQrPolling();
    elements.qrContainer.classList.add('hidden');
}

async function handleCodeLogin() {
    const code = elements.codeInput.value.trim();
    const platform = elements.platformSelect.value;

    if (!code) {
        showToast('请输入登录 code');
        return;
    }

    elements.btnCodeLogin.disabled = true;
    elements.btnCodeLogin.textContent = '登录中...';

    const result = await apiRequest('/api/bot/start', {
        method: 'POST',
        body: JSON.stringify({ code, platform })
    });

    elements.btnCodeLogin.disabled = false;
    elements.btnCodeLogin.textContent = '使用 Code 登录';

    if (result.success) {
        showToast('登录成功！');
        updateBotStatus(true);
        elements.codeInput.value = '';
    } else {
        showToast('登录失败: ' + result.error);
    }
}

async function handleStopBot() {
    if (!confirm('确定要停止挂机吗？')) {
        return;
    }

    elements.btnStopBot.disabled = true;
    elements.btnStopBot.textContent = '停止中...';

    const result = await apiRequest('/api/bot/stop', { method: 'POST' });

    elements.btnStopBot.disabled = false;
    elements.btnStopBot.textContent = '停止挂机';

    if (result.success) {
        showToast('挂机已停止');
        updateBotStatus(false);
    } else {
        showToast('停止失败: ' + result.error);
    }
}

// ========== 状态更新 ==========

async function updateStatus() {
    const result = await apiRequest('/api/status');
    if (result.success) {
        const data = result.data;
        elements.userName.textContent = data.name || '-';
        elements.userLevel.textContent = data.level || '-';
        elements.userGold.textContent = (data.gold || 0).toLocaleString();
        elements.userExp.textContent = (data.exp || 0).toLocaleString();
    }
}

async function updateConfig() {
    const result = await apiRequest('/api/config');
    if (result.success) {
        const data = result.data;
        elements.farmInterval.value = data.farmCheckInterval / 1000;
        elements.friendInterval.value = data.friendCheckInterval / 1000;
        elements.forceLowest.checked = data.forceLowestLevelCrop;
    }
}

async function loadUserData() {
    const result = await apiRequest('/api/stats');
    if (result.success) {
        const data = result.data;

        // 更新用户信息
        if (data.user && data.user.name) {
            elements.userName.textContent = data.user.name || '-';
            elements.userLevel.textContent = data.user.level || '-';
            // 如果有用户数据，显示用户卡片
            if (data.user.name) {
                elements.userCard.classList.remove('hidden');
            }
        }

        // 更新统计数据
        updateStatsDisplay(data);
    }
}

function updateStatsDisplay(stats) {
    elements.statHarvest.textContent = formatNumber(stats.harvestCount || 0);
    elements.statPlant.textContent = formatNumber(stats.plantCount || 0);
    elements.statWater.textContent = formatNumber(stats.waterCount || 0);
    elements.statWeed.textContent = formatNumber(stats.weedCount || 0);
    elements.statInsect.textContent = formatNumber(stats.insectCount || 0);
    elements.statFertilize.textContent = formatNumber(stats.fertilizeCount || 0);
    elements.statSteal.textContent = formatNumber(stats.stealCount || 0);
    elements.statHelp.textContent = formatNumber(stats.helpCount || 0);
    elements.statSell.textContent = formatNumber(stats.sellCount || 0);
    elements.statSellGold.textContent = formatNumber(stats.sellGold || 0);
    elements.statTask.textContent = formatNumber(stats.taskCount || 0);
}

function formatNumber(num) {
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + 'w';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
}

async function handleResetStats() {
    if (!confirm('确定要重置统计数据吗？此操作不可恢复！')) {
        return;
    }

    const result = await apiRequest('/api/stats/reset', { method: 'POST' });

    if (result.success) {
        showToast('统计数据已重置');
        loadUserData();
    } else {
        showToast('重置失败: ' + result.error);
    }
}

function updateBotStatus(running) {
    botRunning = running;

    if (running) {
        elements.loginCard.classList.add('hidden');
        elements.userCard.classList.remove('hidden');
        elements.botStatusText.textContent = '运行中';
        elements.statusDot.classList.add('running');
        elements.statusDot.classList.remove('stopped');
        elements.btnSaveConfig.disabled = false;
        elements.btnCheckFarm.disabled = false;
        elements.btnStopBot.disabled = false;
    } else {
        elements.loginCard.classList.remove('hidden');
        elements.userCard.classList.add('hidden');
        elements.botStatusText.textContent = '未运行';
        elements.statusDot.classList.add('stopped');
        elements.statusDot.classList.remove('running');
        elements.btnSaveConfig.disabled = true;
        elements.btnCheckFarm.disabled = true;
        elements.btnStopBot.disabled = true;
    }
}

// ========== 日志功能 ==========

let lastLogCount = 0;

async function loadLogs() {
    const result = await apiRequest('/api/logs?limit=100');
    if (result.success) {
        const logs = result.data.logs;
        if (logs.length === 0) {
            elements.logContainer.innerHTML = '<div class="log-empty">暂无日志</div>';
            return;
        }

        const newLogs = logs.slice(lastLogCount);
        newLogs.forEach(log => addLogEntry(log));
        lastLogCount = logs.length;

        elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
    }
}

function addLogEntry(log) {
    const emptyDiv = elements.logContainer.querySelector('.log-empty');
    if (emptyDiv) {
        emptyDiv.remove();
    }

    const entry = document.createElement('div');
    entry.className = `log-entry ${log.level}`;
    entry.innerHTML = `
        <span class="log-time">${log.time}</span>
        <span class="log-tag">[${log.tag}]</span>
        <span class="log-msg">${escapeHtml(log.msg)}</span>
    `;
    elements.logContainer.appendChild(entry);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== 事件处理 ==========

async function handleSaveConfig() {
    const config = {
        farmCheckInterval: parseInt(elements.farmInterval.value) * 1000,
        friendCheckInterval: parseInt(elements.friendInterval.value) * 1000,
        forceLowestLevelCrop: elements.forceLowest.checked
    };

    const result = await apiRequest('/api/config', {
        method: 'POST',
        body: JSON.stringify(config)
    });

    if (result.success) {
        showToast('配置已保存');
    } else {
        showToast('保存失败: ' + result.error);
    }
}

async function handleCheckFarm() {
    elements.btnCheckFarm.disabled = true;
    elements.btnCheckFarm.textContent = '巡田中...';

    const result = await apiRequest('/api/farm/check', {
        method: 'POST'
    });

    if (result.success) {
        showToast('巡田完成');
    } else {
        showToast('巡田失败: ' + result.error);
    }

    elements.btnCheckFarm.disabled = false;
    elements.btnCheckFarm.textContent = '手动巡田';
}

async function handleClearLogs() {
    await apiRequest('/api/logs/clear', { method: 'POST' });
    elements.logContainer.innerHTML = '<div class="log-empty">暂无日志</div>';
    lastLogCount = 0;
}

// ========== SSE 事件流 ==========

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

function connectEventSource() {
    if (eventSource) {
        eventSource.close();
    }

    // 使用相对路径，自动适配 HTTP/HTTPS
    const eventUrl = API_BASE + '/api/events';
    eventSource = new EventSource(eventUrl);

    eventSource.onopen = () => {
        isConnected = true;
        reconnectAttempts = 0; // 重置重连计数
        updateConnectionStatus();
    };

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            // 忽略心跳消息
            if (data.type !== 'heartbeat') {
                handleServerEvent(data);
            }
        } catch (e) {
            // 心跳消息不是 JSON，忽略
            if (!event.data.startsWith(':')) {
                console.error('解析 SSE 数据失败:', e);
            }
        }
    };

    eventSource.onerror = (e) => {
        isConnected = false;
        updateConnectionStatus();

        // 关闭当前连接
        if (eventSource.readyState === EventSource.CLOSED || eventSource.readyState === EventSource.CONNECTING) {
            eventSource.close();
        }

        // 自动重连（有指数退避）
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
            setTimeout(() => {
                if (!isConnected && reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                    connectEventSource();
                }
            }, delay);
        }
    };
}

function handleServerEvent(data) {
    switch (data.type) {
        case 'botStatus':
            updateBotStatus(data.data.running);
            break;

        case 'botStarted':
            updateBotStatus(true);
            showToast('挂机已启动');
            break;

        case 'botStopped':
            updateBotStatus(false);
            showToast('挂机已停止');
            break;

        case 'status':
            elements.userName.textContent = data.data.name || '-';
            elements.userLevel.textContent = data.data.level || '-';
            elements.userGold.textContent = (data.data.gold || 0).toLocaleString();
            elements.userExp.textContent = (data.data.exp || 0).toLocaleString();
            break;

        case 'statsUpdated':
            updateStatsDisplay(data.data);
            break;

        case 'landsChanged':
            showToast(`土地变化: ${data.data.count} 块`);
            break;

        case 'friendApplication':
            showToast(`收到好友申请: ${data.data.count} 人`);
            break;
    }
}

function updateConnectionStatus() {
    if (isConnected) {
        elements.connText.textContent = '已连接';
    } else {
        elements.connText.textContent = '连接中...';
    }
}

// ========== 工具函数 ==========

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 60px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 10px 20px;
        border-radius: 20px;
        font-size: 14px;
        z-index: 1000;
        animation: fadeInOut 2s ease-in-out;
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 2000);
}

const style = document.createElement('style');
style.textContent = `
    @keyframes fadeInOut {
        0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
        15% { opacity: 1; transform: translateX(-50%) translateY(0); }
        85% { opacity: 1; transform: translateX(-50%) translateY(0); }
        100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
    }
`;
document.head.appendChild(style);

// ========== 初始化 ==========

function init() {
    // 连接 SSE
    connectEventSource();

    // 加载保存的数据
    loadUserData();

    // 加载配置
    updateConfig();

    // 定时刷新日志和统计
    setInterval(() => {
        loadLogs();
    }, 2000);

    // 绑定事件
    elements.btnShowQr.addEventListener('click', handleShowQr);
    elements.btnCancelQr.addEventListener('click', handleCancelQr);
    elements.btnCodeLogin.addEventListener('click', handleCodeLogin);
    elements.btnStopBot.addEventListener('click', handleStopBot);
    elements.btnSaveConfig.addEventListener('click', handleSaveConfig);
    elements.btnCheckFarm.addEventListener('click', handleCheckFarm);
    elements.btnClearLogs.addEventListener('click', handleClearLogs);
    elements.btnResetStats.addEventListener('click', handleResetStats);
}

document.addEventListener('DOMContentLoaded', init);
