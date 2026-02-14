# QQ 农场网页控制台

## 功能特性

- **实时状态显示** - 显示用户信息、等级、金币、经验
- **控制面板** - 修改巡查间隔、种植策略
- **手动操作** - 手动触发巡田
- **日志查看** - 实时查看运行日志
- **实时推送** - 通过 SSE 接收服务器事件

## 启动方式

### 方式一：独立启动网页服务器
```bash
node web/server.js
```
访问: http://localhost:3000

### 方式二：与挂机脚本同时启动
```bash
# 同时启动挂机脚本和网页服务器
node client.js --qr --web
```

### 方式三：使用 npm 脚本
```bash
# 先安装依赖
npm install

# 同时启动（需要 concurrently）
npm run dev
```

## API 接口

### GET /api/status
获取用户状态

**响应:**
```json
{
  "success": true,
  "data": {
    "gid": 1234567890,
    "name": "昵称",
    "level": 24,
    "gold": 88888,
    "exp": 1250,
    "platform": "qq"
  }
}
```

### GET /api/config
获取当前配置

### POST /api/config
更新配置
```json
{
  "farmCheckInterval": 5000,
  "friendCheckInterval": 10000,
  "forceLowestLevelCrop": false
}
```

### POST /api/farm/check
手动触发巡田

### GET /api/logs
获取日志列表

### POST /api/logs/clear
清空日志

### GET /api/events
SSE 事件流，接收实时推送

## 文件结构

```
web/
├── server.js       # Express 服务器和 API 路由
├── public/
│   ├── index.html  # 主页面
│   ├── style.css   # 样式文件
│   └── app.js      # 前端逻辑
└── README.md       # 说明文档
```

## 开发说明

### 代码修改规范

1. **优先在 web/ 目录内修改** - 网页功能的实现尽量不修改核心 src/ 目录
2. **必要的跨目录修改要规范** - 如果必须修改 src/ 目录，通过模块导出方式扩展功能
3. **修改点集中** - 避免散落多处导致合并冲突

### 模块导出

在 `client.js` 中添加了网页服务器启动函数：
```javascript
// Web API 导出 - 网页服务器
async function startWebServer() {
    // ...
}
```

### 扩展 API

如需添加新的 API 端点：
1. 在 `web/server.js` 中添加路由
2. 在 `web/public/app.js` 中添加前端调用
3. 如需访问核心功能，通过 `require()` 导入相应模块
