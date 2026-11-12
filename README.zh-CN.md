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

修复：解析时折叠连续反斜杠，但保留 UNC 前缀（`\\server\share`），见 `collapseSeparators()`。整串折叠连引导双反斜杠一起吃掉，`\\server\share` 会变成 `\server\share`，`drill_down` 反而彻底匹配不上。

### 4. 表头认不出来时仍然是静默 0 条

修复 1 补上了已知的中文列名，但只要 WizTree 换一个没见过的拼写、或者前导行格式变了，`findHeaderOffset()` 找不到表头就会把前导行当成表头喂给解析器，`resolveColumns()` 全部返回 -1，每一行都因路径为空被跳过 —— 还是那个"扫描成功、0 条"。表头判断只在第一条记录上做一次，之后不会重试。

顺带一条更近的路径：`findHeaderOffset()` 的认表头列表里没有 `文件名`，而 `resolveColumns()` 接受它。两个清单各说各话，本身就是一条通往静默 0 的路。

修复：表头解析不出路径列直接抛错，错误信息带上实际读到的表头原文；解析完是 0 行同样抛错。认表头的正则改为从 `PATH_HEADER_NAMES` 生成，两份清单不可能再漂移。

### 5. `get_treemap` 能读任意文件，而且几乎不可能被用对

它接受任意绝对路径、不校验扩展名，等于把进程可读的任何文件以 base64 交给模型。而它声称路径来自 `scan_path`，可 `scan_path` 的 treemap PNG 写在临时目录、返回之前就删了，那个路径压根不存在。

修复：限定在 `WIZTREE_MCP_EXPORT_DIR` 内、只接受 `.png`，越界直接 `isError`。`analyze_csv` / `compare_csv` 仍然接受任意 CSV 路径 —— 从 WizTree 图形界面手工导出的 CSV 本来就在任意位置，那是核心用法。这个宽严差异写进了"安全边界"。

### 6. WizTree 查找顺序把 PATH 排在 Program Files 之前

`WIZTREE_PATH` 之后紧接着就是 PATH 每个目录下的 `WizTree64.exe`，Program Files 反而在后面。任何可写的 PATH 目录放一个同名文件，就会先于正版安装被启动。修复：安装位置排到 PATH 之前。

### 7. 其余修正

- 快照目录 128 MiB 额度的报错只说"先清理已存快照"，可唯一的清理工具恰好被推荐配置 `WIZTREE_MCP_DISABLE_CLEANUP=1` 关掉了。报错现在带上目录、已用字节数和替代做法。
- `scan_path` 找不到 WizTree 时返回的是普通文本，模型会当成调用成功；现在与其他失败分支一致带 `isError`。
- 缓存只按"最多 3 份 CSV"淘汰，不看行数；现在再加一条 40 万行的驻留上限。
- `extension_summary` 汇总了 `allocated` 却不输出，补上 `allocatedHuman` 列。
- 超限报错不带阈值，现在写成 `CSV entry limit (200000) reached`。
- `McpServer` 增加 `instructions`：Codex 等客户端在首次工具调用前就会读到它，正好用来声明"别扫整盘、先 drill_down"，比等模型撞上限便宜。
- `package.json` 补 `engines.node: ">=22"`（代码用了 `stream.closed`、顶层 await、`crypto.randomUUID`）。

### 附带的验证

CI 现在跑 `npm test`，并且拆成 `windows-latest` 和 `macos-latest` 两个 job。之前 CI 里根本没有测试步骤：macOS 原生用例在 Windows runner 上必红（夹具要创建文件名含 `"` 的文件，Windows 不允许），于是整条测试链都没挂。现在这些依赖 POSIX 符号链接、文件权限、大小写敏感文件名的用例在非 macOS 上按原因跳过，`npm test` 在 Windows 上退出码 0 —— 26 项里 22 通过、4 跳过，macOS 上 26 项全部运行。

本轮新增回归测试（`tests/windows.test.mjs`）：

- `an unrecognized header fails loudly instead of yielding zero entries`
- `every path-column spelling is accepted by both the finder and the resolver`
- `a header-only export is reported instead of an empty result`
- `the entry limit error names the limit that was hit`
- `separator collapsing keeps UNC prefixes and drill_down still matches them`
- `isWithin admits the export directory and refuses traversal or siblings`
- `get_treemap refuses anything outside the export directory and serves a saved PNG`
- `WizTree lookup prefers known install locations over PATH`

原先的三个回归测试保留不动：开关顺序、中文表头解析、以及 Windows 生命周期用例。

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

### 通用注册方法

任何 MCP 客户端都要先满足三件事，缺一不可：

1. 先 `npm run build`。注册的是 `dist/index.js`，不是 `src/index.ts`。
2. `command` 写 node 的**绝对路径**。Claude Desktop、ChatGPT 桌面版这类由图形界面拉起的客户端，PATH 里常常不含 node（用 nvm / fnm 时尤其如此），写裸 `node` 会直接 `ENOENT` 启动失败。
3. 放宽工具调用超时。扫描是长任务，而各客户端的工具超时默认值都明显小于服务端自身的 `timeoutSeconds`（默认 300 秒）：

| 客户端 | 工具超时怎么设 | 默认值 |
|---|---|---|
| Codex | `[mcp_servers.wiztree]` 里 `tool_timeout_sec`（秒） | 60 |
| Claude Code / Claude Desktop | 环境变量 `MCP_TOOL_TIMEOUT`（毫秒），`MCP_TIMEOUT` 管启动 | 启动 30000ms |
| Gemini CLI | `mcpServers.wiztree.timeout`（毫秒） | 60000 |

扫一个几万文件的目录就要几十秒，整盘远超默认值。不放宽超时的典型症状是「扫描没有结果」，实际上是客户端在服务端还在跑的时候就把工具调用掐断了。

#### Codex（`~/.codex/config.toml`）

```toml
[mcp_servers.wiztree]
command = "C:\\Program Files\\nodejs\\node.exe"
args = ["C:\\path\\to\\wiztree-mcp\\dist\\index.js"]
startup_timeout_sec = 120
tool_timeout_sec = 600

[mcp_servers.wiztree.env]
WIZTREE_PATH = "C:\\Program Files\\WizTree\\WizTree64.exe"
WIZTREE_MCP_DISABLE_CLEANUP = "1"
```

`startup_timeout_sec` 只管进程启动（默认 10 秒），和工具执行超时是两回事，两个都要设。也可以用 CLI 一步添加：

```powershell
codex mcp add wiztree --env WIZTREE_PATH="C:\Program Files\WizTree\WizTree64.exe" --env WIZTREE_MCP_DISABLE_CLEANUP=1 -- "C:\Program Files\nodejs\node.exe" "C:\path\to\wiztree-mcp\dist\index.js"
```

`codex mcp add` 写不出超时字段，加完仍要手动补 `tool_timeout_sec`。

#### Claude Code / Claude Desktop

Claude Code 写 `~/.claude.json` 的 `mcpServers`，Claude Desktop 写 `claude_desktop_config.json`，结构相同：

```json
{
  "mcpServers": {
    "wiztree": {
      "type": "stdio",
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\path\\to\\wiztree-mcp\\dist\\index.js"],
      "env": {
        "WIZTREE_PATH": "C:\\Program Files\\WizTree\\WizTree64.exe",
        "WIZTREE_MCP_DISABLE_CLEANUP": "1"
      }
    }
  }
}
```

#### Gemini CLI（`~/.gemini/settings.json`）

```json
{
  "mcpServers": {
    "wiztree": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\path\\to\\wiztree-mcp\\dist\\index.js"],
      "env": { "WIZTREE_PATH": "C:\\Program Files\\WizTree\\WizTree64.exe" },
      "timeout": 600000
    }
  }
}
```

#### cc-switch（同时管多个客户端）

[cc-switch](https://github.com/farion1231/cc-switch) 把 MCP 存在自己的库里，再由面板写进各客户端的配置文件。同时用 Codex 和 Claude Code 时，用它能少维护几份配置。

1. 左侧栏 **MCP** → 页头 **添加 MCP**。
2. 「粘贴配置」里贴上面任意一份 `mcpServers` JSON（直接贴 Codex 的 TOML 也认），表单会自动填好；也可以在「连接配置」里手填命令、参数（一行一个）、环境变量、工作目录。
3. 「写入到」里勾选要同步的应用，点添加。之后在矩阵表里按应用单独开关。
4. 重启对应客户端，工具会以 `mcp__wiztree__scan_path` 这类名字出现。

两个坑：如果 Codex 已经由 cc-switch 管理，**不要再手改 `~/.codex/config.toml` 的 `[mcp_servers]` 段**，cc-switch 每次同步都按自己的库重写，手加的条目会被冲掉。`tool_timeout_sec` 这类客户端原生字段 cc-switch 不解释、原样写出，放在 JSON 里是安全的。`工作目录` 可以留空：快照与清理目录由脚本自身位置推导（`<仓库>/exports`），与工作目录无关。

### 使用提示

- `maxEntries` 在 `scan_path` 里默认 10 万条、可调上限 20 万条。一旦超限就抛 `CSV entry limit (N) reached` 并丢弃全部结果，所以别一上来就扫 `C:`。整盘统计建议直接命令行导出 CSV 自行分析；MCP 更适合对具体目录下钻、找大文件、按扩展名统计。`analyze_csv` 这类直接读 CSV 的工具固定按 20 万条上限解析。
- `scan_path` 返回的是内存句柄（`scan:<uuid>`），一个进程只保留最近一次扫描；要对比前后两次，先用 `saveSnapshot` 落盘。
- 加 `admin: true` 会触发 UAC，能扫描到受保护目录，但会弹窗；无人值守时会一直等到超时。
- `WIZTREE_MCP_DISABLE_CLEANUP=1` 只是不再暴露 `cleanup_snapshots` 工具，不影响普通扫描的临时文件清理。注意它与快照额度联动：一旦关掉，128 MiB 的快照目录额度就只能手动清理了。
- UNC 路径（`\\server\share`）会被正确识别，折叠双反斜杠时保留引导双反斜杠，`drill_down` 可以正常下钻。

### 安全边界

允许根目录白名单**尚未实现**。`analyze_csv` / `compare_csv` 接受任意 CSV 路径 —— 从 WizTree 图形界面手工导出的文件本来就在任意位置，那是核心用法 —— 等同于把进程可读的任何 CSV 交给模型；`snapshotDirectory` 同样可以是任意可写目录。`get_treemap` 已收窄到 `WIZTREE_MCP_EXPORT_DIR` 之内且只接受 `.png`。请在受信任的机器上使用，共享结果前留意其中包含完整本地路径。

## 上游与许可

基于 [onmokoworks/wiztree-mcp](https://github.com/onmokoworks/wiztree-mcp)（MIT）。本分支同样以 MIT 发布，详见 [LICENSE](LICENSE)。上游若合并了这些修复，可直接切换回去。

WizTree 本身是 [Antibody Software](https://diskanalyzer.com/) 的产品，免费版即可导出 CSV；本仓库不包含 WizTree 的任何文件。
