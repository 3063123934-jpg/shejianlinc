# 室内设计案例管理系统

访客前台（浏览 / 搜索 / 分类筛选 / 详情大图）+ 管理员后台（登录 / 上传案例 / 标签 / 置顶排序 / 设主图）。
纯 Node.js 实现，**零第三方依赖**，黑白极简风格。

## 默认账号
- 管理员：`naxisheji123` / `123456@`
- 前台 `/` 任何人可看可搜；后台 `/admin` 需登录。

## 本地运行
```bash
node server.js
```
- 前台：http://localhost:3000/
- 后台：http://localhost:3000/admin
- 服务监听 `0.0.0.0`，同一局域网设备可通过 `http://<本机局域网IP>:3000` 访问。
- 数据自动存放在 `data/`（案例 JSON + 上传图片），首次启动自动建好。

---

## 云端部署（保留完整功能）

> 内置的「CloudStudio 一键部署」只支持纯静态站点，无法运行本系统的 Node 后端，
> 因此请用**支持 Node 的云平台**。以下任选其一，都能保留登录 / 上传 / 存储。

### 关键一步：持久化磁盘（务必配置）
云平台每次重新部署会重置容器磁盘，不挂载持久卷则**上传的图片和账号会被清空**。
请在平台里把「持久卷」挂载到项目里的 `data` 目录绝对路径：
- Railway：项目工作目录是 `/app`，挂载路径填 `/app/data`
- Render：工作目录是 `/opt/render/project/src`，挂载路径填 `/opt/render/project/src/data`
- Zeabur：挂载到 `<项目>/data`

挂载后，`data/` 里的案例数据和图片就会跨部署保留。
（若未挂载：重新部署后账号会重置回默认 `naxisheji123 / 123456@`，仍可登录。）

---

### 方式 A：Railway（最简单，GitHub 一键）
1. 注册 https://railway.app （可用 GitHub 登录）。
2. 把本项目推到你的 GitHub 仓库：
   ```bash
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin <你的仓库地址>
   git push -u origin main
   ```
3. Railway 控制台 → **New Project** → **Deploy from GitHub repo** → 选择该仓库。
4. Railway 检测到 `package.json`，自动执行 `npm install`（零依赖，很快）和 `npm start`（`node server.js`）。
5. 添加持久卷：项目里 **Add Volume**，Mount Path 填 `/app/data`。
6. 部署完成后获得 `*.up.railway.app` 域名，直接访问即可。

### 方式 B：Render（免费额度）
1. 注册 https://render.com （GitHub 登录）。
2. **New** → **Web Service** → 连接 GitHub 仓库。
3. 运行时选 **Node**，Build Command 留空（或 `npm install`），Start Command 填 `node server.js`。
4. 实例类型选 **Free**。
5. 在 **Disk** 里添加持久磁盘，Mount Path 填 `/opt/render/project/src/data`。
6. 创建后获得 `*.onrender.com` 域名。

### 方式 C：Zeabur
1. 注册 https://zeabur.com ，新建 Project 并导入 GitHub 仓库。
2. 自动识别 Node，无需额外配置；如需持久化，在 Storage 里挂载到项目的 `data` 目录。

---

## 目录结构
```
server.js            # Node 后端：鉴权 / 案例 CRUD / 图片上传 / 静态托管
public/              # 前端（index.html 前台 + admin.html 后台）
  index.html  js/app.js  css/style.css
  admin.html  js/admin.js  css/admin.css
data/                # 运行时数据（自动生成，云端请挂持久卷）
package.json
```

## 备注
- 每套案例图片数量已**取消上限**（仅受请求体 120MB 限制）。
- 免费实例可能休眠（一段时间无访问后冷启动较慢），属正常现象。
- 建议首次登录后台后，在「设置」里修改管理员密码，提升安全性。
