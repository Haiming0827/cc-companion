const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const readline = require('readline');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

class ClaudeWatcher extends EventEmitter {
  constructor() {
    super();
    this.instances = new Map(); // pid -> instance info
    this.pollInterval = null;
    this._lastSnapshotJSON = null; // for change detection
  }

  start() {
    this.check();
    this.pollInterval = setInterval(() => this.check(), 2000);
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  check() {
    exec(
      "ps -eo pid,tty,%cpu,%mem,rss,etime,command | grep -i '^[[:space:]]*[0-9].*claude' | grep -v grep | grep -v cc-companion | grep -v Electron | grep -v '/bin/'",
      (err, stdout) => {
        const now = Date.now();
        const seenPids = new Set();
        let hasNewInstances = false;

        if (stdout && stdout.trim()) {
          const lines = stdout.trim().split('\n');
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 5) continue;

            const pid = parseInt(parts[0]);
            const tty = parts[1];
            const cpu = parseFloat(parts[2]);
            const mem = parseFloat(parts[3]);
            const rss = parseInt(parts[4]);
            const etime = parts[5];

            if (tty === '??' || tty === '?') continue;

            seenPids.add(pid);
            const existing = this.instances.get(pid);
            const isActive = cpu > 3;

            if (existing) {
              const wasActive = existing.active;
              existing.cpu = cpu;
              existing.mem = mem;
              existing.rss = rss;
              existing.active = isActive;
              existing.etime = etime;
              existing.lastSeen = now;

              if (isActive && !wasActive) {
                existing.activeStart = now;
                existing.idleStart = null;
              } else if (!isActive && wasActive) {
                existing.idleStart = now;
                existing.activeStart = null;
              }
            } else {
              hasNewInstances = true;
              this._initInstance(pid, tty, cpu, mem, rss, etime, isActive, now);
            }
          }
        }

        // Remove instances that disappeared
        for (const [pid] of this.instances) {
          if (!seenPids.has(pid)) {
            this.instances.delete(pid);
          }
        }

        // Only emit if we didn't defer to async init (avoids double emit)
        if (!hasNewInstances) {
          this.emitIfChanged();
        }
      }
    );
  }

  async _initInstance(pid, tty, cpu, mem, rss, etime, isActive, now) {
    const cwd = await this.getCwd(pid);
    const projectName = cwd ? cwd.split('/').pop() : `session-${pid}`;
    const sessionInfo = this._readSessionFile(pid);
    const sessionStats = sessionInfo ? await this._getSessionStats(sessionInfo.sessionId, cwd) : null;

    this.instances.set(pid, {
      pid, tty, cpu, mem, rss,
      active: isActive, etime,
      cwd: cwd || 'unknown', project: projectName,
      discoveredAt: now,
      activeStart: isActive ? now : null,
      idleStart: isActive ? null : now,
      lastSeen: now,
      // Session metadata
      sessionId: sessionInfo?.sessionId || null,
      startedAt: sessionInfo?.startedAt || null,
      // Conversation stats
      turnCount: sessionStats?.turnCount || 0,
      inputTokens: sessionStats?.inputTokens || 0,
      outputTokens: sessionStats?.outputTokens || 0,
      cacheReadTokens: sessionStats?.cacheReadTokens || 0,
      cacheCreateTokens: sessionStats?.cacheCreateTokens || 0,
      model: sessionStats?.model || null,
      gitBranch: sessionStats?.gitBranch || null,
    });
    this.emitIfChanged();
  }

  // Read ~/.claude/sessions/{pid}.json for session metadata
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

  // Parse conversation JSONL for token usage and message counts
  async _getSessionStats(sessionId, cwd) {
    if (!sessionId || !cwd) return null;

    // Build the project key (path with non-alphanumeric chars replaced by dashes)
    const projectKey = cwd.replace(/[^a-zA-Z0-9]/g, '-');
    const jsonlPath = path.join(PROJECTS_DIR, projectKey, `${sessionId}.jsonl`);

    try {
      await fs.promises.access(jsonlPath);
    } catch {
      return null;
    }

    return new Promise((resolve) => {
      const stats = {
        turnCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        model: null,
        gitBranch: null,
      };

      const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      rl.on('line', (line) => {
        try {
          const entry = JSON.parse(line);
          // Count turns: a "turn" is a real user prompt (not a tool-use result)
          if (entry.type === 'user' && !entry.toolUseResult) {
            stats.turnCount++;
          }
          if (entry.type === 'assistant' && entry.message) {
            if (entry.message.model) stats.model = entry.message.model;
            if (entry.gitBranch) stats.gitBranch = entry.gitBranch;
            const usage = entry.message.usage;
            if (usage) {
              stats.inputTokens += (usage.input_tokens || 0);
              stats.outputTokens += (usage.output_tokens || 0);
              stats.cacheReadTokens += (usage.cache_read_input_tokens || 0);
              stats.cacheCreateTokens += (usage.cache_creation_input_tokens || 0);
            }
          }
        } catch { /* skip malformed lines */ }
      });

      rl.on('close', () => resolve(stats));
      rl.on('error', () => resolve(stats));
    });
  }

  // Refresh stats for a specific instance (called periodically)
  async refreshSessionStats(pid) {
    const inst = this.instances.get(pid);
    if (!inst || !inst.sessionId || !inst.cwd) return;
    const stats = await this._getSessionStats(inst.sessionId, inst.cwd);
    if (stats) {
      inst.turnCount = stats.turnCount;
      inst.inputTokens = stats.inputTokens;
      inst.outputTokens = stats.outputTokens;
      inst.cacheReadTokens = stats.cacheReadTokens;
      inst.cacheCreateTokens = stats.cacheCreateTokens;
      inst.model = stats.model;
      inst.gitBranch = stats.gitBranch;
    }
  }

  emitIfChanged() {
    const snapshot = this.getSnapshot();
    const key = JSON.stringify(snapshot.instances.map(i => [i.pid, i.active, i.cpu.toFixed(0), i.rss, i.turnCount, i.outputTokens]));
    if (key !== this._lastSnapshotJSON) {
      this._lastSnapshotJSON = key;
      this.emit('instance-update', snapshot);
    }
  }

  getInstance(pid) {
    return this.instances.get(pid) || null;
  }

  getCwd(pid) {
    return new Promise((resolve) => {
      exec(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | grep '^n'`, (err, stdout) => {
        if (stdout && stdout.trim()) {
          resolve(stdout.trim().replace(/^n/, ''));
        } else {
          resolve(null);
        }
      });
    });
  }

  getSnapshot() {
    const instances = [];
    let totalActive = 0;
    for (const [, inst] of this.instances) {
      instances.push({ ...inst });
      if (inst.active) totalActive++;
    }
    return {
      instances,
      count: instances.length,
      anyActive: totalActive > 0,
      totalActive,
    };
  }

  resetStats() {
    this.instances.clear();
    this._lastSnapshotJSON = null;
    this.emit('instance-update', this.getSnapshot());
  }
}

module.exports = { ClaudeWatcher };
