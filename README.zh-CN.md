# wiztree-mcp (zh-CN fork)

WizTree 的 MCP 服务端：让 AI 助手直接调用 WizTree 扫描磁盘、分析占用、找出大文件，不用手动导出 CSV。

本仓库是 [onmokoworks/wiztree-mcp](https://github.com/onmokoworks/wiztree-mcp) 的修复分支，**针对中文版 WizTree（zh-CN）以及已打开 GUI 时的导出场景**做了三处修复。上游代码在中文环境下会静默返回 0 条记录，等于装了没用。

## 简介

WizTree 是 Windows 上最快的磁盘占用分析工具（直接读 NTFS 主文件表，整盘扫描通常十几秒）。原项目通过命令行让 WizTree 导出 CSV，再解析成结构化数据，以 MCP 工具的形式暴露给模型：

| 工具 | 作用 |
|---|---|
| `locate_wiztree` | 定位 WizTree 可执行文件 |
| `scan_path` | 扫描指定目录，返回统计摘要 + 内存句柄 |
| `analyze_csv` | 汇总某个句柄或 CSV 文件 |
| `top_entries` | 按逻辑大小/实际占用列出最大的文件或文件夹 |
| `drill_down` | 展开某个目录的直接子项，按大小排序 |
| `search_entries` | 按路径子串或通配符搜索 |
| `old_large_files` | 找出「大于 X 且超过 N 天没改」的文件 |
| `extension_summary` | 按扩展名统计占用 |
| `compare_csv` | 对比两次扫描的增减 |
| `get_treemap` | 读取已有的 treemap PNG |
| `list_snapshots` | 列出快照目录 |

扫描只读取元数据，不会修改任何被扫描的文件。

## 修复内容

### 1. 中文 CSV 表头无法识别（关键）

中文版 WizTree 导出的表头是本地化的：

```
文件名称,大小,分配,修改时间,属性,文件,文件夹,DRIVECAPACITY,FREESPACE,USEDSPACE,RESERVEDSPACE
```

上游只认英文 `File Name` 和日文 `ファイル名`，`resolveColumns()` 匹配不到路径列，于是每一行都被当成无效记录跳过 —— **扫描"成功"但 `entries: 0`**，所有分析工具返回空表。这个失败非常安静，没有任何报错，只会在结果里看到 0。

修复：`resolveColumns()` 与 `findHeaderOffset()` 增加简体中文列名（`文件名称/大小/分配/修改时间/属性/文件/文件夹`）。

### 2. 导出参数顺序错误，GUI 已打开时静默失败

上游把目标路径放在第一个参数：

```
WizTree64.exe "C:\Users" /export=... /admin=0 ...
```

实测（WizTree 4.33）在 **WizTree GUI 已经打开**的情况下，这样调用进程立刻以退出码 0 结束，却根本不写 CSV —— 看起来成功，实际啥也没有。正确形式是开关在前、目标路径在最后，且路径必须以分隔符结尾：

```
WizTree64.exe /export=scan.csv /admin=0 /exportfiles=1 /exportfolders=1 "C:\Users\"
```

修复：`scanWindows()` 先组装开关，最后 `push` 目标路径，并自动补齐尾部反斜杠。

### 3. 中文导出中反斜杠被重复转义

中文版导出的文件夹行会出现 `C:\\Windows\\` 这样的双反斜杠（驱动器根目录 `C:\` 却是单的），导致 `drill_down` 用正常路径 `C:\Windows` 匹配不上，路径展示也很别扭。

修复：解析时折叠连续反斜杠 `replace(/\\{2,}/g, "\\")`。

### 附带的验证

新增两个回归测试（`tests/windows.test.mjs`）：

- `exporter receives switches first and a trailing-separator target path last` —— 断言开关全部在路径之前、路径唯一且以分隔符结尾
- `Simplified Chinese WizTree CSV headers parse instead of yielding zero entries` —— 用真实中文表头 + 双反斜杠样本，断言解析出 3 条且路径已归一

Windows 相关用例全部通过（14 项）。`tests/native.test.mjs` 中 6 项失败与本次修改无关：那些是 macOS 原生扫描的夹具测试，会在临时目录创建文件名含 `"` 的文件，Windows 文件系统不允许该字符，测试在准备阶段就报 `ENOENT`。在 macOS 上运行不受影响。

## 安装方式

需要 **Node.js 22+**，以及已安装的 WizTree（默认找 `C:\Program Files\WizTree\WizTree64.exe`，可用 `WIZTREE_PATH` 覆盖）。

```powershell
git clone https://github.com/zhaoshuocool/wiztree-mcp.git
cd wiztree-mcp
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
```

启动 stdio 服务：

```powershell
node dist/index.js
```

### 注册到 DSH（DeepSeek-Harness）

编辑 profile 的补丁文件 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`，追加：

```yaml
- id: mcp-wiztree
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: wiztree
    transport: stdio
    command: C:\Program Files\nodejs\node.exe
    args:
      - C:\Users\you\.dsh\mcp\wiztree-mcp\dist\index.js
    cwd: C:\Users\you\.dsh\mcp\wiztree-mcp
    toolCallTimeoutMs: 600000
    env:
      WIZTREE_PATH: C:\Program Files\WizTree\WizTree64.exe
      WIZTREE_MCP_DISABLE_CLEANUP: "1"
```

重启 DSH 后，工具会以 `mcp__wiztree__scan_path` 这样的名字出现。整盘扫描建议加大 `toolCallTimeoutMs`（默认 60 秒对 C 盘可能不够）。

### 注册到其他 MCP 客户端

Claude Desktop / Claude Code 等使用 JSON 配置的客户端：

```json
{
  "mcpServers": {
    "wiztree": {
      "command": "node",
      "args": ["C:\\Users\\you\\.dsh\\mcp\\wiztree-mcp\\dist\\index.js"],
      "env": {
        "WIZTREE_PATH": "C:\\Program Files\\WizTree\\WizTree64.exe",
        "WIZTREE_MCP_DISABLE_CLEANUP": "1"
      }
    }
  }
}
```

### 使用提示

- 单次解析上限 20 万条目（`maxEntries`），整盘 C: 通常上百万文件，`scan_path` 会因超限报错。**整盘统计**建议直接命令行导出 CSV 自行分析；MCP 更适合对具体目录下钻、找大文件、按扩展名统计。
- `scan_path` 返回的是内存句柄（`scan:<uuid>`），一个进程只保留最近一次扫描；要对比前后两次，先用 `saveSnapshot` 落盘。
- 加 `admin: true` 会触发 UAC，能扫描到受保护目录，但会弹窗。

## 上游与许可

基于 [onmokoworks/wiztree-mcp](https://github.com/onmokoworks/wiztree-mcp)（MIT）。本分支同样以 MIT 发布，详见 [LICENSE](LICENSE)。上游若合并了这些修复，可直接切换回去。

WizTree 本身是 [Antibody Software](https://diskanalyzer.com/) 的产品，免费版即可导出 CSV；本仓库不包含 WizTree 的任何文件。
