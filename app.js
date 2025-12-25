/**
 * Pomodoro Timer Application
 * A minimalist timer with Material 3 Expressive design
 */

// ============================================
// Sound Manager - Base64 encoded alert sound
// ============================================
const ALERT_SOUND = (() => {
    // Generate a simple beep sound using Web Audio API
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    function createBeep(frequency = 800, duration = 0.15, volume = 0.5) {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration);
    }

    return {
        play: function (volume = 0.5) {
            // Resume audio context if suspended (browser autoplay policy)
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
            // Play a pleasant chime sequence
            createBeep(880, 0.15, volume);
            setTimeout(() => createBeep(1100, 0.15, volume), 150);
            setTimeout(() => createBeep(880, 0.3, volume), 300);
        }
    };
})();

// ============================================
// Application State
// ============================================
const AppState = {
    // Timer State
    currentMode: 'pomodoro', // 'pomodoro' | 'shortBreak' | 'longBreak'
    isRunning: false,
    timeRemaining: 25 * 60, // in seconds
    totalTime: 25 * 60,
    timerInterval: null,
    completedPomodoros: 0,

    // Settings (defaults)
    settings: {
        pomodoroMinutes: 25,
        shortBreakMinutes: 5,
        longBreakMinutes: 15,
        longBreakInterval: 4,
        soundEnabled: true,
        soundVolume: 50
    },

    // Statistics
    sessions: []
};

// ============================================
// Storage Manager
// ============================================
const StorageManager = {
    KEYS: {
        SETTINGS: 'pomodoro_settings',
        SESSIONS: 'pomodoro_sessions',
        STREAK: 'pomodoro_streak'
    },

    save(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save to localStorage:', e);
        }
    },

    load(key, defaultValue = null) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : defaultValue;
        } catch (e) {
            console.warn('Failed to load from localStorage:', e);
            return defaultValue;
        }
    },

    loadSettings() {
        const saved = this.load(this.KEYS.SETTINGS, {});
        return { ...AppState.settings, ...saved };
    },

    saveSettings(settings) {
        this.save(this.KEYS.SETTINGS, settings);
    },

    loadSessions() {
        return this.load(this.KEYS.SESSIONS, []);
    },

    saveSessions(sessions) {
        this.save(this.KEYS.SESSIONS, sessions);
    },

    addSession(session) {
        const sessions = this.loadSessions();
        sessions.push(session);
        // Keep only last 90 days of data
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const filtered = sessions.filter(s => new Date(s.date) >= cutoff);
        this.saveSessions(filtered);
        return filtered;
    }
};

// ============================================
// Timer Controller
// ============================================
const TimerController = {
    getModeSettings() {
        const { settings } = AppState;
        return {
            pomodoro: {
                minutes: settings.pomodoroMinutes,
                label: 'Focus Time'
            },
            shortBreak: {
                minutes: settings.shortBreakMinutes,
                label: 'Short Break'
            },
            longBreak: {
                minutes: settings.longBreakMinutes,
                label: 'Long Break'
            }
        };
    },

    setMode(mode) {
        AppState.currentMode = mode;
        const modeSettings = this.getModeSettings()[mode];
        AppState.totalTime = modeSettings.minutes * 60;
        AppState.timeRemaining = AppState.totalTime;
        AppState.isRunning = false;

        if (AppState.timerInterval) {
            clearInterval(AppState.timerInterval);
            AppState.timerInterval = null;
        }

        UIController.updateMode(mode);
        UIController.updateTimer();
        UIController.updateTimerLabel(modeSettings.label);
        UIController.updateProgress(1);
        UIController.setRunningState(false);
    },

    start() {
        if (AppState.isRunning) return;

        AppState.isRunning = true;
        UIController.setRunningState(true);

        AppState.timerInterval = setInterval(() => {
            AppState.timeRemaining--;

            const progress = AppState.timeRemaining / AppState.totalTime;
            UIController.updateTimer();
            UIController.updateProgress(progress);

            if (AppState.timeRemaining <= 0) {
                this.complete();
            }
        }, 1000);
    },

    pause() {
        if (!AppState.isRunning) return;

        AppState.isRunning = false;
        UIController.setRunningState(false);

        if (AppState.timerInterval) {
            clearInterval(AppState.timerInterval);
            AppState.timerInterval = null;
        }
    },

    toggle() {
        if (AppState.isRunning) {
            this.pause();
        } else {
            this.start();
        }
    },

    reset() {
        this.pause();
        const modeSettings = this.getModeSettings()[AppState.currentMode];
        AppState.timeRemaining = modeSettings.minutes * 60;
        AppState.totalTime = modeSettings.minutes * 60;
        UIController.updateTimer();
        UIController.updateProgress(1);
    },

    skip() {
        this.pause();
        this.complete(true);
    },

    complete(skipped = false) {
        this.pause();

        // Play sound if enabled
        if (AppState.settings.soundEnabled) {
            ALERT_SOUND.play(AppState.settings.soundVolume / 100);
        }

        // Record session if it was a pomodoro and not skipped
        if (AppState.currentMode === 'pomodoro' && !skipped) {
            AppState.completedPomodoros++;

            const session = {
                date: new Date().toISOString().split('T')[0],
                hour: new Date().getHours(),
                duration: AppState.settings.pomodoroMinutes,
                type: 'pomodoro',
                timestamp: Date.now()
            };

            AppState.sessions = StorageManager.addSession(session);
            UIController.updateTodayStats();
        }

        // Flash animation
        UIController.flashComplete();

        // Determine next mode
        let nextMode;
        if (AppState.currentMode === 'pomodoro') {
            // Check if it's time for a long break
            if (AppState.completedPomodoros % AppState.settings.longBreakInterval === 0) {
                nextMode = 'longBreak';
            } else {
                nextMode = 'shortBreak';
            }
        } else {
            nextMode = 'pomodoro';
        }

        UIController.updateSessionCounter();

        // Switch to next mode after a brief delay
        setTimeout(() => {
            this.setMode(nextMode);
        }, 500);
    }
};

// ============================================
// UI Controller
// ============================================
const UIController = {
    elements: {},

    init() {
        // Cache DOM elements
        this.elements = {
            app: document.getElementById('app'),
            timerDisplay: document.getElementById('timerDisplay'),
            timerLabel: document.getElementById('timerLabel'),
            timerCard: document.querySelector('.timer-card'),
            timerRingProgress: document.querySelector('.timer-ring-progress'),
            startPauseBtn: document.getElementById('startPauseBtn'),
            resetBtn: document.getElementById('resetBtn'),
            skipBtn: document.getElementById('skipBtn'),
            modeTabs: document.querySelectorAll('.mode-tab'),
            sessionCount: document.getElementById('sessionCount'),
            sessionGoal: document.getElementById('sessionGoal'),
            // Today's stats
            todayPomodoros: document.getElementById('todayPomodoros'),
            todayFocusTime: document.getElementById('todayFocusTime'),
            currentStreak: document.getElementById('currentStreak'),
            // Settings
            settingsBtn: document.getElementById('settingsBtn'),
            settingsModal: document.getElementById('settingsModal'),
            closeSettings: document.getElementById('closeSettings'),
            pomodoroMinutes: document.getElementById('pomodoroMinutes'),
            shortBreakMinutes: document.getElementById('shortBreakMinutes'),
            longBreakMinutes: document.getElementById('longBreakMinutes'),
            longBreakInterval: document.getElementById('longBreakInterval'),
            soundEnabled: document.getElementById('soundEnabled'),
            soundVolume: document.getElementById('soundVolume'),
            volumeValue: document.getElementById('volumeValue'),
            resetSettings: document.getElementById('resetSettings'),
            saveSettings: document.getElementById('saveSettings'),
            // Stats
            statsBtn: document.getElementById('statsBtn'),
            statsModal: document.getElementById('statsModal'),
            closeStats: document.getElementById('closeStats'),
            statsTabs: document.querySelectorAll('.stats-tab'),
            periodPomodoros: document.getElementById('periodPomodoros'),
            periodFocusTime: document.getElementById('periodFocusTime'),
            periodDailyAvg: document.getElementById('periodDailyAvg'),
            focusChart: document.getElementById('focusChart'),
            productivityChart: document.getElementById('productivityChart')
        };

        this.bindEvents();
        this.loadSettings();
        this.loadSessions();
        this.updateTodayStats();
        this.updateSessionCounter();
    },

    bindEvents() {
        // Timer controls
        this.elements.startPauseBtn.addEventListener('click', () => TimerController.toggle());
        this.elements.resetBtn.addEventListener('click', () => TimerController.reset());
        this.elements.skipBtn.addEventListener('click', () => TimerController.skip());

        // Mode tabs
        this.elements.modeTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const mode = tab.dataset.mode;
                TimerController.setMode(mode);
            });
        });

        // Settings modal
        this.elements.settingsBtn.addEventListener('click', () => this.openSettings());
        this.elements.closeSettings.addEventListener('click', () => this.closeModal('settingsModal'));
        this.elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.elements.settingsModal) this.closeModal('settingsModal');
        });
        this.elements.saveSettings.addEventListener('click', () => this.saveSettings());
        this.elements.resetSettings.addEventListener('click', () => this.resetSettingsToDefaults());

        // Volume slider
        this.elements.soundVolume.addEventListener('input', (e) => {
            this.elements.volumeValue.textContent = `${e.target.value}%`;
        });

        // Stats modal
        this.elements.statsBtn.addEventListener('click', () => this.openStats());
        this.elements.closeStats.addEventListener('click', () => this.closeModal('statsModal'));
        this.elements.statsModal.addEventListener('click', (e) => {
            if (e.target === this.elements.statsModal) this.closeModal('statsModal');
        });

        // Stats tabs
        this.elements.statsTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const period = tab.dataset.period;
                this.elements.statsTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.updateStatsCharts(period);
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;

            if (e.code === 'Space') {
                e.preventDefault();
                TimerController.toggle();
            } else if (e.code === 'KeyR') {
                TimerController.reset();
            } else if (e.code === 'Escape') {
                this.closeModal('settingsModal');
                this.closeModal('statsModal');
            }
        });
    },

    loadSettings() {
        AppState.settings = StorageManager.loadSettings();
        this.populateSettingsForm();
        this.elements.sessionGoal.textContent = AppState.settings.longBreakInterval;
    },

    loadSessions() {
        AppState.sessions = StorageManager.loadSessions();
    },

    populateSettingsForm() {
        const { settings } = AppState;
        this.elements.pomodoroMinutes.value = settings.pomodoroMinutes;
        this.elements.shortBreakMinutes.value = settings.shortBreakMinutes;
        this.elements.longBreakMinutes.value = settings.longBreakMinutes;
        this.elements.longBreakInterval.value = settings.longBreakInterval;
        this.elements.soundEnabled.checked = settings.soundEnabled;
        this.elements.soundVolume.value = settings.soundVolume;
        this.elements.volumeValue.textContent = `${settings.soundVolume}%`;
    },

    saveSettings() {
        const newSettings = {
            pomodoroMinutes: parseInt(this.elements.pomodoroMinutes.value) || 25,
            shortBreakMinutes: parseInt(this.elements.shortBreakMinutes.value) || 5,
            longBreakMinutes: parseInt(this.elements.longBreakMinutes.value) || 15,
            longBreakInterval: parseInt(this.elements.longBreakInterval.value) || 4,
            soundEnabled: this.elements.soundEnabled.checked,
            soundVolume: parseInt(this.elements.soundVolume.value) || 50
        };

        // Validate
        newSettings.pomodoroMinutes = Math.min(90, Math.max(1, newSettings.pomodoroMinutes));
        newSettings.shortBreakMinutes = Math.min(30, Math.max(1, newSettings.shortBreakMinutes));
        newSettings.longBreakMinutes = Math.min(60, Math.max(1, newSettings.longBreakMinutes));
        newSettings.longBreakInterval = Math.min(8, Math.max(2, newSettings.longBreakInterval));

        AppState.settings = newSettings;
        StorageManager.saveSettings(newSettings);

        // Update session goal display
        this.elements.sessionGoal.textContent = newSettings.longBreakInterval;

        // Reset timer with new settings
        TimerController.setMode(AppState.currentMode);

        this.closeModal('settingsModal');
    },

    resetSettingsToDefaults() {
        AppState.settings = {
            pomodoroMinutes: 25,
            shortBreakMinutes: 5,
            longBreakMinutes: 15,
            longBreakInterval: 4,
            soundEnabled: true,
            soundVolume: 50
        };
        this.populateSettingsForm();
    },

    openSettings() {
        this.populateSettingsForm();
        this.elements.settingsModal.classList.remove('hidden');
    },

    openStats() {
        this.elements.statsModal.classList.remove('hidden');
        // Default to week view
        this.elements.statsTabs.forEach(t => t.classList.remove('active'));
        this.elements.statsTabs[0].classList.add('active');

        // Use setTimeout to ensure modal is visible and has dimensions
        // requestAnimationFrame might fire before layout is stable if there are transitions
        setTimeout(() => {
            this.updateStatsCharts('week');
        }, 50);
    },

    closeModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    },

    updateMode(mode) {
        // Update app data attribute for CSS theming
        this.elements.app.dataset.mode = mode;

        // Update tab states
        this.elements.modeTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.mode === mode);
            tab.setAttribute('aria-selected', tab.dataset.mode === mode);
        });
    },

    updateTimer() {
        const minutes = Math.floor(AppState.timeRemaining / 60);
        const seconds = AppState.timeRemaining % 60;
        this.elements.timerDisplay.textContent =
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // Update page title
        document.title = `${this.elements.timerDisplay.textContent} - Pomodoro`;
    },

    updateTimerLabel(label) {
        this.elements.timerLabel.textContent = label;
    },

    updateProgress(progress) {
        const circumference = 565.48; // 2 * PI * 90
        const offset = circumference * (1 - progress);
        this.elements.timerRingProgress.style.strokeDashoffset = offset;
    },

    setRunningState(isRunning) {
        const playIcon = this.elements.startPauseBtn.querySelector('.icon-play');
        const pauseIcon = this.elements.startPauseBtn.querySelector('.icon-pause');

        playIcon.classList.toggle('hidden', isRunning);
        pauseIcon.classList.toggle('hidden', !isRunning);

        this.elements.timerCard.classList.toggle('running', isRunning);
        this.elements.startPauseBtn.setAttribute('aria-label', isRunning ? 'Pause Timer' : 'Start Timer');
    },

    flashComplete() {
        this.elements.timerCard.classList.add('complete');
        setTimeout(() => {
            this.elements.timerCard.classList.remove('complete');
        }, 1500);
    },

    updateSessionCounter() {
        this.elements.sessionCount.textContent = AppState.completedPomodoros % AppState.settings.longBreakInterval;
    },

    updateTodayStats() {
        const today = new Date().toISOString().split('T')[0];
        const todaySessions = AppState.sessions.filter(s => s.date === today && s.type === 'pomodoro');

        const pomodoros = todaySessions.length;
        const totalMinutes = todaySessions.reduce((sum, s) => sum + s.duration, 0);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        this.elements.todayPomodoros.textContent = pomodoros;
        this.elements.todayFocusTime.textContent = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        // Calculate streak
        const streak = this.calculateStreak();
        this.elements.currentStreak.textContent = streak;
    },

    calculateStreak() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let streak = 0;
        let checkDate = new Date(today);

        while (true) {
            const dateStr = checkDate.toISOString().split('T')[0];
            const hasSessions = AppState.sessions.some(s => s.date === dateStr && s.type === 'pomodoro');

            if (hasSessions) {
                streak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else if (dateStr === today.toISOString().split('T')[0]) {
                // Today hasn't had a session yet, check yesterday
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break;
            }
        }

        return streak;
    },

    updateStatsCharts(period) {
        const days = period === 'week' ? 7 : 30;
        const stats = this.calculatePeriodStats(days);

        // Update summary
        this.elements.periodPomodoros.textContent = stats.totalPomodoros;
        this.elements.periodFocusTime.textContent = this.formatHours(stats.totalMinutes);
        this.elements.periodDailyAvg.textContent = this.formatHours(stats.totalMinutes / days);

        // Draw charts
        ChartRenderer.drawFocusChart(this.elements.focusChart, stats.dailyData, days);
        ChartRenderer.drawProductivityChart(this.elements.productivityChart, stats.hourlyData);
    },

    calculatePeriodStats(days) {
        const endDate = new Date();
        endDate.setHours(23, 59, 59, 999);

        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - days + 1);
        startDate.setHours(0, 0, 0, 0);

        const periodSessions = AppState.sessions.filter(s => {
            const sessionDate = new Date(s.date);
            return sessionDate >= startDate && sessionDate <= endDate && s.type === 'pomodoro';
        });

        // Daily data
        const dailyData = [];
        for (let i = 0; i < days; i++) {
            const date = new Date(startDate);
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];

            const daySessions = periodSessions.filter(s => s.date === dateStr);
            const minutes = daySessions.reduce((sum, s) => sum + s.duration, 0);

            dailyData.push({
                date: dateStr,
                label: this.formatDateLabel(date, days),
                minutes,
                pomodoros: daySessions.length
            });
        }

        // Hourly data (productivity by hour)
        const hourlyData = Array(24).fill(0);
        periodSessions.forEach(s => {
            hourlyData[s.hour] += s.duration;
        });

        return {
            totalPomodoros: periodSessions.length,
            totalMinutes: periodSessions.reduce((sum, s) => sum + s.duration, 0),
            dailyData,
            hourlyData
        };
    },

    formatDateLabel(date, totalDays) {
        const options = totalDays <= 7
            ? { weekday: 'short' }
            : { month: 'short', day: 'numeric' };
        return date.toLocaleDateString('en-US', options);
    },

    formatHours(minutes) {
        const hours = minutes / 60;
        if (hours < 1) {
            return `${Math.round(minutes)}m`;
        }
        return `${hours.toFixed(1)}h`;
    }
};

// ============================================
// Chart Renderer
// ============================================
const ChartRenderer = {
    drawFocusChart(canvas, data, days) {
        if (!canvas) return;

        try {
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const rect = canvas.getBoundingClientRect();

            // Handle case where chart is hidden or has no dimensions
            if (!rect || rect.width === 0 || rect.height === 0) return;

            // Limit DPR to prevent oversized canvases on high-DPI displays
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const width = rect.width;
            const height = rect.height;

            // Prevent oversized canvases that can cause crashes
            const maxCanvasSize = 4096;
            if (width * dpr > maxCanvasSize || height * dpr > maxCanvasSize) {
                console.warn('Canvas size too large, skipping render');
                return;
            }

            // Setting canvas.width/height automatically clears canvas AND resets transform
            canvas.width = width * dpr;
            canvas.height = height * dpr;

            // Clear and reset transform, then apply scale for crisp drawing
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (typeof ctx.setTransform === 'function') {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
            }
            ctx.scale(dpr, dpr);

            // Padding adjusted for label visibility
            const padding = { top: 15, right: 10, bottom: 30, left: 35 };
            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;

            // Find max value
            const maxMinutes = Math.max(...data.map(d => d.minutes), 60);
            const maxHours = Math.ceil(maxMinutes / 60);

            // Colors
            const primaryColor = getComputedStyle(document.documentElement)
                .getPropertyValue('--md-sys-color-primary').trim() || '#FF6B6B';
            const textColor = 'rgba(255, 255, 255, 0.7)';
            const gridColor = 'rgba(255, 255, 255, 0.1)';

            // Draw grid lines - reduced to 3 steps for cleaner look
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 1;

            const ySteps = 3;
            for (let i = 0; i <= ySteps; i++) {
                const y = padding.top + (chartHeight / ySteps) * i;
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(width - padding.right, y);
                ctx.stroke();

                // Y-axis labels - smaller font, closer to grid
                const hours = maxHours - (maxHours / ySteps) * i;
                ctx.fillStyle = textColor;
                ctx.font = '9px Inter, sans-serif';
                ctx.textAlign = 'right';
                // Ensure 0 is always 0, not 0.0
                const label = hours === 0 ? '0' : hours.toFixed(1);
                ctx.fillText(`${label}h`, padding.left - 5, y + 3);
            }

            // Calculate bar dimensions
            const barCount = data.length;
            const barSpacing = chartWidth / barCount;
            // Adjust bar width based on number of bars
            const barWidth = days <= 7
                ? Math.min(barSpacing * 0.6, 40)
                : Math.min(barSpacing * 0.8, 15);

            // Determine label interval for 30-day view
            const labelInterval = days <= 7 ? 1 : 7;
            const fontSize = days <= 7 ? '11px' : '9px';

            // Draw bars with animation-ready structure
            data.forEach((d, i) => {
                const barHeight = (d.minutes / (maxHours * 60)) * chartHeight;
                const x = padding.left + barSpacing * i + (barSpacing - barWidth) / 2;
                const y = padding.top + chartHeight - barHeight;

                // Bar with gradient
                const gradient = ctx.createLinearGradient(x, y, x, y + barHeight);
                gradient.addColorStop(0, primaryColor);
                gradient.addColorStop(1, this.adjustColor(primaryColor, -30));

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.roundRect(x, y, barWidth, barHeight, days <= 7 ? [4, 4, 0, 0] : [2, 2, 0, 0]);
                ctx.fill();

                // X-axis labels
                ctx.fillStyle = textColor;
                ctx.font = `${fontSize} Inter, sans-serif`;
                ctx.textAlign = 'center';

                // Show labels at appropriate intervals
                if (days <= 7 || i % labelInterval === 0 || i === barCount - 1) {
                    // Position label within the bottom padding area
                    ctx.fillText(d.label, x + barWidth / 2, height - 10);
                }
            });
        } catch (error) {
            console.error('Error drawing focus chart:', error);
        }
    },

    drawProductivityChart(canvas, hourlyData) {
        if (!canvas) return;

        try {
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const rect = canvas.getBoundingClientRect();

            // Handle hidden state
            if (!rect || rect.width === 0 || rect.height === 0) return;

            // Limit DPR to prevent oversized canvases on high-DPI displays
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const width = rect.width;
            const height = rect.height;

            // Prevent oversized canvases that can cause crashes
            const maxCanvasSize = 4096;
            if (width * dpr > maxCanvasSize || height * dpr > maxCanvasSize) {
                console.warn('Canvas size too large, skipping render');
                return;
            }

            // Setting canvas.width/height automatically clears canvas AND resets transform
            canvas.width = width * dpr;
            canvas.height = height * dpr;

            // Clear and reset transform, then apply scale for crisp drawing
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (typeof ctx.setTransform === 'function') {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
            }
            ctx.scale(dpr, dpr);

            const padding = { top: 10, right: 10, bottom: 25, left: 10 };
            const chartWidth = width - padding.left - padding.right;
            const chartHeight = height - padding.top - padding.bottom;

            // Find max value
            const maxMinutes = Math.max(...hourlyData, 1);

            // Colors
            const primaryColor = getComputedStyle(document.documentElement)
                .getPropertyValue('--md-sys-color-primary').trim() || '#FF6B6B';
            const textColor = 'rgba(255, 255, 255, 0.7)';

            // Draw hour blocks (24 hours)
            const blockWidth = chartWidth / 24;
            const blockHeight = chartHeight;

            hourlyData.forEach((minutes, hour) => {
                const intensity = minutes / maxMinutes;
                const x = padding.left + blockWidth * hour;
                const y = padding.top;

                // Background block
                ctx.fillStyle = this.adjustColorOpacity(primaryColor, 0.1 + intensity * 0.9);
                ctx.beginPath();
                ctx.roundRect(x + 1, y, blockWidth - 2, blockHeight, 4);
                ctx.fill();

                // Hour labels (every 6 hours)
                if (hour % 6 === 0 || hour === 23) {
                    ctx.fillStyle = textColor;
                    ctx.font = '9px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    const label = hour === 0 ? '12am' : hour === 12 ? '12pm' :
                        hour < 12 ? `${hour}am` : `${hour - 12}pm`;
                    // Position label within the bottom padding area
                    ctx.fillText(label, x + blockWidth / 2, height - 5);
                }
            });
        } catch (error) {
            console.error('Error drawing productivity chart:', error);
        }
    },

    adjustColor(color, amount) {
        let r, g, b;

        if (color.startsWith('#')) {
            const num = parseInt(color.replace('#', ''), 16);
            r = (num >> 16);
            g = (num >> 8) & 0x00FF;
            b = num & 0x0000FF;
        } else if (color.startsWith('rgb')) {
            const match = color.match(/\d+/g);
            if (match) {
                [r, g, b] = match.map(Number);
            } else {
                return color;
            }
        } else {
            return color;
        }

        r = Math.min(255, Math.max(0, r + amount));
        g = Math.min(255, Math.max(0, g + amount));
        b = Math.min(255, Math.max(0, b + amount));

        return `rgb(${r}, ${g}, ${b})`;
    },

    adjustColorOpacity(color, opacity) {
        let r, g, b;

        if (color.startsWith('#')) {
            const num = parseInt(color.replace('#', ''), 16);
            r = (num >> 16);
            g = (num >> 8) & 0x00FF;
            b = num & 0x0000FF;
        } else if (color.startsWith('rgb')) {
            const match = color.match(/\d+/g);
            if (match) {
                [r, g, b] = match.map(Number);
            } else {
                return color;
            }
        } else {
            // Fallback
            return color;
        }

        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
};

// ============================================
// Initialize Application
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    UIController.init();
    TimerController.setMode('pomodoro');

    // Handle visibility change (pause timer if tab becomes hidden)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && AppState.isRunning) {
            // Continue running in background - modern browsers support this
        }
    });
});
