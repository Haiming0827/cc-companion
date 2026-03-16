const { exec } = require('child_process');
const EventEmitter = require('events');

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
    // Use pgrep to find Claude PIDs first, then get details only for those
    exec(
      "ps -eo pid,tty,%cpu,%mem,rss,etime,command | grep '^[[:space:]]*[0-9].*Claude ' | grep -v grep | grep -v cc-companion | grep -v Electron | grep -v '/bin/'",
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
              this.getCwd(pid).then(cwd => {
                const projectName = cwd ? cwd.split('/').pop() : `session-${pid}`;
                this.instances.set(pid, {
                  pid, tty, cpu, mem, rss,
                  active: isActive, etime,
                  cwd: cwd || 'unknown', project: projectName,
                  discoveredAt: now,
                  activeStart: isActive ? now : null,
                  idleStart: isActive ? null : now,
                  lastSeen: now,
                });
                this.emitIfChanged();
              });
            }
          }
        }

        // Remove instances that disappeared
        for (const [pid] of this.instances) {
          if (!seenPids.has(pid)) {
            this.instances.delete(pid);
          }
        }

        // Only emit if we didn't defer to getCwd (avoids double emit)
        if (!hasNewInstances) {
          this.emitIfChanged();
        }
      }
    );
  }

  emitIfChanged() {
    const snapshot = this.getSnapshot();
    // Compare key fields to avoid no-op updates
    const key = JSON.stringify(snapshot.instances.map(i => [i.pid, i.active, i.cpu.toFixed(0), i.rss]));
    if (key !== this._lastSnapshotJSON) {
      this._lastSnapshotJSON = key;
      this.emit('instance-update', snapshot);
    } else {
      // Always emit (timers need updates) but mark as minor
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
