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

CI 现在跑 `npm test`，并且拆成 `windows-latest` 和 `macos-latest` 两个 job。之前 CI 里根本没有测试步骤：macOS 原生用例在 Windows runner 上必红（夹具要创建文件名含 `"` 的文件，Windows 不允许），于是整条测试链都没挂。现在这些依赖 POSIX 符号链接、文件权限、大小写敏感文件名的用例在非 macOS 上按原因跳过，`npm test` 在 Windows 上退出码 0 —— 29 项里 25 通过、4 跳过，macOS 上 29 项全部运行。

测试构成：`tests/native.test.mjs` 是 macOS 原生扫描用例，`tests/windows.test.mjs` 是 Windows 导出与 CSV 用例，`tests/print-config.test.mjs` 覆盖注册配置生成脚本（输出必须全是绝对路径、不得残留占位符文本；`dist/index.js` 缺失时以退出码 1 拒绝生成；参数写错要报错而不是静默输出空配置）。

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

自动化测试全部跑在夹具上。夹具之外做过一次 Windows 实机冒烟：按客户端的方式启动构建产物，注册后的 stdio 会话列出全部 11 个工具、用已安装的 `WizTree64.exe` 扫了一个小目录、跑了若干分析工具，并正确拒绝了越界的 `get_treemap` 路径。UAC 提权、导出进程卡死时的 `taskkill`、macOS 实机行为以及任何用户数据删除仍未验证，本分支也不会持久扩大权限。

### 依赖审计第二轮

`npm audit --audit-level=high` 因两条新公告重新变红：`body-parser`（high）与 `zod`（high，影响 `zod <4.6.6`，GHSA-mrhx-c7xc-m3w5，校验超大受限集合时内存耗尽）。zod 3.x 没有修复版，而 `@modelcontextprotocol/sdk` 1.32 声明 `zod: ^3.25 || ^4.0`、`zod-to-json-schema` 3.25.2 的 peer 是 `^3.25.28 || ^4`，因此这一项破例把直接依赖升到 `^4.6.7`（第一轮「不动大版本」的规则仅此一处例外），解析后的依赖树里 zod 只有一份，没有藏在 SDK 下的 v3 副本。除类型检查外，还按真实 stdio 会话核过 11 个工具的 default、enum、description 与数值上限均照常输出。

其余为间接依赖刷新：`@hono/node-server` 1.19.17 → 2.1.7、`body-parser` 2.2.2 → 2.4.0（附带一个嵌套 `content-type` 2.1.0，包名未新增）、`fast-uri` 3.1.8 → 3.1.9，以及 `ip-address`、`qs`、`iconv-lite` 随同刷新。`csv-parse` 5.x 仍是未处理的 moderate（仅在 7.0.2 修复，属破坏性大版本），继续留作单独评审。`npm audit --audit-level=high` 恢复退出码 0，`--audit-level=moderate` 仍报那一条，未添加任何审计豁免。完整表格见英文 README 的「Second pass」。

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

构建完成后，`npm run print-config` 会按当前这份 checkout 生成可直接粘贴的注册配置，不必手改文档里的路径，见下文「通用注册方法」。

### 注册到 DSH（DeepSeek-Harness）

编辑 profile 的补丁文件 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`，追加（`<...>` 是占位符，含义见下文「示例里的占位符」）：

```yaml
- id: mcp-wiztree
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    serverName: wiztree
    transport: stdio
    command: <NODE>\node.exe
    args:
      - <仓库路径>\dist\index.js
    cwd: <仓库路径>
    toolCallTimeoutMs: 600000
    env:
      WIZTREE_PATH: C:\Program Files\WizTree\WizTree64.exe
      WIZTREE_MCP_DISABLE_CLEANUP: "1"
```

重启 DSH 后，工具会以 `mcp__wiztree__scan_path` 这样的名字出现。整盘扫描建议加大 `toolCallTimeoutMs`（默认 60 秒对 C 盘可能不够）。

### 通用注册方法

先让仓库自己把路径算出来，别手改示例：

```powershell
npm run print-config                    # Codex、cc-switch、Claude Code/Desktop、Gemini CLI
npm run print-config -- --client codex  # 只要某一个客户端
```

它按当前 checkout 打印下面这几类配置块，`dist/index.js` 的绝对路径、跑它的那个 `node` 的绝对路径、以及超时字段全部填好。`dist/index.js` 不存在时它直接以退出码 1 结束、不给可用输出，不会出现「只构建了一半就被注册进去」的情况。

#### 示例里的占位符

写成 `<...>` 的一律是**占位符，不是路径**，只有两个：

| 占位符 | 替换成 | 怎么取 |
|---|---|---|
| `<仓库路径>` | 本仓库的绝对路径，例如 `C:\tools\wiztree-mcp` | `git rev-parse --show-toplevel` |
| `<NODE>` | node 可执行文件所在目录（不含 `node.exe`） | `where.exe node` / `which node` |

替换时把尖括号连同占位符整段换掉，只删中间那几个字不行。

这一条比一般示例更要紧：`<` 和 `>` 本来就是非法路径字符，半替换的命令行永远解析不到文件，而客户端给出的信息几乎为零 —— 图形界面客户端是在模型介入之前就把 MCP 进程拉起来的，脚本路径 `ENOENT` 只会表现成「未连接」，甚至压根不出现在 `/mcp` 和工具列表里，对话里看不出到底是哪一行写错。

#### 贴配置之前，先把两个路径确认下来

```powershell
npm run print-config -- --client codex   # 两个路径都已按目标文件的转义规则写好
```

或者在仓库根目录自己查：

```powershell
where.exe node                       # 填进 command
node -e "console.log(require('path').join(process.cwd(),'dist','index.js'), require('fs').existsSync(require('path').join(process.cwd(),'dist','index.js')))"
```

macOS/Linux 用 `which node`，第二条命令一样。第二条必须打印 `true`；打印 `false` 说明没跑 `npm run build`，或者命令不是在仓库根目录执行的。

贴完还要**重启客户端**（MCP 配置只在启动时读取），并且要验证连接、不要默认它已经好了：Codex 里 `/mcp` 必须能看到 `wiztree` 和它的工具；Claude Code 用 `claude mcp list`，它会真的连一次并回 `✔ wiztree - OK`。

任何 MCP 客户端还要同时满足三件事，缺一不可：

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
command = "<NODE>\\node.exe"
args = ["<仓库路径>\\dist\\index.js"]
startup_timeout_sec = 120
tool_timeout_sec = 600

[mcp_servers.wiztree.env]
WIZTREE_PATH = "C:\\Program Files\\WizTree\\WizTree64.exe"
WIZTREE_MCP_DISABLE_CLEANUP = "1"
```

`startup_timeout_sec` 只管进程启动（默认 10 秒），和工具执行超时是两回事，两个都要设。也可以用 CLI 一步添加：

```powershell
codex mcp add wiztree --env WIZTREE_PATH="C:\Program Files\WizTree\WizTree64.exe" --env WIZTREE_MCP_DISABLE_CLEANUP=1 -- "<NODE>\node.exe" "<仓库路径>\dist\index.js"
```

`codex mcp add` 写不出超时字段，加完仍要手动补 `tool_timeout_sec`，所以更建议直接用 `npm run print-config -- --client codex` 打出来的整段 TOML。

`WIZTREE_PATH` 在 WizTree 装于默认位置时可省。如果 `npm run print-config` 没探测到 WizTree、因而没输出这个键，就别自己补一个猜的路径：指向不存在的 `WizTree64.exe` 比不写这个键更糟。

#### Claude Code / Claude Desktop

Claude Code 写 `~/.claude.json` 的 `mcpServers`，Claude Desktop 写 `claude_desktop_config.json`，结构相同：

```json
{
  "mcpServers": {
    "wiztree": {
      "type": "stdio",
      "command": "<NODE>\\node.exe",
      "args": ["<仓库路径>\\dist\\index.js"],
      "env": {
        "WIZTREE_PATH": "C:\\Program Files\\WizTree\\WizTree64.exe",
        "WIZTREE_MCP_DISABLE_CLEANUP": "1"
      }
    }
  }
}
```

JSON 里的反斜杠必须成对，少转义一位不会报错，只会解析成一个错路径，这类错误比 TOML 更难查；`npm run print-config -- --client claude` 会把转义一起处理掉。

#### Gemini CLI（`~/.gemini/settings.json`）

```json
{
  "mcpServers": {
    "wiztree": {
      "command": "<NODE>\\node.exe",
      "args": ["<仓库路径>\\dist\\index.js"],
      "env": { "WIZTREE_PATH": "C:\\Program Files\\WizTree\\WizTree64.exe" },
      "timeout": 600000
    }
  }
}
```

#### cc-switch（同时管多个客户端）

[cc-switch](https://github.com/farion1231/cc-switch) 把 MCP 存在自己的库里，再由面板写进各客户端的配置文件。同时用 Codex 和 Claude Code 时，用它能少维护几份配置。

1. `npm run print-config -- --client cc-switch`，复制它打印的 JSON。
2. 左侧栏 **MCP** → 页头 **添加 MCP**。
3. 把那段 JSON 贴进「粘贴配置」，表单会自动填好（直接贴 Codex 的 TOML 也认）；也可以在「连接配置」里手填命令、参数（一行一个）、环境变量、工作目录。
4. 「写入到」里勾选要同步的应用，点添加。之后在矩阵表里按应用单独开关。
5. 重启对应客户端并确认连接：Codex 看 `/mcp`，Claude Code 跑 `claude mcp list`。工具会以 `mcp__wiztree__scan_path` 这类名字出现。

在这里，第 1 步比其他客户端更不能省：cc-switch 把参数存进自己的库，再逐个回放给被它管理的客户端，所以面板「参数」里留下的占位路径会在下一次同步时被原样写进 `~/.codex/config.toml`，而启动失败在客户端里几乎不留错误文本。注册后看不到工具，先去 cc-switch 里编辑该条目、把参数那一行读一遍，再怀疑服务端。

两个坑：如果 Codex 已经由 cc-switch 管理，**不要再手改 `~/.codex/config.toml` 的 `[mcp_servers]` 段**，cc-switch 每次同步都按自己的库重写，手改的修正会被冲掉，正确的改法是去面板里改条目。`tool_timeout_sec` 这类客户端原生字段 cc-switch 不解释、原样写出，放在 JSON 里是安全的。`工作目录` 可以留空：快照与清理目录由脚本自身位置推导（`<仓库路径>/exports`），与工作目录无关。

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
