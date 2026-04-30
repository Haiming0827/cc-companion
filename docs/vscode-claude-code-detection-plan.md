# VSCode Claude Code 插件检测 — 开发计划

## 背景

当前 cc-companion 只监控终端中的 Claude CLI 进程。用户在 VSCode 中使用 Claude Code 插件时，这些进程没有 tty（`ps` 输出为 `?`），被 `watcher.js:261` 的 tty 过滤跳过，无法在面板中显示。

**关键发现**：VSCode Claude Code 插件的 session 文件（`~/.claude/sessions/{pid}.json`）和 JSONL 对话文件（`~/.claude/projects/{key}/{sessionId}.jsonl`）与 CLI 完全一致，格式相同，只是 session 文件多一个 `entrypoint: "claude-vscode"` 字段。因此，所有现有的状态检测逻辑（JSONL 分析、token 计数、活跃状态判断）可直接复用。

## 目标

让 cc-companion 面板同时显示终端 CLI 和 VSCode 插件的 Claude Code 实例，区分来源，正确显示状态和统计数据。

---

## 改动清单

### Step 1: watcher.js — 放开 tty 过滤

**文件**: `electron/watcher.js`
**位置**: `check()` 方法，第 261 行

**现状**:
```js
if (tty === '??' || tty === '?') continue;
```

**改为**:
```js
const noTty = tty === '??' || tty === '?';

// Skip subagent processes (parent is another Claude instance)
if (allClaudePids.has(ppid)) continue;

// No-tty processes without a session file are not Claude instances
if (noTty) {
  const sessionInfo = this._readSessionFile(pid);
  if (!sessionInfo) continue;
  // 有 session 文件 → VSCode Claude Code 插件，继续处理
}

seenPids.add(pid);
```

**注意**: subagent 过滤要移到 tty 过滤之前，否则无 tty 的子进程会先被 tty 过滤跳过，绕过 subagent 检查。

**效果**: 无 tty 的 `claude` 进程只要有 `~/.claude/sessions/{pid}.json` 就会被检测到。

---

### Step 2: watcher.js — 读取并存储 entrypoint 字段

**文件**: `electron/watcher.js`

#### 2a: `_readSessionFile()` 方法（第 414-426 行）

**现状**:
```js
_readSessionFile(pid) {
  try {
    const filePath = path.join(SESSIONS_DIR, `${pid}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      sessionId: data.sessionId,
      startedAt: data.startedAt,
      cwd: data.cwd,
    };
  } catch {
    return null;
  }
}
```

**改为**:
```js
_readSessionFile(pid) {
  try {
    const filePath = path.join(SESSIONS_DIR, `${pid}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      sessionId: data.sessionId,
      startedAt: data.startedAt,
      cwd: data.cwd,
      entrypoint: data.entrypoint || 'cli',
    };
  } catch {
    return null;
  }
}
```

#### 2b: `_initInstance()` 方法（第 366-391 行）

在实例对象中新增 `entrypoint` 字段：

```js
this.instances.set(pid, {
  pid, tty, cpu, mem, rss,
  // ...existing fields...
  entrypoint: sessionInfo?.entrypoint || 'cli',
  oneMBeta,
});
```

#### 2c: `getSnapshot()` 方法（第 571-586 行）

`entrypoint` 是公开字段，无需剥离，自动包含在 `publicInst` 中。

---

### Step 3: main.js — focus 逻辑处理 VSCode 实例

**文件**: `electron/main.js`
**位置**: `focus-instance` IPC handler（第 173 行起）

**现状**: 当 `_terminalApp` 为 `null` 时，`appName` 默认为 `'Terminal'`，macOS 会执行 AppleScript 操作 Terminal.app，Linux 会执行 xdotool 按项目名搜索。这对 VSCode 实例无意义。

**改为**: 在 focus 逻辑开头加 VSCode 实例判断：

```js
ipcMain.handle('focus-instance', async (_, pid) => {
  const inst = watcher ? watcher.getInstance(pid) : null;
  const appName = (watcher ? watcher.getTerminalApp(pid) : null) || 'Terminal';
  const project = inst?.project || '';
  const tty = inst?.tty ? `/dev/${inst.tty}` : '';
  const instCwd = inst?._sessionCwd || inst?.cwd || '';

  // VSCode Claude Code instances have no terminal to focus.
  // Try to focus the VSCode window by project name instead.
  if (!inst?.tty && inst?.entrypoint === 'claude-vscode') {
    if (platform.isLinux) {
      return platform.focusLinux(project);
    }
    // macOS: activate VSCode via AppleScript
    return new Promise((resolve) => {
      const asProject = project.replace(/"/g, '\\"');
      const script = `
        tell application "System Events"
          if exists process "Code" then
            set frontmost of process "Code" to true
          end if
        end tell
      `;
      execFile('osascript', ['-e', script], () => resolve());
    });
  }

  // kitty and WezTerm have cross-platform CLIs...
  // (existing logic continues)
```

---

### Step 4: compact.js — tile 显示来源标识

**文件**: `src/compact.js`
**位置**: `render()` 方法中 tile HTML 构建（约第 203-216 行）

**现状**: tile 显示项目名和模型名。

**改为**: 对 VSCode 实例在项目名旁添加来源标签：

```js
// 在 render() 的 tile 构建中
const sourceTag = inst.entrypoint === 'claude-vscode'
  ? '<span class="ci-source ci-vscode">VS</span>'
  : '';

// tile HTML 中
<div class="ci-project">${displayName}${sourceTag}</div>
```

---

### Step 5: compact.css — 来源标签样式

**文件**: `src/compact.css`

```css
.ci-source {
  display: inline-block;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 4px;
  border-radius: 3px;
  margin-left: 4px;
  vertical-align: middle;
  letter-spacing: 0.5px;
}

.ci-vscode {
  background: rgba(0, 120, 212, 0.25);
  color: #569cd6;
}

.light .ci-vscode {
  background: rgba(0, 120, 212, 0.15);
  color: #0066cc;
}
```

---

### Step 6: watcher.js — 无 tty 进程不检测终端应用

**文件**: `electron/watcher.js`
**位置**: `_initInstance()` 第 358 行

**现状**: `_detectTerminalApp(pid)` 会遍历进程树，在 VSCode 中会返回 `Visual Studio Code`（因为父进程是 VSCode）。

**改为**: 对无 tty 进程跳过终端检测，直接标记为 VSCode 来源：

```js
// 在 _initInstance() 中
let terminalApp = null;
if (!tty || tty === '??' || tty === '?') {
  // No tty → VSCode plugin, no terminal to focus via AppleScript/xdotool
  terminalApp = null;
} else {
  terminalApp = await this._detectTerminalApp(pid);
}
```

---

### Step 7: 测试补充

**文件**: `test/watcher.test.js`

新增以下测试用例：

1. **无 tty 有 session 文件** — 进程被正确检测为实例
2. **无 tty 无 session 文件** — 进程被跳过
3. **entrypoint 字段** — VSCode 实例的 `entrypoint` 为 `"claude-vscode"`，CLI 实例为 `"cli"`
4. **无 tty 进程跳过终端检测** — `_detectTerminalApp` 不被调用
5. **getSnapshot 包含 entrypoint** — 验证公开字段

---

## 文件改动汇总

| 文件 | 改动 | 行数估算 |
|------|------|---------|
| `electron/watcher.js` | tty 过滤逻辑 + entrypoint 字段 + 无 tty 跳过终端检测 | ~20 行 |
| `electron/main.js` | focus 逻辑加 VSCode 实例判断 | ~15 行 |
| `src/compact.js` | tile 渲染加来源标签 | ~3 行 |
| `src/compact.css` | 来源标签样式 | ~15 行 |
| `test/watcher.test.js` | 新增 5 个测试用例 | ~60 行 |

## 验证方法

1. `npm test` — 所有新增和现有测试通过
2. `npm start` — 同时打开终端 `claude` 和 VSCode Claude Code 插件，面板显示所有实例
3. VSCode 实例 tile 旁显示蓝色 "VS" 标签
4. 点击 VSCode 实例 tile — 尝试聚焦 VSCode 窗口（而非终端）
5. 点击终端实例 tile — 原有终端聚焦逻辑不受影响
6. 详情面板正确显示 token 统计和模型信息
