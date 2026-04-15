function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatTimestamp(value) {
    if (!value) {
        return '未记录';
    }

    try {
        return new Date(Number(value)).toLocaleString();
    } catch (_error) {
        return '未记录';
    }
}

function escapeSelectorValue(value) {
    if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(String(value));
    }

    return String(value).replace(/["\\]/g, '\\$&');
}

function createLogsController(deps = {}) {
    const store = deps.store;
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const renderMarkdownFragment = deps.renderMarkdownFragment || ((value) => escapeHtml(value));
    const getCurrentSelectedItem = deps.getCurrentSelectedItem || (() => store.getState().session.currentSelectedItem);
    const getCurrentTopicId = deps.getCurrentTopicId || (() => store.getState().session.currentTopicId);
    const getCurrentTopicName = deps.getCurrentTopicName || (() => '');
    const selectTopic = deps.selectTopic || (async () => {});
    const openDiaryManager = deps.openDiaryManager || (async () => {});
    const openDiaryWall = deps.openDiaryWall || (async () => {});
    let searchTimer = null;
    const diagnostics = {
        unavailable: false,
        message: '',
    };

    function getLogsSlice() {
        return store.getState().logs;
    }

    function patchLogs(patch) {
        return store.patchState('logs', (current, rootState) => ({
            ...current,
            ...(typeof patch === 'function' ? patch(current, rootState) : patch),
        }));
    }

    const state = {};
    Object.defineProperties(state, {
        scope: {
            get: () => getLogsSlice().scope,
            set: (value) => patchLogs({ scope: value }),
        },
        days: {
            get: () => getLogsSlice().days,
            set: (value) => patchLogs({ days: value }),
        },
        entries: {
            get: () => getLogsSlice().entries,
            set: (value) => patchLogs({ entries: value }),
        },
        activeDiaryId: {
            get: () => getLogsSlice().activeDiaryId,
            set: (value) => patchLogs({ activeDiaryId: value }),
        },
        activeDateKey: {
            get: () => getLogsSlice().activeDateKey,
            set: (value) => patchLogs({ activeDateKey: value }),
        },
        activeEntryId: {
            get: () => getLogsSlice().activeEntryId,
            set: (value) => patchLogs({ activeEntryId: value }),
        },
        detail: {
            get: () => getLogsSlice().detail,
            set: (value) => patchLogs({ detail: value }),
        },
        searchQuery: {
            get: () => getLogsSlice().searchQuery,
            set: (value) => patchLogs({ searchQuery: value }),
        },
        dateFilter: {
            get: () => getLogsSlice().dateFilter,
            set: (value) => patchLogs({ dateFilter: value }),
        },
        currentSelectedItem: {
            get: () => getCurrentSelectedItem() || { id: null, name: '' },
        },
        currentTopicId: {
            get: () => getCurrentTopicId(),
        },
        currentTopicName: {
            get: () => getCurrentTopicName(),
        },
    });

    function getActiveDay() {
        return Array.isArray(state.days)
            ? state.days.find((item) => item.id === state.activeDiaryId) || null
            : null;
    }

    function buildPayload(extra = {}) {
        const activeDay = getActiveDay();
        return {
            agentId: state.currentSelectedItem.id,
            topicId: state.currentTopicId,
            scope: state.scope,
            query: state.searchQuery,
            dateKey: state.dateFilter,
            notebookId: activeDay?.notebookId || '',
            notebookName: activeDay?.notebookName || '',
            diaryId: activeDay?.id || '',
            ...extra,
        };
    }

    function syncToolbarState() {
        el.topicLogsScopeBtn?.classList.toggle('notes-scope-btn--active', state.scope !== 'agent');
        el.agentLogsScopeBtn?.classList.toggle('notes-scope-btn--active', state.scope === 'agent');
        if (el.logsSearchInput && el.logsSearchInput.value !== state.searchQuery) {
            el.logsSearchInput.value = state.searchQuery || '';
        }
        if (el.logsDateInput && el.logsDateInput.value !== state.dateFilter) {
            el.logsDateInput.value = state.dateFilter || '';
        }
    }

    function setDiagnostics(message = '') {
        diagnostics.unavailable = Boolean(message);
        diagnostics.message = String(message || '').trim();
    }

    function renderOverview() {
        if (el.logsRangeSummary) {
            const agentName = state.currentSelectedItem.name || '未选择学科';
            const topicLabel = state.currentTopicName || state.currentTopicId || '当前话题';
            const scopeLabel = state.scope === 'agent'
                ? `当前范围：${agentName} / 学科汇总`
                : `当前范围：${agentName} / ${topicLabel}`;
            el.logsRangeSummary.textContent = scopeLabel;
        }

        if (!el.logsStateSummary) {
            return;
        }

        if (diagnostics.unavailable) {
            el.logsStateSummary.textContent = diagnostics.message || 'DailyNote 服务当前不可用。';
            return;
        }

        const summary = {
            entryCount: Array.isArray(state.entries) ? state.entries.length : 0,
            dayCount: Array.isArray(state.days) ? state.days.length : 0,
            recallCount: Array.isArray(state.entries)
                ? state.entries.reduce((sum, entry) => sum + Number(entry?.recallCount || 0), 0)
                : 0,
            latestNotebookName: state.entries?.[0]?.notebookName || state.days?.[0]?.notebookName || '',
            latestEntryPreview: state.entries?.[0]?.contentMarkdown
                ? String(state.entries[0].contentMarkdown).replace(/\s+/g, ' ').slice(0, 120)
                : '',
        };
        el.logsStateSummary.textContent = [
            `条目 ${Number(summary.entryCount || state.entries.length || 0)} 条`,
            `日记 ${Number(summary.dayCount || state.days.length || 0)} 本日记卡`,
            `召回 ${Number(summary.recallCount || 0)} 次`,
            summary.latestNotebookName ? `最新本：[${summary.latestNotebookName}]` : '',
            summary.latestEntryPreview ? `最新：${summary.latestEntryPreview}` : '',
        ].filter(Boolean).join(' · ') || '这里会显示当前范围内的 DailyNote 条目数、日记卡数量和召回情况。';
    }

    function renderDays() {
        if (!el.logsDaysList) {
            return;
        }

        if (!state.currentSelectedItem.id) {
            el.logsDaysList.innerHTML = '<div class="empty-list-state"><strong>请选择学科和话题</strong><span>选中后会显示当前上下文里的 DailyNote 日记卡。</span></div>';
            el.logsSummaryText.textContent = '当前没有日记卡。';
            return;
        }

        if (diagnostics.unavailable) {
            el.logsDaysList.innerHTML = `<div class="empty-list-state"><strong>Logs 暂不可用</strong><span>${escapeHtml(diagnostics.message)}</span></div>`;
            el.logsSummaryText.textContent = 'DailyNote 服务当前不可用。';
            return;
        }

        if (!Array.isArray(state.days) || state.days.length === 0) {
            el.logsDaysList.innerHTML = '<div class="empty-list-state"><strong>还没有日志</strong><span>模型触发 DailyNote.create 后，这里会出现按“日记本 + 日期”聚合的日记卡。</span></div>';
            el.logsSummaryText.textContent = '当前没有日记卡。';
            return;
        }

        el.logsSummaryText.textContent = `${state.days.length} 张日记卡`;
        el.logsDaysList.innerHTML = state.days.map((day) => `
            <button type="button" class="logs-card ${day.id === state.activeDiaryId ? 'logs-card--active' : ''}" data-log-diary="${escapeHtml(day.id)}">
              <div class="logs-card__top">
                <strong>${escapeHtml(day.dateKey)}</strong>
                <span>[${escapeHtml(day.notebookName || '默认')}]</span>
              </div>
              <div class="logs-card__body">${escapeHtml((day.previewMarkdown || day.viewContentMarkdown || '').replace(/^#.*$/m, '').slice(0, 140) || '查看这张日记卡')}</div>
              <div class="logs-card__meta">${escapeHtml([
                  `${Number(day.entryCount || 0)} 条`,
                  `召回 ${Number(day.recallCount || 0)} 次`,
                  Array.isArray(day.maidSignatures) && day.maidSignatures.length ? day.maidSignatures.slice(0, 2).join(' / ') : '',
              ].filter(Boolean).join(' · '))}</div>
            </button>
        `).join('');
    }

    function renderEntries() {
        if (!el.logsEntriesList) {
            return;
        }

        if (diagnostics.unavailable) {
            el.logsEntriesList.innerHTML = '<div class="empty-list-state"><strong>等待日志服务恢复</strong><span>服务恢复后，这里会重新显示逐条 DailyNote 记录。</span></div>';
            el.logsEntrySummary.textContent = '当前未加载到日志条目。';
            return;
        }

        if (!Array.isArray(state.entries) || state.entries.length === 0) {
            el.logsEntriesList.innerHTML = '<div class="empty-list-state"><strong>没有命中条目</strong><span>换个日期、日记本或关键词再试试看。</span></div>';
            el.logsEntrySummary.textContent = '选择日记卡后查看逐条记录。';
            return;
        }

        el.logsEntrySummary.textContent = `${state.entries.length} 条逐条日志`;
        el.logsEntriesList.innerHTML = state.entries.map((entry) => `
            <div
              class="logs-card logs-card--entry ${entry.id === state.activeEntryId ? 'logs-card--active' : ''}"
              data-log-entry="${escapeHtml(entry.id)}"
              role="button"
              tabindex="0"
            >
              <div class="logs-card__top">
                <strong>[${escapeHtml(entry.notebookName || '默认')}] ${escapeHtml(entry.topicNameSnapshot || entry.topicId || '未命名话题')}</strong>
                <span>${escapeHtml(new Date(Number(entry.createdAt || Date.now())).toLocaleTimeString())}</span>
              </div>
              <div class="logs-card__body">${escapeHtml(String(entry.contentMarkdown || '').slice(0, 140) || '空日志')}</div>
              <div class="logs-card__meta">${escapeHtml([
                  `${entry.requestedToolName || entry.toolRequest?.toolName || 'DailyNote'}.${entry.requestedCommand || entry.toolRequest?.command || 'create'}`,
                  entry.maidSignature || entry.maidRaw || '未记录署名',
                  `召回 ${Number(entry.recallCount || 0)} 次`,
                  entry.status === 'imported' ? '旧迁移数据' : `状态 ${entry.status || 'unknown'}`,
              ].join(' · '))}</div>
              <div class="logs-card__tagline">${(entry.tags || []).slice(0, 4).map((tag) => `<button type="button" class="logs-tag" data-log-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('')}</div>
            </div>
        `).join('');
    }

    function renderDetail() {
        if (!el.logsDetailView) {
            return;
        }

        const detail = state.detail;
        if (!detail) {
            if (diagnostics.unavailable) {
                el.logsDetailView.innerHTML = `
                    <div class="empty-list-state">
                      <strong>Logs 暂不可用</strong>
                      <span>${escapeHtml(diagnostics.message)}</span>
                    </div>
                `;
                el.logsDetailMeta.textContent = '服务恢复后，这里会显示当前日记卡和逐条 DailyNote 详情。';
                return;
            }

            el.logsDetailView.innerHTML = `
                <div class="empty-list-state">
                  <strong>还没有选中日志</strong>
                  <span>点击左侧日记卡或中间条目，查看 DailyNote 正文、原始工具请求和召回情况。</span>
                </div>
            `;
            el.logsDetailMeta.textContent = '在这里查看日记卡、来源消息和召回情况。';
            return;
        }

        if (detail.kind === 'day') {
            const item = detail.item;
            el.logsDetailMeta.textContent = `${item.dateKey} · [${item.notebookName || '默认'}] · 召回 ${item.recallCount || 0} 次 · 更新于 ${formatTimestamp(item.updatedAt)}`;
            el.logsDetailView.innerHTML = `
                <div class="logs-detail-view__section">
                  <strong>日记卡正文</strong>
                  <div class="logs-detail-view__content">${renderMarkdownFragment(item.viewContentMarkdown || item.contentMarkdown || '')}</div>
                </div>
                <div class="logs-detail-view__section">
                  <strong>元数据</strong>
                  <div class="logs-detail-meta-grid">
                    <span>日记本：[${escapeHtml(item.notebookName || '默认')}]</span>
                    <span>署名：${escapeHtml(Array.isArray(item.maidSignatures) ? item.maidSignatures.join(' / ') : '')}</span>
                    <span>条目数：${escapeHtml(String(item.entryCount || 0))}</span>
                    <span>最近召回：${escapeHtml(item.lastRecalledAt ? formatTimestamp(item.lastRecalledAt) : '未召回')}</span>
                  </div>
                </div>
            `;
            return;
        }

        const entry = detail.item;
        el.logsDetailMeta.textContent = `${entry.dateKey} · [${entry.notebookName || '默认'}] · 召回 ${entry.recallCount || 0} 次 · 最近召回 ${entry.lastRecalledAt ? formatTimestamp(entry.lastRecalledAt) : '未召回'}`;
        const sourceButtons = Array.isArray(entry.sourceMessageIds) && entry.sourceMessageIds.length > 0
            ? entry.sourceMessageIds.map((messageId) => `
                <button type="button" class="ghost-button icon-text-btn logs-jump-btn" data-log-jump="${escapeHtml(messageId)}">
                  <span class="material-symbols-outlined">forum</span> 跳到消息 ${escapeHtml(messageId)}
                </button>
            `).join('')
            : '<span class="settings-caption">当前没有来源消息 ID。</span>';

        el.logsDetailView.innerHTML = `
            <div class="logs-detail-view__content">${renderMarkdownFragment(entry.contentMarkdown || '')}</div>
            <div class="logs-detail-view__section">
              <strong>标签</strong>
              <div class="logs-tag-row">${(entry.tags || []).map((tag) => `<button type="button" class="logs-tag" data-log-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('') || '<span class="settings-caption">无标签</span>'}</div>
            </div>
            <div class="logs-detail-view__section">
              <strong>来源消息</strong>
              <div class="logs-jump-list">${sourceButtons}</div>
            </div>
            <div class="logs-detail-view__section">
              <strong>元数据</strong>
              <div class="logs-detail-meta-grid">
                <span>工具：${escapeHtml(`${entry.requestedToolName || entry.toolRequest?.toolName || 'DailyNote'}.${entry.requestedCommand || entry.toolRequest?.command || 'create'}`)}</span>
                <span>日记本：[${escapeHtml(entry.notebookName || '默认')}]</span>
                <span>署名：${escapeHtml(entry.maidSignature || entry.maidRaw || '未记录')}</span>
                <span>文件：${escapeHtml(entry.filePath || '未记录')}</span>
                <span>来源：${escapeHtml(entry.modelSnapshot || entry.agentNameSnapshot || entry.agentId || '未记录')}</span>
                <span>来源状态：${entry.status === 'imported' ? '历史导入' : '当前 UniStudy 写入'}</span>
                <span>Topic Tag：${escapeHtml(entry.topicTag || '无')}</span>
                <span>Agent Tag：${escapeHtml(entry.agentTag || '无')}</span>
              </div>
            </div>
            <div class="logs-detail-view__section">
              <strong>原始工具请求</strong>
              <pre class="logs-json-block">${escapeHtml(JSON.stringify(entry.toolRequest || {}, null, 2))}</pre>
            </div>
        `;

        el.logsDetailView.querySelectorAll('[data-log-jump]').forEach((button) => {
            button.addEventListener('click', () => {
                void jumpToMessage(button.getAttribute('data-log-jump'));
            });
        });
        el.logsDetailView.querySelectorAll('[data-log-tag]').forEach((button) => {
            button.addEventListener('click', () => {
                selectTagFilter(button.getAttribute('data-log-tag'));
            });
        });
    }

    function renderLogsPanel() {
        syncToolbarState();
        renderOverview();
        renderDays();
        renderEntries();
        renderDetail();
    }

    async function loadDays() {
        if (!state.currentSelectedItem.id) {
            state.days = [];
            renderLogsPanel();
            return;
        }

        const result = await chatAPI.listStudyLogDays(buildPayload({
            dateKey: state.dateFilter || '',
            notebookId: '',
            notebookName: '',
        }));
        if (result?.unavailable || result?.available === false) {
            setDiagnostics(result?.reason || result?.error || '学习日志服务初始化失败，Logs 已降级为空视图。');
            state.days = [];
            state.entries = [];
            state.activeDiaryId = null;
            state.activeDateKey = null;
            state.activeEntryId = null;
            state.detail = null;
            renderLogsPanel();
            return;
        }
        if (!result?.success) {
            ui.showToastNotification(`加载日志时间线失败：${result?.error || '未知错误'}`, 'error');
            state.days = [];
            renderLogsPanel();
            return;
        }

        setDiagnostics('');
        state.days = Array.isArray(result.items) ? result.items : [];
        if (!state.activeDiaryId || !state.days.some((item) => item.id === state.activeDiaryId)) {
            state.activeDiaryId = state.days[0]?.id || null;
            state.activeDateKey = state.days[0]?.dateKey || null;
        }
    }

    async function loadEntries() {
        if (!state.currentSelectedItem.id) {
            state.entries = [];
            renderLogsPanel();
            return;
        }

        const activeDay = getActiveDay();
        const result = await chatAPI.listStudyLogEntries(buildPayload({
            dateKey: activeDay?.dateKey || state.dateFilter,
            notebookId: activeDay?.notebookId || '',
            notebookName: activeDay?.notebookName || '',
        }));
        if (result?.unavailable || result?.available === false) {
            setDiagnostics(result?.reason || result?.error || '学习日志服务初始化失败，Logs 已降级为空视图。');
            state.entries = [];
            renderLogsPanel();
            return;
        }
        if (!result?.success) {
            ui.showToastNotification(`加载日志条目失败：${result?.error || '未知错误'}`, 'error');
            state.entries = [];
            renderLogsPanel();
            return;
        }

        setDiagnostics('');
        state.entries = Array.isArray(result.items) ? result.items : [];
        if (!state.activeEntryId || !state.entries.some((item) => item.id === state.activeEntryId)) {
            state.activeEntryId = state.entries[0]?.id || null;
        }
    }

    async function loadDetail() {
        if (state.activeEntryId) {
            const entry = state.entries.find((item) => item.id === state.activeEntryId);
            const result = await chatAPI.getStudyLogEntry({
                agentId: entry?.agentId || state.currentSelectedItem.id,
                topicId: entry?.topicId || (state.scope === 'agent' ? '' : state.currentTopicId),
                entryId: state.activeEntryId,
            });
            if (result?.unavailable || result?.available === false) {
                setDiagnostics(result?.reason || result?.error || '学习日志服务初始化失败，日志详情暂不可用。');
                state.detail = null;
                renderDetail();
                return;
            }
            if (result?.success && result.item) {
                state.detail = {
                    kind: 'entry',
                    item: result.item,
                };
                renderDetail();
                return;
            }
        }

        const activeDay = getActiveDay();
        if (activeDay) {
            const result = await chatAPI.getStudyDiaryDay({
                diaryId: activeDay.id,
                notebookId: activeDay.notebookId,
                dateKey: activeDay.dateKey,
                agentId: state.currentSelectedItem.id,
                topicId: state.scope === 'agent' ? '' : state.currentTopicId,
            });
            if (result?.unavailable || result?.available === false) {
                setDiagnostics(result?.reason || result?.error || '学习日志服务初始化失败，日志详情暂不可用。');
                state.detail = null;
                renderDetail();
                return;
            }
            if (result?.success && result.item) {
                state.detail = {
                    kind: 'day',
                    item: result.item,
                };
                renderDetail();
                return;
            }
        }

        state.detail = null;
        renderDetail();
    }

    async function refreshLogs() {
        await loadDays();
        await loadEntries();
        await loadDetail();
        renderLogsPanel();
    }

    async function selectDay(diaryId) {
        const nextDay = state.days.find((item) => item.id === diaryId) || null;
        state.activeDiaryId = diaryId || null;
        state.activeDateKey = nextDay?.dateKey || null;
        state.activeEntryId = null;
        await loadEntries();
        await loadDetail();
        renderLogsPanel();
    }

    async function selectEntry(entryId) {
        state.activeEntryId = entryId || null;
        await loadDetail();
        renderLogsPanel();
    }

    async function jumpToMessage(messageId) {
        const detailEntry = state.detail?.kind === 'entry' ? state.detail.item : null;
        if (!detailEntry || !messageId) {
            return;
        }

        if (detailEntry.topicId && detailEntry.topicId !== state.currentTopicId) {
            await selectTopic(detailEntry.topicId);
        }

        const messageNode = document.querySelector(`.message-item[data-message-id="${escapeSelectorValue(messageId)}"]`);
        if (!messageNode) {
            ui.showToastNotification('没有找到对应的聊天消息。', 'warning');
            return;
        }

        messageNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
        messageNode.classList.add('message-item--logs-highlight');
        setTimeout(() => messageNode.classList.remove('message-item--logs-highlight'), 1600);
    }

    function selectTagFilter(tag) {
        state.searchQuery = String(tag || '').trim();
        queueRefresh();
    }

    function queueRefresh() {
        if (searchTimer) {
            clearTimeout(searchTimer);
        }

        searchTimer = setTimeout(() => {
            searchTimer = null;
            void refreshLogs();
        }, 220);
    }

    function bindEvents() {
        el.topicLogsScopeBtn?.addEventListener('click', () => {
            state.scope = 'topic';
            void refreshLogs();
        });
        el.agentLogsScopeBtn?.addEventListener('click', () => {
            state.scope = 'agent';
            void refreshLogs();
        });
        el.logsSearchInput?.addEventListener('input', () => {
            state.searchQuery = el.logsSearchInput.value.trim();
            queueRefresh();
        });
        el.logsDateInput?.addEventListener('change', () => {
            state.dateFilter = el.logsDateInput.value || '';
            state.activeDiaryId = null;
            state.activeDateKey = el.logsDateInput.value || null;
            void refreshLogs();
        });
        el.logsDaysList?.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target.closest('[data-log-diary]') : null;
            if (!target) {
                return;
            }
            void selectDay(target.getAttribute('data-log-diary'));
        });
        el.logsEntriesList?.addEventListener('click', (event) => {
            const tagTarget = event.target instanceof Element ? event.target.closest('[data-log-tag]') : null;
            if (tagTarget) {
                selectTagFilter(tagTarget.getAttribute('data-log-tag'));
                return;
            }
            const target = event.target instanceof Element ? event.target.closest('[data-log-entry]') : null;
            if (!target) {
                return;
            }
            void selectEntry(target.getAttribute('data-log-entry'));
        });
        el.logsEntriesList?.addEventListener('keydown', (event) => {
            if (!(event.target instanceof Element)) {
                return;
            }
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }
            const target = event.target.closest('[data-log-entry]');
            if (!target) {
                return;
            }
            event.preventDefault();
            void selectEntry(target.getAttribute('data-log-entry'));
        });
        el.logsOpenDiaryManagerBtn?.addEventListener('click', () => {
            void openDiaryManager();
        });
        el.logsOpenDiaryWallBtn?.addEventListener('click', () => {
            void openDiaryWall();
        });
    }

    return {
        bindEvents,
        refreshLogs,
        renderLogsPanel,
    };
}

export {
    createLogsController,
};
