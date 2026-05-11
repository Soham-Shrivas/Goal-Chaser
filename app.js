let state = {
    subjects: [],
    todos: [],
    ddays: [],
    sessions: [],
    activeSubjectId: null,
    timerMode: 'stopwatch',
    pomodoro: { focus: 25, break: 5, sessions: 4 },
    settings: { notifications: false, sound: true },
};

let timerState = {
    running: false,
    elapsed: 0,
    remaining: 0,
    intervalId: null,
    pomoPhase: 'focus',
    pomoSession: 1,
    sessionStartTime: null,
};

document.addEventListener('DOMContentLoaded', () => {
    loadState();
    showAuthScreen();
    renderDate();
    renderSubjectChips();
    updateSubjectSelects();
    renderTodos();
    renderDdays();
    updateTodaySummary();
    renderStats();
    renderHeatmap();

    if ('Notification' in window && state.settings.notifications) {
        Notification.requestPermission();
    }

    setInterval(renderDate, 60000);
    setInterval(renderDdays, 60000);
});

function loadState() {
    localStorage.removeItem('goal-chaser-state');
    localStorage.removeItem('goalchaser_user');
    state.currentUser = null;
    state.friends = [];
    state.groups = [];
    state.sessions = [];
}

function saveState() {
    try {
        localStorage.setItem('goal-chaser-state', JSON.stringify(state));
    } catch (e) {
        console.warn('Failed to save state:', e);
    }
}

function renderDate() {
    const now = new Date();
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    document.getElementById('header-date').textContent = now.toLocaleDateString('en-US', options);
}

function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

    document.getElementById(`tab-${tab}`).classList.add('active');
    document.querySelector(`.nav-btn[data-tab="${tab}"]`).classList.add('active');

    if (tab === 'stats') {
        renderStats();
        renderHeatmap();
    }
    if (tab === 'dday') renderDdays();
    if (tab === 'todos') renderTodos();
    if (tab === 'friends') {
        if (!currentUser) return;
        loadFriends();
    }
    if (tab === 'groups') {
        if (!currentUser) return;
        loadGroups();
    }
    if (tab === 'admin') {
        loadAdminUsers();
        loadAdminSessions();
    }
}

function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab').forEach(el => el.classList.remove('active'));
    document.querySelector(`.admin-tab[data-admin-tab="${tab}"]`).classList.add('active');
    
    document.querySelectorAll('.admin-section').forEach(el => el.classList.add('hidden'));
    document.getElementById(`admin-${tab}-section`).classList.remove('hidden');
}

async function loadAdminUsers() {
    try {
        const res = await fetch('/api/admin/users');
        const users = await res.json();

        const totalTime = users.reduce((sum, u) => sum + (u.totalStudyTime || 0), 0);
        const statsHtml = `
            <div class="admin-stat-card">
                <div class="admin-stat-value">${users.length}</div>
                <div class="admin-stat-label">Total Users</div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-value">${formatDuration(totalTime)}</div>
                <div class="admin-stat-label">Total Study Time</div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-value">${users.reduce((sum, u) => sum + (u.sessionCount || 0), 0)}</div>
                <div class="admin-stat-label">Total Sessions</div>
            </div>
        `;
        document.getElementById('admin-stats').innerHTML = statsHtml;

        const list = document.getElementById('admin-users-list');
        list.innerHTML = users.map(u => {
            const avatarHtml = getAvatarHTML(u.avatar, u.displayName || u.username);
            const initials = getAvatarInitials(u.avatar, u.displayName || u.username);
            return `
            <div class="admin-user-card">
                <div class="admin-user-avatar">
                    ${avatarHtml || initials}
                </div>
                <div class="admin-user-info">
                    <div class="admin-user-name">${escapeHtml(u.displayName || u.username)}</div>
                    <div class="admin-user-username">@${escapeHtml(u.username)}</div>
                    <div class="admin-user-stats">
                        <span class="admin-user-stat">Study: <span>${formatDuration(u.totalStudyTime || 0)}</span></span>
                        <span class="admin-user-stat">Sessions: <span>${u.sessionCount || 0}</span></span>
                        <span class="admin-user-stat">Friends: <span>${u.friendCount || 0}</span></span>
                    </div>
                </div>
                <div class="admin-user-actions">
                    <div class="admin-focus-edit">
                        <input type="number" id="focus-${u.id}" value="25" min="5" max="120" placeholder="min">
                        <button class="btn-accent-small" onclick="updateUserFocus(${u.id})">Set</button>
                    </div>
                    <button class="btn-danger-small" onclick="deleteUser(${u.id})">Delete</button>
                </div>
            </div>
        `}).join('');
    } catch (err) {
        console.error('Failed to load admin users:', err);
    }
}

async function loadAdminSessions() {
    try {
        const res = await fetch('/api/admin/all-sessions');
        const sessions = await res.json();

        const list = document.getElementById('admin-sessions-list');
        if (sessions.length === 0) {
            list.innerHTML = '<div class="no-results">No sessions yet</div>';
        } else {
            list.innerHTML = sessions.map(s => `
                <div class="admin-session-item">
                    <span class="admin-session-user">${escapeHtml(s.displayName || s.username)}</span>
                    <span class="admin-session-time">${new Date(s.startTime).toLocaleString()}</span>
                    <span class="admin-session-duration">${formatDuration(s.seconds)}</span>
                    ${s.groupName ? `<span class="admin-session-group">Group: ${escapeHtml(s.groupName)}</span>` : ''}
                </div>
            `).join('');
        }
    } catch (err) {
        console.error('Failed to load admin sessions:', err);
    }
}

async function updateUserFocus(userId) {
    const focusTime = document.getElementById(`focus-${userId}`).value;
    alert(`Focus time for user ${userId} would be set to ${focusTime} minutes (Demo feature)`);
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to DELETE this user? This cannot be undone!')) return;
    if (!confirm('This will delete all their data including messages, friends, and study sessions. Continue?')) return;

    try {
        const res = await fetch('/api/admin/update-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, action: 'delete' })
        });
        const data = await res.json();
        if (data.success) {
            alert('User deleted successfully');
            loadAdminUsers();
        }
    } catch (err) {
        alert('Failed to delete user');
    }
}

let editingSubjectId = null;

function openSubjectModal(subjectId) {
    editingSubjectId = subjectId || null;
    const modal = document.getElementById('subject-modal');
    const title = document.getElementById('subject-modal-title');
    const input = document.getElementById('subject-name-input');

    if (editingSubjectId) {
        const s = state.subjects.find(x => x.id === editingSubjectId);
        title.textContent = 'Edit Subject';
        input.value = s.name;
        document.querySelectorAll('#color-options .color-dot').forEach(d => {
            d.classList.toggle('active', d.dataset.color === s.color);
        });
    } else {
        title.textContent = 'Add Subject';
        input.value = '';
        document.querySelectorAll('#color-options .color-dot').forEach((d, i) => {
            d.classList.toggle('active', i === 0);
        });
    }

    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
}

function closeSubjectModal() {
    document.getElementById('subject-modal').classList.add('hidden');
    editingSubjectId = null;
}

function selectSubjectColor(el) {
    el.parentElement.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    el.classList.add('active');
}

function saveSubject() {
    const name = document.getElementById('subject-name-input').value.trim();
    if (!name) return;
    const activeColor = document.querySelector('#color-options .color-dot.active');
    const color = activeColor ? activeColor.dataset.color : '#8b5cf6';

    if (editingSubjectId) {
        const s = state.subjects.find(x => x.id === editingSubjectId);
        s.name = name;
        s.color = color;
    } else {
        state.subjects.push({
            id: generateId(),
            name,
            color,
            createdAt: new Date().toISOString(),
        });
    }

    saveState();
    renderSubjectChips();
    updateSubjectSelects();
    renderTodos();
    closeSubjectModal();
}

function deleteSubject(id) {
    if (!confirm('Delete this subject and all related tasks?')) return;
    state.subjects = state.subjects.filter(s => s.id !== id);
    state.todos = state.todos.filter(t => t.subjectId !== id);
    state.sessions = state.sessions.filter(s => s.subjectId !== id);
    if (state.activeSubjectId === id) state.activeSubjectId = null;
    saveState();
    renderSubjectChips();
    updateSubjectSelects();
    renderTodos();
    updateTimerSubjectLabel();
    renderStats();
}

function selectSubject(id) {
    state.activeSubjectId = state.activeSubjectId === id ? null : id;
    saveState();
    renderSubjectChips();
    updateTimerSubjectLabel();
}

function renderSubjectChips() {
    const container = document.getElementById('subject-chips');
    if (state.subjects.length === 0) {
        container.innerHTML = '<span style="font-size:0.8rem;color:var(--text-tertiary)">Add a subject to start →</span>';
        return;
    }
    container.innerHTML = state.subjects.map(s => `
        <div class="subject-chip ${state.activeSubjectId === s.id ? 'active' : ''}"
             style="--chip-color: ${s.color}; ${state.activeSubjectId === s.id ? `border-color:${s.color};color:${s.color}` : ''}"
             onclick="selectSubject('${s.id}')">
            <span class="chip-dot" style="background:${s.color}"></span>
            ${escapeHtml(s.name)}
            <button class="chip-delete" onclick="event.stopPropagation();deleteSubject('${s.id}')" title="Delete">×</button>
        </div>
    `).join('');
}

function updateSubjectSelects() {
    const optionsHtml = state.subjects.map(s =>
        `<option value="${s.id}">${escapeHtml(s.name)}</option>`
    ).join('');

    const filter = document.getElementById('todo-filter-subject');
    filter.innerHTML = `<option value="all">All Subjects</option>${optionsHtml}`;

    const newTaskSelect = document.getElementById('new-task-subject');
    newTaskSelect.innerHTML = state.subjects.length
        ? optionsHtml
        : '<option value="">No subjects</option>';
}

function updateTimerSubjectLabel() {
    const label = document.getElementById('timer-subject-label');
    if (state.activeSubjectId) {
        const s = state.subjects.find(x => x.id === state.activeSubjectId);
        label.textContent = s ? s.name : 'Select a subject';
        label.style.color = s ? s.color : '';
    } else {
        label.textContent = 'Select a subject';
        label.style.color = '';
    }
}

function toggleTimer() {
    if (!state.activeSubjectId) {
        shakeElement(document.querySelector('.subject-selector'));
        return;
    }

    if (timerState.running) {
        stopTimer();
    } else {
        startTimer();
    }
}

function startTimer() {
    timerState.running = true;
    timerState.sessionStartTime = Date.now();

    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const startBtn = document.getElementById('timer-start-btn');
    const digits = document.getElementById('timer-digits');

    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
    startBtn.classList.add('active-timer');
    digits.classList.add('running');

    if (state.timerMode === 'pomodoro' && timerState.remaining === 0) {
        timerState.remaining = state.pomodoro.focus * 60;
        timerState.pomoPhase = 'focus';
        timerState.pomoSession = 1;
    }

    timerState.intervalId = setInterval(() => {
        if (state.timerMode === 'stopwatch') {
            timerState.elapsed++;
            updateTimerDisplay(timerState.elapsed);
            updateRingProgress(timerState.elapsed, 3600);
        } else {
            timerState.remaining--;
            updateTimerDisplay(timerState.remaining);
            updateRingProgress(
                state.pomodoro[timerState.pomoPhase] * 60 - timerState.remaining,
                state.pomodoro[timerState.pomoPhase] * 60
            );

            if (timerState.remaining <= 0) {
                handlePomodoroPhaseEnd();
            }
        }
    }, 1000);
}

function stopTimer() {
    timerState.running = false;
    clearInterval(timerState.intervalId);

    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const startBtn = document.getElementById('timer-start-btn');
    const digits = document.getElementById('timer-digits');

    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    startBtn.classList.remove('active-timer');
    digits.classList.remove('running');

    if (timerState.sessionStartTime && state.activeSubjectId) {
        const sessionSeconds = Math.floor((Date.now() - timerState.sessionStartTime) / 1000);
        if (sessionSeconds > 0) {
            const today = getTodayStr();
            const existing = state.sessions.find(s => s.subjectId === state.activeSubjectId && s.date === today);
            if (existing) {
                existing.seconds += sessionSeconds;
            } else {
                state.sessions.push({
                    subjectId: state.activeSubjectId,
                    date: today,
                    seconds: sessionSeconds,
                });
            }
            saveState();
            updateTodaySummary();
        }
    }
    timerState.sessionStartTime = null;
}

function resetTimer() {
    const wasRunning = timerState.running;
    if (wasRunning) stopTimer();

    timerState.elapsed = 0;
    timerState.remaining = state.timerMode === 'pomodoro' ? state.pomodoro.focus * 60 : 0;
    timerState.pomoPhase = 'focus';
    timerState.pomoSession = 1;

    updateTimerDisplay(state.timerMode === 'pomodoro' ? timerState.remaining : 0);
    updateRingProgress(0, 1);
    updatePomodoroModeLabel();
}

function toggleTimerMode() {
    if (timerState.running) return;

    const pomoSettings = document.getElementById('pomodoro-settings');
    if (state.timerMode === 'stopwatch') {
        state.timerMode = 'pomodoro';
        pomoSettings.classList.remove('hidden');
        timerState.remaining = state.pomodoro.focus * 60;
        updateTimerDisplay(timerState.remaining);
    } else {
        state.timerMode = 'stopwatch';
        pomoSettings.classList.add('hidden');
        timerState.elapsed = 0;
        updateTimerDisplay(0);
    }
    updatePomodoroModeLabel();
    updateRingProgress(0, 1);
    saveState();
}

function updatePomodoroModeLabel() {
    const label = document.getElementById('timer-mode-label');
    if (state.timerMode === 'stopwatch') {
        label.textContent = 'STOPWATCH';
        label.style.color = 'var(--accent-purple)';
    } else {
        label.textContent = timerState.pomoPhase === 'focus' ? 'FOCUS' : 'BREAK';
        label.style.color = timerState.pomoPhase === 'focus' ? 'var(--accent-purple)' : 'var(--accent-cyan)';
    }
}

function handlePomodoroPhaseEnd() {
    stopTimer();
    if (timerState.pomoPhase === 'focus') {
        timerState.pomoPhase = 'break';
        timerState.remaining = state.pomodoro.break * 60;
        sendNotification('Break Time!', `Take a ${state.pomodoro.break} minute break.`);
    } else {
        timerState.pomoSession++;
        if (timerState.pomoSession > state.pomodoro.sessions) {
            sendNotification('Well Done!', `You completed ${state.pomodoro.sessions} sessions!`);
            timerState.pomoSession = 1;
        } else {
            sendNotification('Focus Time!', `Session ${timerState.pomoSession} of ${state.pomodoro.sessions}`);
        }
        timerState.pomoPhase = 'focus';
        timerState.remaining = state.pomodoro.focus * 60;
    }
    updateTimerDisplay(timerState.remaining);
    updatePomodoroModeLabel();
    updateRingProgress(0, 1);

    setTimeout(() => startTimer(), 1500);
}

function adjustPomodoro(field, delta) {
    if (timerState.running) return;
    const val = state.pomodoro[field] + delta;
    if (field === 'focus') state.pomodoro.focus = Math.max(5, Math.min(120, val));
    if (field === 'break') state.pomodoro.break = Math.max(1, Math.min(30, val));
    if (field === 'sessions') state.pomodoro.sessions = Math.max(1, Math.min(10, val));

    document.getElementById(`pomo-${field}-val`).textContent = state.pomodoro[field];

    if (state.timerMode === 'pomodoro' && !timerState.running) {
        timerState.remaining = state.pomodoro.focus * 60;
        updateTimerDisplay(timerState.remaining);
    }
    saveState();
}

function updateTimerDisplay(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    document.getElementById('timer-digits').textContent =
        `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function updateRingProgress(current, total) {
    const ring = document.getElementById('ring-progress');
    const circumference = 2 * Math.PI * 108;
    const progress = total > 0 ? Math.min(current / total, 1) : 0;
    ring.style.strokeDashoffset = circumference * (1 - progress);
}

function addTask() {
    const input = document.getElementById('new-task-input');
    const subjectSelect = document.getElementById('new-task-subject');
    const text = input.value.trim();

    if (!text) return;
    if (!subjectSelect.value || state.subjects.length === 0) {
        shakeElement(subjectSelect);
        return;
    }

    state.todos.push({
        id: generateId(),
        text,
        subjectId: subjectSelect.value,
        completed: false,
        createdAt: new Date().toISOString(),
    });

    input.value = '';
    saveState();
    renderTodos();
    updateTodaySummary();
}

function toggleTodo(id) {
    const todo = state.todos.find(t => t.id === id);
    if (todo) {
        todo.completed = !todo.completed;
        saveState();
        renderTodos();
        updateTodaySummary();
    }
}

function deleteTodo(id) {
    state.todos = state.todos.filter(t => t.id !== id);
    saveState();
    renderTodos();
    updateTodaySummary();
}

function renderTodos() {
    const filter = document.getElementById('todo-filter-subject').value;
    let todos = [...state.todos];

    if (filter !== 'all') {
        todos = todos.filter(t => t.subjectId === filter);
    }

    todos.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return new Date(b.createdAt) - new Date(a.createdAt);
    });

    const list = document.getElementById('todo-list');
    const empty = document.getElementById('todo-empty');

    if (todos.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
    } else {
        empty.classList.add('hidden');
        list.innerHTML = todos.map(t => {
            const subject = state.subjects.find(s => s.id === t.subjectId);
            const color = subject ? subject.color : '#666';
            const name = subject ? escapeHtml(subject.name) : 'Unknown';
            return `
                <div class="todo-item ${t.completed ? 'completed' : ''}">
                    <div class="todo-color-bar" style="background:${color}"></div>
                    <input type="checkbox" class="todo-check" ${t.completed ? 'checked' : ''}
                           onchange="toggleTodo('${t.id}')" style="border-color:${color}">
                    <span class="todo-text">${escapeHtml(t.text)}</span>
                    <span class="todo-subject-tag" style="background:${hexToRgba(color, 0.15)};color:${color}">${name}</span>
                    <button class="todo-delete" onclick="deleteTodo('${t.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            `;
        }).join('');
    }

    const total = state.todos.length;
    const done = state.todos.filter(t => t.completed).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    document.getElementById('task-progress-fill').style.width = `${pct}%`;
    document.getElementById('task-progress-text').textContent = `${pct}% Complete`;
}

let selectedDdayColor = '#8b5cf6';

function selectDdayColor(el) {
    el.parentElement.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    el.classList.add('active');
    selectedDdayColor = el.dataset.color;
}

function openDdayModal() {
    document.getElementById('dday-name-input').value = '';
    document.getElementById('dday-date-input').value = '';
    selectedDdayColor = '#8b5cf6';
    const dots = document.querySelectorAll('#dday-modal .color-dot');
    dots.forEach((d, i) => d.classList.toggle('active', i === 0));
    document.getElementById('dday-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('dday-name-input').focus(), 100);
}

function closeDdayModal() {
    document.getElementById('dday-modal').classList.add('hidden');
}

function saveDday() {
    const name = document.getElementById('dday-name-input').value.trim();
    const date = document.getElementById('dday-date-input').value;
    if (!name || !date) return;

    const parsed = parseLocalDate(date);
    if (isNaN(parsed.getTime())) return;

    state.ddays.push({
        id: generateId(),
        name,
        date,
        color: selectedDdayColor,
    });

    saveState();
    renderDdays();
    closeDdayModal();
}

function deleteDday(id) {
    state.ddays = state.ddays.filter(d => d.id !== id);
    saveState();
    renderDdays();
}

function renderDdays() {
    const list = document.getElementById('dday-list');
    const empty = document.getElementById('dday-empty');

    if (state.ddays.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');

    const sorted = [...state.ddays].sort((a, b) => new Date(a.date) - new Date(b.date));

    list.innerHTML = sorted.map(d => {
        const diff = daysDiff(d.date);
        const targetDate = parseLocalDate(d.date);
        const isValidDate = !isNaN(targetDate.getTime()) && !isNaN(diff);
        const isPast = isValidDate && diff < 0;
        const isToday = isValidDate && diff === 0;
        const isUrgent = isValidDate && diff >= 0 && diff <= 7;
        const displayDate = isValidDate
            ? targetDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
            : d.date;

        let countdownText, countdownLabel;
        if (!isValidDate) {
            countdownText = '—';
            countdownLabel = 'Invalid date';
        } else if (isToday) {
            countdownText = 'D-Day';
            countdownLabel = "It's today!";
        } else if (isPast) {
            countdownText = `D+${Math.abs(diff)}`;
            countdownLabel = `${Math.abs(diff)} day${Math.abs(diff) !== 1 ? 's' : ''} ago`;
        } else {
            countdownText = `D-${diff}`;
            countdownLabel = `${diff} day${diff !== 1 ? 's' : ''} remaining`;
        }

        return `
            <div class="dday-card ${isUrgent ? 'urgent' : ''}" style="background:${d.color}">
                <div class="dday-card-header">
                    <span class="dday-card-name">${escapeHtml(d.name)}</span>
                    <button class="dday-card-delete" onclick="deleteDday('${d.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div class="dday-countdown">${countdownText}</div>
                <div class="dday-countdown-label">${countdownLabel}</div>
                <div class="dday-date">${displayDate}</div>
            </div>
        `;
    }).join('');
}

function updateTodaySummary() {
    const today = getTodayStr();

    const todaySessions = state.sessions.filter(s => s.date === today);
    const totalSeconds = todaySessions.reduce((sum, s) => sum + s.seconds, 0);
    document.getElementById('today-total').textContent = formatDuration(totalSeconds);

    const totalTasks = state.todos.length;
    const doneTasks = state.todos.filter(t => t.completed).length;
    document.getElementById('today-tasks').textContent = `${doneTasks}/${totalTasks}`;

    let streak = 0;
    const d = new Date();
    while (true) {
        const dateStr = formatDateStr(d);
        const hasSessions = state.sessions.some(s => s.date === dateStr && s.seconds > 0);
        if (hasSessions || dateStr === today) {
            if (hasSessions) streak++;
            d.setDate(d.getDate() - 1);
        } else {
            break;
        }
    }
    document.getElementById('today-streak').textContent = `${streak} day${streak !== 1 ? 's' : ''}`;
}

let statPeriod = 'week';

function switchStatPeriod(period) {
    statPeriod = period;
    document.querySelectorAll('.period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === period));
    renderStats();
}

function renderStats() {
    const days = statPeriod === 'week' ? 7 : 30;
    const data = getStudyData(days);

    const totalSeconds = data.reduce((sum, d) => sum + d.seconds, 0);
    const activeDays = data.filter(d => d.seconds > 0).length;
    const avg = activeDays > 0 ? totalSeconds / activeDays : 0;
    const best = Math.max(...data.map(d => d.seconds), 0);

    document.getElementById('stat-total').textContent = formatDuration(totalSeconds);
    document.getElementById('stat-avg').textContent = formatDuration(Math.round(avg));
    document.getElementById('stat-best').textContent = formatDuration(best);

    drawBarChart(data);
    drawDonutChart();
}

function getStudyData(days) {
    const result = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = formatDateStr(d);
        const daySessions = state.sessions.filter(s => s.date === dateStr);
        const seconds = daySessions.reduce((sum, s) => sum + s.seconds, 0);
        result.push({
            date: dateStr,
            label: d.toLocaleDateString('en-US', { weekday: 'short' }),
            dayNum: d.getDate(),
            seconds,
        });
    }
    return result;
}

function drawBarChart(data) {
    const canvas = document.getElementById('bar-chart');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = 220 * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvas.offsetWidth, 220);

    const w = canvas.offsetWidth;
    const h = 220;
    const padding = { top: 10, bottom: 40, left: 10, right: 10 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    const maxVal = Math.max(...data.map(d => d.seconds), 1);
    const barWidth = Math.min(chartW / data.length * 0.6, 32);
    const gap = (chartW - barWidth * data.length) / (data.length);

    data.forEach((d, i) => {
        const x = padding.left + i * (barWidth + gap) + gap / 2;
        const barH = (d.seconds / maxVal) * chartH;
        const y = padding.top + chartH - barH;

        const gradient = ctx.createLinearGradient(x, y, x, y + barH);
        gradient.addColorStop(0, '#8b5cf6');
        gradient.addColorStop(1, '#6d28d9');
        ctx.fillStyle = d.seconds > 0 ? gradient : 'rgba(255,255,255,0.05)';
        ctx.beginPath();
        roundedRect(ctx, x, d.seconds > 0 ? y : padding.top + chartH - 4, barWidth, d.seconds > 0 ? barH : 4, 4);
        ctx.fill();

        ctx.fillStyle = 'rgba(240,240,245,0.4)';
        ctx.font = '500 10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(
            statPeriod === 'week' ? d.label : d.dayNum,
            x + barWidth / 2,
            h - padding.bottom + 18
        );

        if (d.seconds > 0) {
            ctx.fillStyle = 'rgba(240,240,245,0.6)';
            ctx.font = '600 9px "JetBrains Mono"';
            ctx.fillText(formatDurationShort(d.seconds), x + barWidth / 2, y - 6);
        }
    });
}

function drawDonutChart() {
    const canvas = document.getElementById('donut-chart');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = 140 * dpr;
    canvas.height = 140 * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, 140, 140);

    const cx = 70, cy = 70, r = 55, lineWidth = 16;

    const subjectTime = {};
    state.sessions.forEach(s => {
        if (!subjectTime[s.subjectId]) subjectTime[s.subjectId] = 0;
        subjectTime[s.subjectId] += s.seconds;
    });

    const entries = Object.entries(subjectTime)
        .map(([id, seconds]) => {
            const subject = state.subjects.find(s => s.id === id);
            return { id, seconds, color: subject ? subject.color : '#666', name: subject ? subject.name : 'Unknown' };
        })
        .filter(e => e.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds);

    const total = entries.reduce((sum, e) => sum + e.seconds, 0);

    if (total === 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = lineWidth;
        ctx.stroke();

        ctx.fillStyle = 'rgba(240,240,245,0.3)';
        ctx.font = '500 12px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('No data', cx, cy + 4);
    } else {
        let startAngle = -Math.PI / 2;
        entries.forEach(e => {
            const sliceAngle = (e.seconds / total) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(cx, cy, r, startAngle, startAngle + sliceAngle);
            ctx.strokeStyle = e.color;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.stroke();
            startAngle += sliceAngle + 0.04;
        });

        ctx.fillStyle = 'rgba(240,240,245,0.9)';
        ctx.font = '700 14px "JetBrains Mono"';
        ctx.textAlign = 'center';
        ctx.fillText(formatDurationShort(total), cx, cy + 1);
        ctx.fillStyle = 'rgba(240,240,245,0.4)';
        ctx.font = '500 9px Inter';
        ctx.fillText('total', cx, cy + 16);
    }

    const legend = document.getElementById('donut-legend');
    if (entries.length === 0) {
        legend.innerHTML = '<div style="color:var(--text-tertiary);font-size:0.8rem">Study some subjects to see data here.</div>';
    } else {
        legend.innerHTML = entries.map(e => `
            <div class="legend-item">
                <span class="legend-dot" style="background:${e.color}"></span>
                <span class="legend-label">${escapeHtml(e.name)}</span>
                <span class="legend-value">${formatDurationShort(e.seconds)}</span>
            </div>
        `).join('');
    }
}

function renderHeatmap() {
    const container = document.getElementById('heatmap-container');
    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    const totalDays = 84;
    const now = new Date();

    let html = dayLabels.map(d => `<div class="heatmap-day-label">${d}</div>`).join('');

    for (let i = totalDays - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = formatDateStr(d);
        const daySessions = state.sessions.filter(s => s.date === dateStr);
        const seconds = daySessions.reduce((sum, s) => sum + s.seconds, 0);
        const minutes = Math.floor(seconds / 60);

        let level = 0;
        if (minutes > 0) level = 1;
        if (minutes >= 30) level = 2;
        if (minutes >= 60) level = 3;
        if (minutes >= 120) level = 4;

        const dateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        html += `<div class="heatmap-cell" data-level="${level}" title="${dateFormatted}: ${formatDuration(seconds)}"></div>`;
    }

    container.innerHTML = html;
}

function toggleSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.toggle('hidden');

    document.getElementById('setting-notifications').checked = state.settings.notifications;
    document.getElementById('setting-sound').checked = state.settings.sound;
}

function saveSetting(key, value) {
    state.settings[key] = value;
    saveState();

    if (key === 'notifications' && value && 'Notification' in window) {
        Notification.requestPermission();
    }
}

function clearAllData() {
    if (!confirm('Are you sure you want to clear ALL data? This cannot be undone.')) return;
    if (!confirm('This will delete all subjects, tasks, timer sessions, and D-Day events. Continue?')) return;

    localStorage.removeItem('goal-chaser-state');
    state = {
        subjects: [],
        todos: [],
        ddays: [],
        sessions: [],
        activeSubjectId: null,
        timerMode: 'stopwatch',
        pomodoro: { focus: 25, break: 5, sessions: 4 },
        settings: { notifications: false, sound: true },
    };

    if (timerState.running) {
        clearInterval(timerState.intervalId);
        timerState.running = false;
    }
    timerState.elapsed = 0;
    timerState.remaining = 0;

    renderSubjectChips();
    updateSubjectSelects();
    renderTodos();
    renderDdays();
    updateTodaySummary();
    renderStats();
    renderHeatmap();
    updateTimerDisplay(0);
    updateRingProgress(0, 1);
    toggleSettingsModal();
}

function sendNotification(title, body) {
    if (state.settings.notifications && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '🎯' });
    }

    if (state.settings.sound) {
        document.getElementById('timer-start-btn').style.boxShadow = '0 0 40px rgba(139,92,246,0.8)';
        setTimeout(() => {
            document.getElementById('timer-start-btn').style.boxShadow = '';
        }, 500);
    }
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function getTodayStr() {
    return formatDateStr(new Date());
}

function formatDateStr(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n) {
    return n.toString().padStart(2, '0');
}

function formatDuration(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return `${h}h ${m}m`;
}

function formatDurationShort(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    if (h > 0) return `${h}h${m}m`;
    return `${m}m`;
}

function parseLocalDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return new Date(NaN);
    const parts = dateStr.split('-');
    if (parts.length !== 3) return new Date(NaN);
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return new Date(NaN);
    return new Date(y, m, d);
}

function daysDiff(dateStr) {
    const target = parseLocalDate(dateStr);
    if (isNaN(target.getTime())) return NaN;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function shakeElement(el) {
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = 'shake 0.4s ease';
    setTimeout(() => { el.style.animation = ''; }, 400);
}

function roundedRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-6px); }
        40% { transform: translateX(6px); }
        60% { transform: translateX(-4px); }
        80% { transform: translateX(4px); }
    }
`;
document.head.appendChild(shakeStyle);

const socket = io();

let currentUser = null;
let currentChatFriend = null;
let currentGroupId = null;
let groupStudyActive = false;

document.addEventListener('DOMContentLoaded', () => {
    showAuthScreen();
});

function initSocket() {
    socket.emit('auth', currentUser.id);

    socket.on('friend_request', (data) => {
        loadFriendRequests();
    });

    socket.on('new_message', (data) => {
        if (currentChatFriend && currentChatFriend.id === data.senderId) {
            appendMessage(data);
        }
        loadFriends();
    });

    socket.on('study_started', (data) => {
        if (currentGroupId === data.groupId) {
            loadGroupMembers();
        }
    });

    socket.on('study_updated', (data) => {
        if (currentGroupId === data.groupId) {
            renderGroupStudyTimes(data.studyTimes);
        }
    });
}

function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-header').classList.add('hidden');
    document.getElementById('main-content').classList.add('hidden');
    document.getElementById('bottom-nav').classList.add('hidden');
}

function showMainApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-header').classList.remove('hidden');
    document.getElementById('main-content').classList.remove('hidden');
    document.getElementById('bottom-nav').classList.remove('hidden');
    document.getElementById('app-header').classList.remove('hidden');

    const avatarHtml = currentUser.avatar ? `<img src="${currentUser.avatar}" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:8px;">` : '';
    document.getElementById('app-title').innerHTML = `Goal Chaser${currentUser ? ' - ' + avatarHtml + currentUser.displayName : ''}`;
}

function logout() {
    if (!confirm('Logout and switch account?')) return;
    
    currentUser = null;
    localStorage.removeItem('goalchaser_user');
    
    if (socket) {
        socket.disconnect();
    }
    
    showAuthScreen();
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('reg-username').value = '';
    document.getElementById('reg-displayname').value = '';
    document.getElementById('reg-password').value = '';
}

function showRegister() {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('auth-error').classList.add('hidden');
}

function showLogin() {
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('auth-error').classList.add('hidden');
}

function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg;
    el.classList.remove('hidden');
}

async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
        showAuthError('Please fill all fields');
        return;
    }

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (!res.ok) {
            showAuthError(data.error);
            return;
        }

        currentUser = data.user;
        localStorage.setItem('goalchaser_user', JSON.stringify(currentUser));
        showMainApp();
        initSocket();
        loadFriends();
        loadGroups();
    } catch (err) {
        showAuthError('Connection error');
    }
}

async function register() {
    const username = document.getElementById('reg-username').value.trim();
    const displayName = document.getElementById('reg-displayname').value.trim() || username;
    const password = document.getElementById('reg-password').value;

    if (!username || !password) {
        showAuthError('Please fill all fields');
        return;
    }

    if (username.length < 3) {
        showAuthError('Username must be at least 3 characters');
        return;
    }

    if (password.length < 4) {
        showAuthError('Password must be at least 4 characters');
        return;
    }

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, displayName })
        });
        const data = await res.json();

        if (!res.ok) {
            showAuthError(data.error);
            return;
        }

        const loginRes = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const loginData = await loginRes.json();

        if (!loginRes.ok) {
            showAuthError('Registration successful but login failed');
            return;
        }

        currentUser = loginData.user;
        localStorage.setItem('goalchaser_user', JSON.stringify(currentUser));
        showMainApp();
        initSocket();
    } catch (err) {
        showAuthError('Connection error');
    }
}

function getAvatarHTML(avatar, name, size = 'small') {
    if (avatar) {
        const sizeClass = size === 'large' ? 'avatar-large' : 'avatar-small';
        return `<div class="avatar-img ${sizeClass}"><img src="${avatar}" alt="${name}"></div>`;
    }
    return '';
}

function getAvatarInitials(avatar, name) {
    if (avatar) return '';
    return getInitials(name);
}

async function loadFriends() {
    if (!currentUser) return;

    try {
        const res = await fetch(`/api/friends/${currentUser.id}`);
        const friends = await res.json();

        const list = document.getElementById('friends-list');
        const empty = document.getElementById('friends-empty');

        if (friends.length === 0) {
            list.innerHTML = '';
            empty.classList.remove('hidden');
        } else {
            empty.classList.add('hidden');
            list.innerHTML = friends.map(f => {
                const avatarHtml = getAvatarHTML(f.avatar, f.displayName || f.username);
                const initials = getAvatarInitials(f.avatar, f.displayName || f.username);
                return `
                <div class="friend-card">
                    <div class="friend-avatar" style="background: var(--accent-purple)">
                        ${avatarHtml || initials}
                    </div>
                    <div class="friend-info">
                        <span class="friend-name">${escapeHtml(f.displayName || f.username)}</span>
                        <span class="friend-username">@${escapeHtml(f.username)}</span>
                    </div>
                    <div class="friend-actions">
                        <button class="icon-btn" onclick="viewProfile(${f.id})" title="View Profile">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="8" r="2"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>
                        </button>
                        <button class="icon-btn" onclick="openChat(${f.id}, '${escapeHtml(f.displayName || f.username)}')" title="Chat">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        </button>
                        <button class="icon-btn danger" onclick="removeFriend(${f.id})" title="Remove">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>
            `}).join('');
        }

        loadFriendRequests();
        loadRecommendations();
    } catch (err) {
        console.error('Failed to load friends:', err);
    }
}

async function loadRecommendations() {
    if (!currentUser) return;

    try {
        const res = await fetch(`/api/friends/available/${currentUser.id}`);
        const users = await res.json();

        const section = document.getElementById('recommendations-section');
        const list = document.getElementById('recommendations-list');

        if (users.length === 0) {
            section.classList.add('hidden');
        } else {
            section.classList.remove('hidden');
            list.innerHTML = users.map(u => {
                const avatarHtml = getAvatarHTML(u.avatar, u.displayName || u.username);
                const initials = getAvatarInitials(u.avatar, u.displayName || u.username);
                return `
                <div class="recommendation-item">
                    <div class="recommendation-avatar" style="${avatarHtml ? 'padding:0' : ''}">
                        ${avatarHtml || initials}
                    </div>
                    <div class="recommendation-info">
                        <span class="recommendation-name">${escapeHtml(u.displayName || u.username)}</span>
                        <span class="recommendation-username">@${escapeHtml(u.username)}</span>
                    </div>
                    <button class="btn-accent-small" onclick="addFriend(${u.id})">Add +</button>
                </div>
            `}).join('');
        }
    } catch (err) {
        console.error('Failed to load recommendations:', err);
    }
}

async function loadFriendRequests() {
    if (!currentUser) return;

    try {
        const res = await fetch(`/api/friends/requests/${currentUser.id}`);
        const requests = await res.json();

        const section = document.getElementById('friend-requests');
        const list = document.getElementById('friend-requests-list');

        if (requests.length === 0) {
            section.classList.add('hidden');
        } else {
            section.classList.remove('hidden');
            list.innerHTML = requests.map(r => `
                <div class="friend-request-item">
                    <span>${escapeHtml(r.displayName || r.username)}</span>
                    <div>
                        <button class="btn-accent-small" onclick="acceptFriend(${r.id})">Accept</button>
                    </div>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error('Failed to load requests:', err);
    }
}

function openAddFriendModal() {
    document.getElementById('search-users-input').value = '';
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('add-friend-modal').classList.remove('hidden');
    loadAllAddableUsers();
    setTimeout(() => document.getElementById('search-users-input').focus(), 100);
}

async function loadAllAddableUsers() {
    if (!currentUser) return;

    try {
        const res = await fetch(`/api/friends/available/${currentUser.id}`);
        const users = await res.json();

        const results = document.getElementById('search-results');
        if (users.length === 0) {
            results.innerHTML = '<div class="no-results">No users available to add</div>';
        } else {
            results.innerHTML = users.map(u => {
                const avatarHtml = getAvatarHTML(u.avatar, u.displayName || u.username);
                const initials = getAvatarInitials(u.avatar, u.displayName || u.username);
                return `
                <div class="search-result-item">
                    <div class="search-result-avatar" style="${avatarHtml ? 'padding:0' : ''}">
                        ${avatarHtml || initials}
                    </div>
                    <div class="search-result-info">
                        <span class="search-result-name">${escapeHtml(u.displayName || u.username)}</span>
                        <span class="search-result-username">@${escapeHtml(u.username)}</span>
                    </div>
                    <button class="btn-accent-small" onclick="addFriend(${u.id})">Add +</button>
                </div>
            `}).join('');
        }
    } catch (err) {
        console.error('Failed to load users:', err);
    }
}

function closeAddFriendModal() {
    document.getElementById('add-friend-modal').classList.add('hidden');
}

let allAddableUsers = [];

async function loadAllAddableUsers() {
    if (!currentUser) return;

    try {
        const res = await fetch(`/api/friends/available/${currentUser.id}`);
        allAddableUsers = await res.json();
        renderAddableUsers(allAddableUsers);
    } catch (err) {
        console.error('Failed to load users:', err);
    }
}

function renderAddableUsers(users) {
    const results = document.getElementById('search-results');
    if (users.length === 0) {
        results.innerHTML = '<div class="no-results">No users found</div>';
    } else {
        results.innerHTML = users.map(u => {
            const avatarHtml = getAvatarHTML(u.avatar, u.displayName || u.username);
            const initials = getAvatarInitials(u.avatar, u.displayName || u.username);
            return `
            <div class="search-result-item">
                <div class="search-result-avatar" style="${avatarHtml ? 'padding:0' : ''}">
                    ${avatarHtml || initials}
                </div>
                <div class="search-result-info">
                    <span class="search-result-name">${escapeHtml(u.displayName || u.username)}</span>
                    <span class="search-result-username">@${escapeHtml(u.username)}</span>
                </div>
                <button class="btn-accent-small" onclick="addFriend(${u.id})">Add +</button>
            </div>
        `}).join('');
    }
}

function searchUsers() {
    const query = document.getElementById('search-users-input').value.trim().toLowerCase();
    
    if (query.length === 0) {
        renderAddableUsers(allAddableUsers);
        return;
    }
    
    const filtered = allAddableUsers.filter(u => {
        const name = (u.displayName || u.username || '').toLowerCase();
        const username = (u.username || '').toLowerCase();
        return name.includes(query) || username.includes(query);
    });
    
    if (filtered.length === 0 && query.length >= 1) {
        document.getElementById('search-results').innerHTML = '<div class="no-results">No users found for "' + escapeHtml(query) + '"</div>';
    } else {
        renderAddableUsers(filtered);
    }
}

async function addFriend(friendId) {
    try {
        const res = await fetch('/api/friends/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id, friendId })
        });
        const data = await res.json();
        
        if (data.success) {
            alert('Friend request sent!');
            closeAddFriendModal();
            loadFriends();
            loadRecommendations();
        } else {
            alert(data.error || 'Failed to add friend');
        }
    } catch (err) {
        alert('Failed to add friend');
    }
}

async function acceptFriend(friendId) {
    try {
        await fetch('/api/friends/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id, friendId })
        });
        loadFriendRequests();
        loadFriends();
    } catch (err) {
        alert('Failed to accept friend');
    }
}

async function removeFriend(friendId) {
    if (!confirm('Remove this friend?')) return;

    try {
        await fetch('/api/friends/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id, friendId })
        });
        loadFriends();
    } catch (err) {
        alert('Failed to remove friend');
    }
}

async function openInviteModal() {
    document.getElementById('invite-error').classList.add('hidden');
    document.getElementById('invite-code-display').textContent = 'Generating...';
    document.getElementById('invite-modal').classList.remove('hidden');

    try {
        const res = await fetch('/api/invite/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id })
        });
        const data = await res.json();
        
        if (data.success) {
            const baseUrl = window.location.origin;
            document.getElementById('invite-code-display').textContent = `${baseUrl}/invite/${data.inviteCode}`;
        }
    } catch (err) {
        document.getElementById('invite-code-display').textContent = 'Error generating link';
    }
}

function closeInviteModal() {
    document.getElementById('invite-modal').classList.add('hidden');
    document.getElementById('invite-link-input').value = '';
    document.getElementById('invite-error').classList.add('hidden');
}

function copyInviteLink() {
    const code = document.getElementById('invite-code-display').textContent;
    navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Invite Link', 2000);
    });
}

async function acceptInviteLink() {
    const code = document.getElementById('invite-link-input').value.trim();
    const errorEl = document.getElementById('invite-error');
    
    if (!code) {
        errorEl.textContent = 'Please enter an invite code';
        errorEl.classList.remove('hidden');
        return;
    }

    try {
        const res = await fetch(`/api/user/by-invite/${encodeURIComponent(code)}`);
        const data = await res.json();

        if (data.success) {
            if (data.user.id === currentUser.id) {
                errorEl.textContent = "You can't add yourself!";
                errorEl.classList.remove('hidden');
                return;
            }
            await addFriend(data.user.id);
            closeInviteModal();
            alert(`Added ${data.user.displayName || data.user.username} as friend!`);
        } else {
            errorEl.textContent = data.error || 'Invalid invite code';
            errorEl.classList.remove('hidden');
        }
    } catch (err) {
        errorEl.textContent = 'Failed to connect. Please check the code.';
        errorEl.classList.remove('hidden');
    }
}

function getInitials(name) {
    return name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';
}

async function viewProfile(userId) {
    try {
        const res = await fetch(`/api/user/${userId}`);
        const user = await res.json();

        document.getElementById('view-profile-avatar').textContent = getInitials(user.displayName || user.username);
        document.getElementById('view-profile-name').textContent = user.displayName || user.username;
        document.getElementById('view-profile-username').textContent = '@' + user.username;
        document.getElementById('view-profile-bio').textContent = user.bio || 'No bio yet';

        document.getElementById('view-profile-chat-btn').onclick = () => {
            closeViewProfileModal();
            openChat(user.id, user.displayName || user.username);
        };

        document.getElementById('view-profile-modal').classList.remove('hidden');
    } catch (err) {
        alert('Failed to load profile');
    }
}

function closeViewProfileModal() {
    document.getElementById('view-profile-modal').classList.add('hidden');
}

function openProfileModal() {
    document.getElementById('profile-displayname').value = currentUser.displayName || '';
    document.getElementById('profile-bio').value = currentUser.bio || '';
    
    const avatarPreview = document.getElementById('avatar-preview-large');
    if (currentUser.avatar) {
        avatarPreview.innerHTML = `<img src="${currentUser.avatar}" alt="Avatar">`;
    } else {
        avatarPreview.textContent = getInitials(currentUser.displayName || currentUser.username);
    }
    
    document.getElementById('profile-modal').classList.remove('hidden');
    toggleSettingsModal();
}

function closeProfileModal() {
    document.getElementById('profile-modal').classList.add('hidden');
}

async function saveProfile() {
    const displayName = document.getElementById('profile-displayname').value.trim();
    const bio = document.getElementById('profile-bio').value.trim();
    const avatarInput = document.getElementById('avatar-input');
    const avatar = currentUser.avatar || '';

    try {
        await fetch('/api/user/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id, displayName, bio })
        });

        if (avatarInput.files.length > 0) {
            await uploadAvatar();
        } else {
            currentUser.displayName = displayName;
            currentUser.bio = bio;
            localStorage.setItem('goalchaser_user', JSON.stringify(currentUser));

            document.getElementById('app-title').textContent = `Goal Chaser - ${displayName}`;
            closeProfileModal();
        }
    } catch (err) {
        alert('Failed to save profile');
    }
}

async function uploadAvatar() {
    const fileInput = document.getElementById('avatar-input');
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        const base64 = e.target.result;
        
        try {
            await fetch('/api/user/avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUser.id, avatar: base64 })
            });

            currentUser.avatar = base64;
            localStorage.setItem('goalchaser_user', JSON.stringify(currentUser));
            
            document.getElementById('app-title').textContent = `Goal Chaser - ${currentUser.displayName}`;
            closeProfileModal();
            showMainApp();
        } catch (err) {
            alert('Failed to upload avatar');
        }
    };
    reader.readAsDataURL(file);
}

function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('avatar-preview-large').innerHTML = `<img src="${e.target.result}" alt="Avatar">`;
        };
        reader.readAsDataURL(file);
    }
}

async function openChat(friendId, friendName) {
    currentChatFriend = { id: friendId, name: friendName };
    document.getElementById('chat-with-name').textContent = friendName;
    document.getElementById('chat-modal').classList.remove('hidden');

    try {
        const res = await fetch(`/api/messages/${currentUser.id}/${friendId}`);
        const messages = await res.json();

        const container = document.getElementById('chat-messages');
        container.innerHTML = messages.map(m => `
            <div class="chat-message ${m.senderId === currentUser.id ? 'sent' : 'received'}">
                <span class="chat-message-text">${escapeHtml(m.message)}</span>
                <span class="chat-message-time">${new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
        `).join('');

        container.scrollTop = container.scrollHeight;
    } catch (err) {
        console.error('Failed to load messages:', err);
    }
}

function closeChatModal() {
    document.getElementById('chat-modal').classList.add('hidden');
    currentChatFriend = null;
}

async function sendMessage() {
    if (!currentChatFriend) return;

    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message) return;

    try {
        await fetch('/api/messages/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                senderId: currentUser.id,
                receiverId: currentChatFriend.id,
                message
            })
        });

        appendMessage({ senderId: currentUser.id, message, createdAt: new Date().toISOString() });
        input.value = '';
    } catch (err) {
        alert('Failed to send message');
    }
}

function appendMessage(data) {
    const container = document.getElementById('chat-messages');
    const isSent = data.senderId === currentUser.id;

    container.innerHTML += `
        <div class="chat-message ${isSent ? 'sent' : 'received'}">
            <span class="chat-message-text">${escapeHtml(data.message)}</span>
            <span class="chat-message-time">${new Date(data.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
    `;
    container.scrollTop = container.scrollHeight;
}

async function loadGroups() {
    if (!currentUser) return;

    try {
        const res = await fetch(`/api/groups/${currentUser.id}`);
        const groups = await res.json();

        const list = document.getElementById('groups-list');
        const empty = document.getElementById('groups-empty');

        if (groups.length === 0) {
            list.innerHTML = '';
            empty.classList.remove('hidden');
        } else {
            empty.classList.add('hidden');
            list.innerHTML = groups.map(g => `
                <div class="group-card" onclick="openGroupDetail(${g.id}, '${escapeHtml(g.name)}')">
                    <div class="group-icon" style="background: var(--accent-cyan)">${getInitials(g.name)}</div>
                    <div class="group-info">
                        <span class="group-name">${escapeHtml(g.name)}</span>
                        <span class="group-members-count">Tap to view members</span>
                    </div>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error('Failed to load groups:', err);
    }
}

function openCreateGroupModal() {
    document.getElementById('group-name-input').value = '';
    document.getElementById('create-group-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('group-name-input').focus(), 100);
}

function closeCreateGroupModal() {
    document.getElementById('create-group-modal').classList.add('hidden');
}

async function createGroup() {
    const name = document.getElementById('group-name-input').value.trim();
    if (!name) return;

    try {
        await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, userId: currentUser.id })
        });

        closeCreateGroupModal();
        loadGroups();
    } catch (err) {
        alert('Failed to create group');
    }
}

let currentGroupName = null;

async function openGroupDetail(groupId, groupName) {
    currentGroupId = groupId;
    currentGroupName = groupName;
    document.getElementById('group-detail-name').textContent = groupName;
    document.getElementById('group-detail-modal').classList.remove('hidden');

    socket.emit('join_group_room', groupId);
    loadGroupMembers();
    fetchGroupStudyTimes();
}

function closeGroupDetailModal() {
    if (currentGroupId) {
        socket.emit('leave_group_room', currentGroupId);
    }
    currentGroupId = null;
    groupStudyActive = false;
    document.getElementById('group-study-btn').textContent = 'Start Study Session';
    document.getElementById('group-study-status').textContent = 'Not studying';
    document.getElementById('group-detail-modal').classList.add('hidden');
}

async function loadGroupMembers() {
    if (!currentGroupId) return;

    try {
        const res = await fetch(`/api/groups/${currentGroupId}/members`);
        const members = await res.json();

        document.getElementById('group-members-list').innerHTML = members.map(m => `
            <div class="group-member-item">
                <div class="member-avatar" style="background: var(--accent-purple)">${getInitials(m.displayName || m.username)}</div>
                <span class="member-name">${escapeHtml(m.displayName || m.username)}</span>
            </div>
        `).join('');
    } catch (err) {
        console.error('Failed to load members:', err);
    }
}

async function fetchGroupStudyTimes() {
    if (!currentGroupId) return;

    try {
        const res = await fetch(`/api/groups/${currentGroupId}/study-time`);
        const studyTimes = await res.json();
        renderGroupStudyTimes(studyTimes);
    } catch (err) {
        console.error('Failed to load study times:', err);
    }
}

function renderGroupStudyTimes(studyTimes) {
    const list = document.getElementById('group-members-list');
    const memberElements = list.querySelectorAll('.group-member-item');

    studyTimes.forEach((st, idx) => {
        if (memberElements[idx]) {
            const totalTime = formatDuration(st.totalSeconds);
            memberElements[idx].innerHTML = `
                <div class="member-avatar" style="background: var(--accent-purple)">${getInitials(st.displayName || st.username)}</div>
                <div class="member-info">
                    <span class="member-name">${escapeHtml(st.displayName || st.username)}</span>
                    <span class="member-study-time">${totalTime} studied</span>
                </div>
            `;
        }
    });
}

function toggleGroupStudy() {
    if (groupStudyActive) {
        socket.emit('stop_study', { userId: currentUser.id, groupId: currentGroupId });
        groupStudyActive = false;
        document.getElementById('group-study-btn').textContent = 'Start Study Session';
        document.getElementById('group-study-status').textContent = 'Not studying';
    } else {
        socket.emit('start_study', { userId: currentUser.id, groupId: currentGroupId });
        socket.studyStartTime = Date.now();
        groupStudyActive = true;
        document.getElementById('group-study-btn').textContent = 'Stop Studying';
        document.getElementById('group-study-status').textContent = 'Studying...';
    }
}

async function leaveGroup() {
    if (!confirm('Leave this group?')) return;

    try {
        await fetch(`/api/groups/${currentGroupId}/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id })
        });

        closeGroupDetailModal();
        loadGroups();
    } catch (err) {
        alert('Failed to leave group');
    }
}

let pendingGroupJoin = null;

function openGroupInviteModal() {
    document.getElementById('group-invite-code-display').textContent = 'Generating...';
    document.getElementById('group-join-error').classList.add('hidden');
    document.getElementById('group-invite-modal').classList.remove('hidden');
    document.getElementById('group-detail-modal').classList.add('hidden');

    fetch('/api/groups/invite/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: currentGroupId })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            const baseUrl = window.location.origin;
            document.getElementById('group-invite-code-display').textContent = `${baseUrl}/group/${data.inviteCode}`;
        }
    })
    .catch(err => {
        document.getElementById('group-invite-code-display').textContent = 'Error generating link';
    });
}

async function openAddGroupMembersModal() {
    document.getElementById('add-group-members-modal').classList.remove('hidden');
    document.getElementById('group-detail-modal').classList.add('hidden');

    try {
        const res = await fetch(`/api/groups/${currentGroupId}/addable-members/${currentUser.id}`);
        const users = await res.json();

        const list = document.getElementById('add-group-members-list');
        if (users.length === 0) {
            list.innerHTML = '<div class="no-results">No friends available to add. Add friends first!</div>';
        } else {
            list.innerHTML = users.map(u => {
                const avatarHtml = getAvatarHTML(u.avatar, u.displayName || u.username);
                const initials = getAvatarInitials(u.avatar, u.displayName || u.username);
                return `
                <div class="add-group-member-item">
                    <div class="add-group-member-avatar" style="${avatarHtml ? 'padding:0' : ''}">
                        ${avatarHtml || initials}
                    </div>
                    <div class="add-group-member-info">
                        <span class="add-group-member-name">${escapeHtml(u.displayName || u.username)}</span>
                        <span class="add-group-member-username">@${escapeHtml(u.username)}</span>
                    </div>
                    <button class="btn-accent-small" onclick="addMemberToGroup(${u.id})">Add</button>
                </div>
            `}).join('');
        }
    } catch (err) {
        console.error('Failed to load addable members:', err);
    }
}

function closeAddGroupMembersModal() {
    document.getElementById('add-group-members-modal').classList.add('hidden');
    document.getElementById('group-detail-modal').classList.remove('hidden');
}

async function addMemberToGroup(userId) {
    try {
        await fetch(`/api/groups/${currentGroupId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        openAddGroupMembersModal();
        loadGroupMembers();
    } catch (err) {
        alert('Failed to add member');
    }
}

function closeGroupInviteModal() {
    document.getElementById('group-invite-modal').classList.add('hidden');
    document.getElementById('group-detail-modal').classList.remove('hidden');
}

function copyGroupInviteLink() {
    const code = document.getElementById('group-invite-code-display').textContent;
    navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('copy-group-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Invite Link', 2000);
    });
}

async function joinGroupFromCode() {
    const code = document.getElementById('group-join-code-input').value.trim();
    const errorEl = document.getElementById('group-join-error');

    if (!code) {
        errorEl.textContent = 'Please enter a group code';
        errorEl.classList.remove('hidden');
        return;
    }

    try {
        const res = await fetch(`/api/groups/invite/${encodeURIComponent(code)}`);
        const data = await res.json();

        if (data.success) {
            await fetch(`/api/groups/${data.group.id}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUser.id })
            });
            closeGroupInviteModal();
            loadGroups();
            alert(`Joined group: ${data.group.name}!`);
        } else {
            errorEl.textContent = data.error || 'Invalid group code';
            errorEl.classList.remove('hidden');
        }
    } catch (err) {
        errorEl.textContent = 'Failed to join group';
        errorEl.classList.remove('hidden');
    }
}

function showJoinGroupModal(group) {
    pendingGroupJoin = group;
    document.getElementById('join-group-desc').textContent = `You have been invited to join "${group.name}"!`;
    document.getElementById('join-group-modal').classList.remove('hidden');
}

let studySessionInterval = null;

function getGlowClass(hours) {
    if (hours >= 6) return 'glow-violet';
    if (hours >= 5) return 'glow-red';
    if (hours >= 4) return 'glow-blue';
    if (hours >= 3) return 'glow-yellow';
    if (hours >= 2) return 'glow-green';
    if (hours >= 1) return 'glow-white';
    return '';
}

function getProgressDots(hours) {
    let filled = 0;
    if (hours >= 1) filled = 1;
    if (hours >= 2) filled = 2;
    if (hours >= 3) filled = 3;
    if (hours >= 4) filled = 4;
    if (hours >= 5) filled = 5;
    if (hours >= 6) filled = 6;
    
    let html = '';
    for (let i = 0; i < 6; i++) {
        html += `<div class="progress-dot ${i < filled ? 'filled' : ''}"></div>`;
    }
    return html;
}

function openStudySessionPage() {
    document.getElementById('study-session-page').classList.remove('hidden');
    document.getElementById('group-detail-modal').classList.add('hidden');
    renderStudySession();
    
    studySessionInterval = setInterval(() => {
        renderStudySession();
    }, 1000);
}

function closeStudySessionPage() {
    document.getElementById('study-session-page').classList.add('hidden');
    document.getElementById('group-detail-modal').classList.remove('hidden');
    if (studySessionInterval) {
        clearInterval(studySessionInterval);
        studySessionInterval = null;
    }
}

async function renderStudySession() {
    if (!currentGroupId) return;

    try {
        const res = await fetch(`/api/groups/${currentGroupId}/study-time`);
        const studyTimes = await res.json();

        document.getElementById('study-session-group-name').textContent = currentGroupName || 'Study Session';

        const container = document.getElementById('study-session-members');
        
        let totalSeconds = 0;
        const isStudying = studyTimes.some(s => s.isStudying);
        
        const html = studyTimes.map(st => {
            const hours = st.totalSeconds / 3600;
            const glowClass = getGlowClass(hours);
            const avatarHtml = getAvatarHTML(st.avatar, st.displayName || st.username);
            const initials = getAvatarInitials(st.avatar, st.displayName || st.username);
            totalSeconds += st.totalSeconds;
            
            return `
            <div class="study-member-card">
                <div class="study-member-avatar-wrapper">
                    <div class="study-member-avatar ${glowClass}">
                        ${avatarHtml || initials}
                    </div>
                </div>
                <div class="study-member-info">
                    <div class="study-member-name">${escapeHtml(st.displayName || st.username)}</div>
                    <div class="study-member-timer">${formatDuration(st.totalSeconds)}</div>
                    <div class="study-member-status ${st.isStudying ? 'studying' : ''}">
                        ${st.isStudying ? '🔴 Studying' : 'Idle'}
                    </div>
                    <div class="study-member-progress">
                        ${getProgressDots(hours)}
                    </div>
                </div>
            </div>
        `}).join('');

        container.innerHTML = html;

        const totalH = Math.floor(totalSeconds / 3600);
        const totalM = Math.floor((totalSeconds % 3600) / 60);
        const totalS = totalSeconds % 60;
        document.getElementById('session-total-timer').textContent = 
            `${pad(totalH)}:${pad(totalM)}:${pad(totalS)}`;

        const btn = document.getElementById('session-toggle-btn');
        if (groupStudyActive) {
            btn.textContent = 'Stop Studying';
            btn.style.background = 'var(--accent-red)';
        } else {
            btn.textContent = 'Start Studying Together';
            btn.style.background = '';
        }
    } catch (err) {
        console.error('Failed to render study session:', err);
    }
}

function closeJoinGroupModal() {
    document.getElementById('join-group-modal').classList.add('hidden');
    pendingGroupJoin = null;
}

async function confirmJoinGroup() {
    if (!pendingGroupJoin) return;

    try {
        await fetch(`/api/groups/${pendingGroupJoin.id}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id })
        });
        closeJoinGroupModal();
        loadGroups();
        alert(`Joined group: ${pendingGroupJoin.name}!`);
    } catch (err) {
        alert('Failed to join group');
    }
}

function checkForGroupInvite() {
    const path = window.location.pathname;
    if (path.startsWith('/group/')) {
        const code = path.replace('/group/', '');
        setTimeout(() => {
            fetch(`/api/groups/invite/${encodeURIComponent(code)}`)
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        showJoinGroupModal(data.group);
                    }
                })
                .catch(() => {});
        }, 1000);
    }
}