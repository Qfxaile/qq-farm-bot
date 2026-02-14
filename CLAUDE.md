# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个基于 Node.js 的 QQ/微信经典农场小程序自动化挂机脚本。通过分析小程序 WebSocket 通信协议（Protocol Buffers），实现全自动农场管理。

**核心功能**: 自动收获、铲除、种植、施肥、除草、除虫、浇水、出售果实、好友农场巡查、任务领取、心跳保活。

## 运行命令

### 安装依赖
```bash
npm install
```

### 启动挂机脚本
```bash
# QQ小程序 - 默认使用二维码登录
node client.js

# QQ小程序 - 直接使用 code
node client.js --code <你的登录code>

# 微信小程序 (必须传入 --wx)
node client.js --code <你的登录code> --wx

# 自定义巡查间隔
node client.js --code <code> --interval 5 --friend-interval 2

# 解码 Protobuf 数据 (调试工具)
node client.js --decode <base64或hex数据> [--hex] [--gate] [--type <消息类型>]

# 验证 proto 定义
node client.js --verify
```

### 参数说明
| 参数 | 说明 |
|------|------|
| `--code` | 小程序登录凭证 |
| `--qr` | 启动QQ扫码登录（默认） |
| `--wx` | 使用微信登录 |
| `--interval` | 自己农场巡查间隔（秒），最低1秒 |
| `--friend-interval` | 好友巡查间隔（秒），最低1秒 |

### 经验分析工具
```bash
node tools/calc-exp-yield.js
node tools/calc-exp-yield.js --lands 18 --level 27
```

## 代码架构

### 模块依赖关系

```
client.js (入口)
    ├── src/config.js       - 配置常量、生长阶段枚举
    ├── src/proto.js        - Protobuf 加载与消息类型管理
    ├── src/network.js      - WebSocket 连接/消息编解码/登录/心跳
    ├── src/farm.js         - 自己农场操作与巡田循环
    ├── src/friend.js       - 好友农场操作与巡查循环
    ├── src/task.js         - 任务系统
    ├── src/status.js       - 状态栏显示
    ├── src/warehouse.js    - 仓库/自动出售
    ├── src/invite.js       - 邀请码处理（仅微信）
    ├── src/decode.js       - PB 解码/验证工具模式
    ├── src/qqQrLogin.js    - QQ 扫码登录
    └── src/logger.js       - 日志系统
```

### 核心模块说明

**src/network.js** - 网络层核心
- WebSocket 连接管理
- Protobuf 消息编解码 (`encodeMsg`, `handleMessage`)
- 登录流程 (`sendLogin`)
- 心跳保活 (`startHeartbeat`)
- 服务器推送处理: `LandsNotify`, `ItemNotify`, `BasicNotify`, `FriendApplicationReceivedNotify`, `TaskInfoNotify`
- 导出 `sendMsgAsync` 用于其他模块发送请求

**src/farm.js** - 农场操作
- `analyzeLands()` - 分析土地状态（收获/除草/除虫/浇水/空地/枯死）
- `autoPlantEmptyLands()` - 自动铲除、购买种子、种植、施肥流程
- `checkFarm()` - 巡田主循环
- 监听 `networkEvents.landsChanged` 实现实时响应

**src/friend.js** - 好友互动
- `visitFriend()` - 访问好友农场
- `stealCrops()` - 偷取成熟作物
- `helpFriend()` - 帮忙操作（浇水/除草/除虫）
- `startFriendCheckLoop()` - 好友巡查循环

**src/proto.js** - Protobuf 类型管理
- 加载 `proto/` 目录下的 `.proto` 文件
- 导出 `types` 对象包含所有消息类型

### 配置文件

**src/config.js** - 全局配置
```javascript
const CONFIG = {
    serverUrl: 'wss://gate-obt.nqf.qq.com/prod/ws',
    clientVersion: '1.6.0.14_20251224',
    platform: 'qq',              // 'qq' 或 'wx'
    heartbeatInterval: 25000,
    farmCheckInterval: 1000,
    friendCheckInterval: 10000,
    forceLowestLevelCrop: false,  // true = 固定种最低等级作物
};
```

### 数据文件

- `gameConfig/RoleLevel.json` - 等级经验表
- `gameConfig/Plant.json` - 植物数据（生长时间、经验等）
- `gameConfig/ItemInfo.json` - 物品信息

### Protobuf 消息流程

所有网络通信使用 Protocol Buffers 编码：
1. 请求: `GateMessage { meta: { service_name, method_name, client_seq }, body }`
2. 响应: `GateMessage { meta: { message_type: 2, error_code }, body }`
3. 推送: `GateMessage { meta: { message_type: 3 }, body }`

消息服务命名模式: `gamepb.<module>pb.<Service>`

## 关键技术细节

### 时间同步
- 使用 `syncServerTime()` 在登录成功时同步服务器时间
- `getServerTimeSec()` 获取同步后的服务器时间戳
- 作物生长阶段判断依赖服务器时间

### 操作限制
- 好友帮忙操作有次数限制 (`operation_limits`)
- `friend.js` 中通过 `setOperationLimitsCallback` 获取限制更新

### 种子选择逻辑
1. 拉取商店中可购买的种子
2. 调用 `tools/calc-exp-yield.js` 计算经验效率
3. 按效率排名选择最佳种子
4. 若 `forceLowestLevelCrop: true` 则直接选最低等级种子

### 扫码登录
- QQ 平台支持扫码登录 (`src/qqQrLogin.js`)
- 微信平台不支持扫码登录，必须通过抓包获取 code
- QQ 平台的 code 可多次使用，微信 code 只能使用一次

## 平台差异

| 特性 | QQ 小程序 | 微信小程序 |
|------|-----------|------------|
| 扫码登录 | 支持 | 不支持 |
| code 复用 | 支持 | 不支持 |
| LandsNotify 推送 | 无 | 有 |
| 好友申请功能 | 无 | 有 |
| 邀请码功能 | 无 | 有 |

## 网页开发规范

### 网页代码目录
- **所有网页相关代码必须放在 `web/` 目录中**
- 前端代码: `web/public/` (HTML/CSS/JS)
- 后端 API: `web/server.js` (Express 服务器)
- 配置文件: `web/config.json`

### 代码修改原则
1. **优先在 web/ 目录内修改代码** - 网页功能的实现尽量不修改核心 src/ 目录
2. **必要的跨目录修改要规范**:
   - 如果必须修改 src/ 目录的代码，通过**模块导出**方式扩展功能
   - 避免直接修改现有代码逻辑，采用**新增导出函数**的方式
   - 修改点要集中、明确，避免散落多处导致合并冲突
3. **模块扩展方式** - 在 src/ 模块中添加 `// Web API 导出` 区域，统一管理网页需要的接口

### 网页功能要求
- **界面简洁** - 使用原生 HTML/CSS/JS，不引入复杂框架
- **功能完善** - 支持登录、查看状态、手动操作农场、查看日志等
- **实时更新** - 通过 WebSocket 推送实时更新农场状态
