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

function formatTimeOnly(value) {
    if (!value) {
        return '未记录时间';
    }

    try {
        return new Date(Number(value)).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (_error) {
        return '未记录时间';
    }
}

function escapeSelectorValue(value) {
    if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(String(value));
    }

    return String(value).replace(/["\\]/g, '\\$&');
}

function stripLeadingDiaryHeadings(value) {
    const lines = String(value || '').split(/\r?\n/);
    let skipping = true;
    const kept = [];

    for (const rawLine of lines) {
        const line = String(rawLine || '');
        const trimmed = line.trim();
        if (skipping && (!trimmed || trimmed.startsWith('#'))) {
            continue;
        }
        skipping = false;
        kept.push(line);
    }

    return kept.join('\n').trim();
}

function buildMarkdownPreview(value, maxChars = 420) {
    const source = String(value || '').trim();
    if (!source) {
        return {
            markdown: '',
            truncated: false,
        };
    }

    const normalized = stripLeadingDiaryHeadings(source) || source;
    if (normalized.length <= maxChars) {
        return {
            markdown: normalized,
            truncated: false,
        };
    }

    const lines = normalized.split(/\r?\n/);
    const kept = [];
    let count = 0;

    for (const rawLine of lines) {
        const line = String(rawLine || '');
        const trimmed = line.trim();
        if (!trimmed && kept[kept.length - 1] === '') {
            continue;
        }

        const nextCount = count + trimmed.length;
        if (kept.length > 0 && nextCount > maxChars) {
            break;
        }

        kept.push(line);
        count = nextCount;
        if (count >= maxChars) {
            break;
        }
    }

    const preview = kept.join('\n').trim() || normalized.slice(0, maxChars).trim();
    return {
        markdown: `${preview}\n\n...`,
        truncated: true,
    };
}

function buildPlainPreview(value, maxChars = 150) {
    let source = stripLeadingDiaryHeadings(value || '')
        // 移除 DailyNote 特殊标记和工具块
        .replace(/<<<DailyNoteStart>>>/g, '')
        .replace(/<<<DailyNoteEnd>>>/g, '')
        .replace(/<<<\[TOOL_REQUEST\]>>>[\s\S]*?<<<\[END_TOOL_REQUEST\]>>>/g, '')
        // 移除主标题和引用行
        .replace(/^#\s*DailyNote\s+\d{4}-\d{2}-\d{2}\s*$/gim, '')
        .replace(/^>\s*日记本：\s*\[?[^\]]*\]?\s*$/gim, '')
        // 移除子标题行（时间 · 署名）
        .replace(/^#{1,6}\s*\d{2}:\d{2}(:\d{2})?\s*[·•]\s*.+$/gim, '')
        // 移除话题二级标题
        .replace(/^#{2}\s+.+$/gim, '')
        // 移除 Subject / Tags 行
        .replace(/^Subject:\s*.+$/gim, '')
        .replace(/^Tags:\s*(#[^\s]+\s*)*$/gim, '')
        // 移除普通 Markdown
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^[>\-*+]\s+/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/[*_~]/g, '')
        // 移除独立的时间戳 [HH:MM] 或 [HH:MM:SS]
        .replace(/\[\d{2}:\d{2}(:\d{2})?\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!source) {
        return '';
    }

    return source.length > maxChars ? `${source.slice(0, maxChars).trim()}...` : source;
}

function getCardTopicNames(card = {}) {
    return Object.values(card.topics || {})
        .map((topic) => String(topic?.topicName || '').trim())
        .filter(Boolean);
}

function getCardAgentNames(card = {}) {
    const names = Array.isArray(card.agentNames)
        ? card.agentNames.map((name) => String(name || '').trim()).filter(Boolean)
        : [];
    if (names.length > 0) {
        return names;
    }

    const subjectNames = Array.isArray(card.subjectSignatures)
        ? card.subjectSignatures.map((name) => String(name || '').trim()).filter(Boolean)
        : [];
    if (subjectNames.length > 0) {
        return subjectNames;
    }

    return Array.isArray(card.agentIds)
        ? card.agentIds.map((name) => String(name || '').trim()).filter(Boolean)
        : [];
}

function deriveAgentGroupLabel(card = {}) {
    const agentNames = getCardAgentNames(card);
    if (agentNames.length === 1) {
        return agentNames[0];
    }
    if (agentNames.length > 1) {
        return '跨 Agent';
    }
    if (card.isPublicNotebook) {
        return '[公共]';
    }
    return '未归类';
}

function buildCardTitle(card = {}) {
    const topicNames = getCardTopicNames(card);
    if (topicNames.length > 0) {
        return topicNames[0];
    }
    if (card.notebookName) {
        return `[${card.notebookName}]`;
    }
    const agentNames = getCardAgentNames(card);
    if (agentNames.length > 0) {
        return agentNames.join(' / ');
    }
    return 'DailyNote';
}

function buildCardSelectionKey(card = {}) {
    const diaryId = String(card.diaryId || '').trim();
    const notebookId = String(card.notebookId || '').trim();
    const dateKey = String(card.dateKey || '').trim();
    const updatedAt = String(card.updatedAt || '').trim();
    const topicName = getCardTopicNames(card)[0] || '';
    return [diaryId, notebookId, dateKey, updatedAt, topicName].join('::');
}

function parseTagInput(value) {
    return String(value || '')
        .split(/[,\n|，、]/)
        .map((tag) => tag.trim())
        .filter(Boolean);
}

function groupCardsByAgent(cards = []) {
    const groups = new Map();

    cards.forEach((card) => {
        const label = deriveAgentGroupLabel(card);
        if (!groups.has(label)) {
            groups.set(label, []);
        }
        groups.get(label).push(card);
    });

    return [...groups.entries()]
        .map(([label, items]) => ({
            label,
            items: [...items].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)),
            updatedAt: Math.max(...items.map((item) => Number(item.updatedAt || 0)), 0),
        }))
        .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
}

function createDiaryWallController(deps = {}) {
    const el = deps.el;
    const chatAPI = deps.chatAPI;
    const ui = deps.ui;
    const documentObj = deps.documentObj || document;
    const renderMarkdownFragment = deps.renderMarkdownFragment || ((value) => escapeHtml(value));
    const getCurrentSelectedItem = deps.getCurrentSelectedItem || (() => ({ id: '', name: '' }));
    const getCurrentTopicId = deps.getCurrentTopicId || (() => '');
    const getCurrentTopicName = deps.getCurrentTopicName || (() => '');
    const openLogsPanel = deps.openLogsPanel || (async () => {});
    const selectTopic = deps.selectTopic || (async () => {});
    const showSubjectWorkspace = deps.showSubjectWorkspace || (() => {});
    const onOpen = deps.onOpen || (() => {});
    const onClose = deps.onClose || (() => {});

    const state = {
        open: false,
        scope: 'global',
        cards: [],
        activeAgentFilter: 'all',
        selectedCardKey: '',
        detail: null,
        detailExpanded: false,
        manageMode: false,
        selectedCardKeys: new Set(),
        editingEntry: null,
        noteModalOpen: false,
        lastLoadedAt: 0,
        loadingPromise: null,
    };

    function isEmbeddedPanel() {
        return el.diaryWallModal?.classList.contains('diary-wall-panel') === true;
    }

    function openNoteModal() {
        state.noteModalOpen = true;
        el.diaryWallNoteModal?.classList.remove('hidden');
        el.diaryWallNoteModal?.setAttribute('aria-hidden', 'false');
    }

    function closeNoteModal() {
        state.noteModalOpen = false;
        state.editingEntry = null;
        el.diaryWallNoteModal?.classList.add('hidden');
        el.diaryWallNoteModal?.setAttribute('aria-hidden', 'true');
    }

    function getAgentTabs(cards = state.cards) {
        const groups = groupCardsByAgent(cards);
        return [
            {
                id: 'all',
                label: '全部',
                count: cards.length,
            },
            ...groups.map((group) => ({
                id: group.label,
                label: group.label,
                count: group.items.length,
            })),
        ];
    }

    function getVisibleCards() {
        if (state.activeAgentFilter === 'all') {
            return state.cards;
        }

        return state.cards.filter((card) => deriveAgentGroupLabel(card) === state.activeAgentFilter);
    }

    function syncSelectedDiary() {
        const visibleCards = getVisibleCards();
        if (!state.selectedCardKey || !visibleCards.some((item) => buildCardSelectionKey(item) === state.selectedCardKey)) {
            state.selectedCardKey = '';
        }
        state.selectedCardKeys = new Set([...state.selectedCardKeys]
            .filter((key) => visibleCards.some((item) => buildCardSelectionKey(item) === key)));
    }

    function getCardByKey(key) {
        return state.cards.find((card) => buildCardSelectionKey(card) === key) || null;
    }

    function getVisibleSelectedCards() {
        return getVisibleCards().filter((card) => state.selectedCardKeys.has(buildCardSelectionKey(card)));
    }

    function setCardSelected(key, selected) {
        if (!key) {
            return;
        }
        if (selected) {
            state.selectedCardKeys.add(key);
        } else {
            state.selectedCardKeys.delete(key);
        }
    }

    function toggleCardSelected(key) {
        setCardSelected(key, !state.selectedCardKeys.has(key));
    }

    function renderAgentNav() {
        if (!el.diaryWallAgentNav) {
            return;
        }

        const tabs = getAgentTabs();
        el.diaryWallAgentNav.innerHTML = tabs.map((tab) => `
            <button
              type="button"
              class="diary-wall-agent-tab ${tab.id === state.activeAgentFilter ? 'diary-wall-agent-tab--active' : ''}"
              data-diary-wall-agent-filter="${escapeHtml(tab.id)}"
            >
              ${escapeHtml(tab.label)}
              <span>${escapeHtml(String(tab.count))}</span>
            </button>
        `).join('');
    }

    function getFilters() {
        return {
            query: el.diaryWallSearchInput?.value.trim() || '',
            notebookName: el.diaryWallNotebookInput?.value.trim() || '',
            tag: el.diaryWallTagInput?.value.trim() || '',
            dateKey: el.diaryWallDateInput?.value || '',
        };
    }

    function buildRequest() {
        const currentSelectedItem = getCurrentSelectedItem() || {};
        const currentTopicId = getCurrentTopicId() || '';
        const filters = getFilters();

        if (state.scope === 'topic') {
            return {
                scope: 'topic',
                agentId: currentSelectedItem.id || '',
                topicId: currentTopicId,
                ...filters,
                limit: 60,
            };
        }

        if (state.scope === 'agent') {
            return {
                scope: 'agent',
                agentId: currentSelectedItem.id || '',
                topicId: '',
                ...filters,
                limit: 60,
            };
        }

        if (state.scope === 'public') {
            return {
                scope: 'global',
                agentId: '',
                topicId: '',
                ...filters,
                notebookName: '公共',
                limit: 60,
            };
        }

        return {
            scope: 'global',
            agentId: '',
            topicId: '',
            ...filters,
            limit: 60,
        };
    }

    function renderSummary() {
        if (!el.diaryWallSummary) {
            return;
        }

        const visibleCards = getVisibleCards();
        const latest = [...visibleCards].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0];

        el.diaryWallSummary.innerHTML = `
            <strong>${escapeHtml(`${visibleCards.length} 张日记`)}</strong>
            <span>${escapeHtml(latest ? `最近 ${latest.dateKey || formatTimeOnly(latest.updatedAt)}` : '暂无更新')}</span>
            ${state.manageMode ? `<span>${escapeHtml(`已选 ${state.selectedCardKeys.size} 张`)}</span>` : ''}
        `;
    }

    function renderCards() {
        if (!el.diaryWallCards) {
            return;
        }

        const visibleCards = getVisibleCards();
        if (!Array.isArray(visibleCards) || visibleCards.length === 0) {
            el.diaryWallCards.innerHTML = `
                <div class="empty-list-state">
                  <strong>当前没有匹配的日记卡</strong>
                  <span>试试切换范围、清空标签，或者先在聊天里触发一次 DailyNote.create。</span>
                </div>
            `;
            return;
        }

        const sortedCards = [...visibleCards].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
        const allVisibleSelected = sortedCards.length > 0
            && sortedCards.every((card) => state.selectedCardKeys.has(buildCardSelectionKey(card)));
        const managerToolbar = state.manageMode ? `
            <div class="diary-wall-manager-toolbar">
              <strong>日记管理</strong>
              <span>点卡片选择；删除会移除本地学习日志源条目。</span>
              <button type="button" class="ghost-button icon-text-btn" data-diary-wall-toggle-all>
                <span class="material-symbols-outlined">${allVisibleSelected ? 'deselect' : 'select_all'}</span>
                ${allVisibleSelected ? '取消全选' : '全选当前'}
              </button>
              <button type="button" class="ghost-button icon-text-btn" data-diary-wall-delete-selected ${state.selectedCardKeys.size === 0 ? 'disabled' : ''}>
                <span class="material-symbols-outlined">delete</span>
                删除选中
              </button>
              <button type="button" class="ghost-button icon-text-btn" data-diary-wall-exit-manage>
                <span class="material-symbols-outlined">visibility</span>
                返回浏览
              </button>
            </div>
        ` : '';
        el.diaryWallCards.innerHTML = `
              ${managerToolbar}
              <div class="diary-wall-group__grid diary-wall-group__grid--flat">
                ${sortedCards.map((card) => {
                    const cardKey = buildCardSelectionKey(card);
                    const preview = buildPlainPreview(card.previewMarkdown || card.contentMarkdown || '', 180);
                    const entryLabel = Number(card.entryCount || 0) > 0 ? `${Number(card.entryCount || 0)} 条记录` : '日记卡';
                    const notebookLabel = card.notebookName || (Array.isArray(card.agentNames) ? card.agentNames[0] : '') || '';
                    const tagMarkup = Array.isArray(card.tags) && card.tags.length > 0
                        ? `<div class="diary-wall-card__tags">${card.tags.slice(0, 4).map((tag) => `<span class="diary-wall-chip">#${escapeHtml(tag)}</span>`).join('')}</div>`
                        : '';
                    if (state.manageMode) {
                        const isSelected = state.selectedCardKeys.has(cardKey);
                        return `
                    <article class="diary-wall-card diary-wall-card--managed ${isSelected ? 'diary-wall-card--selected' : ''} ${cardKey === state.selectedCardKey ? 'diary-wall-card--active' : ''}" data-diary-wall-card="${escapeHtml(cardKey)}" aria-selected="${isSelected ? 'true' : 'false'}">
                      <div class="diary-wall-card__header diary-wall-card__header--managed">
                        <div class="diary-wall-card__header-main">
                          <span class="diary-wall-card__eyebrow">学习日记</span>
                          <h3>${escapeHtml(buildCardTitle(card) || '未命名日记')}</h3>
                        </div>
                        <div class="diary-wall-card__actions">
                          <button type="button" class="diary-wall-card__check" data-diary-wall-card-select="${escapeHtml(cardKey)}" aria-label="${isSelected ? '取消选择日记' : '选择日记'}" aria-pressed="${isSelected ? 'true' : 'false'}">
                            <span class="diary-wall-card__check-box" aria-hidden="true">
                              <span class="material-symbols-outlined">check</span>
                            </span>
                          </button>
                          <button type="button" class="ghost-button icon-btn" data-diary-wall-manage-open="${escapeHtml(cardKey)}" aria-label="查看日记">
                            <span class="material-symbols-outlined">open_in_new</span>
                          </button>
                          <button type="button" class="ghost-button icon-btn danger" data-diary-wall-delete-card="${escapeHtml(cardKey)}" aria-label="删除日记">
                            <span class="material-symbols-outlined">delete</span>
                          </button>
                        </div>
                      </div>
                      <p class="diary-wall-card__summary">${escapeHtml(preview || '这张日记还没有摘要内容。')}</p>
                      ${tagMarkup}
                      <div class="diary-wall-card__meta">
                        ${notebookLabel ? `<span>${escapeHtml(notebookLabel)}</span>` : ''}
                        <span>${escapeHtml(card.dateKey || '未记录日期')}</span>
                        <span>${escapeHtml(entryLabel)}</span>
                      </div>
                    </article>
                `;
                    }
                    return `
                    <button type="button" class="diary-wall-card ${buildCardSelectionKey(card) === state.selectedCardKey ? 'diary-wall-card--active' : ''}" data-diary-wall-card="${escapeHtml(buildCardSelectionKey(card))}">
                      <div class="diary-wall-card__header">
                        <div class="diary-wall-card__header-main">
                          <span class="diary-wall-card__eyebrow">学习日记</span>
                          <h3>${escapeHtml(buildCardTitle(card) || '未命名日记')}</h3>
                        </div>
                      </div>
                      <p class="diary-wall-card__summary">${escapeHtml(preview || '这张日记还没有摘要内容。')}</p>
                      ${tagMarkup}
                      <div class="diary-wall-card__meta">
                        ${notebookLabel ? `<span>${escapeHtml(notebookLabel)}</span>` : ''}
                        <span>${escapeHtml(card.dateKey || '未记录日期')}</span>
                        <span>${escapeHtml(entryLabel)}</span>
                      </div>
                    </button>
                `;
                }).join('')}
              </div>
        `;
    }

    function bindDetailActions(container) {
        if (!container) {
            return;
        }

        container.querySelectorAll('[data-diary-wall-tag]').forEach((button) => {
            button.addEventListener('click', () => {
                if (el.diaryWallTagInput) {
                    el.diaryWallTagInput.value = button.getAttribute('data-diary-wall-tag') || '';
                }
                closeNoteModal();
                void refresh();
            });
        });
        container.querySelectorAll('[data-diary-wall-jump]').forEach((button) => {
            button.addEventListener('click', () => {
                closeNoteModal();
                void jumpToMessage(
                    button.getAttribute('data-diary-wall-jump') || '',
                    button.getAttribute('data-diary-wall-topic') || ''
                );
            });
        });
        container.querySelector('[data-diary-wall-toggle-preview]')?.addEventListener('click', () => {
            state.detailExpanded = !state.detailExpanded;
            renderDetail();
        });
        container.querySelectorAll('[data-diary-wall-edit-entry]').forEach((button) => {
            button.addEventListener('click', () => {
                const entryId = button.getAttribute('data-diary-wall-edit-entry') || '';
                const agentId = button.getAttribute('data-diary-wall-entry-agent') || '';
                const topicId = button.getAttribute('data-diary-wall-entry-topic') || '';
                openEntryEditor({ entryId, agentId, topicId });
            });
        });
        container.querySelectorAll('[data-diary-wall-delete-entry]').forEach((button) => {
            button.addEventListener('click', () => {
                const entryId = button.getAttribute('data-diary-wall-delete-entry') || '';
                const agentId = button.getAttribute('data-diary-wall-entry-agent') || '';
                const topicId = button.getAttribute('data-diary-wall-entry-topic') || '';
                void deleteEntry({ entryId, agentId, topicId });
            });
        });
    }

    function confirmAction(message) {
        if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
            return true;
        }
        return window.confirm(message);
    }

    async function openCardDetail(card) {
        if (!card) {
            ui.showToastNotification('还没有可以管理的日记。', 'warning');
            return;
        }

        state.selectedCardKey = buildCardSelectionKey(card);
        state.detailExpanded = true;
        renderCards();
        await loadDetail();
        if (state.detail) {
            openNoteModal();
        }
    }

    async function deleteCard(card) {
        if (!card || typeof chatAPI.deleteStudyDiaryWallCard !== 'function') {
            ui.showToastNotification('日记删除接口不可用。', 'error');
            return;
        }
        const entryCount = Number(card.entryCount || 0);
        if (!confirmAction(`确定删除 ${card.dateKey || ''} [${card.notebookName || '默认'}] 的 ${entryCount || 1} 条日记源记录吗？此操作无法从日记墙恢复。`)) {
            return;
        }

        const result = await chatAPI.deleteStudyDiaryWallCard({
            diaryId: card.diaryId,
            notebookId: card.notebookId,
            dateKey: card.dateKey,
            entryRefs: card.entryRefs || [],
        });
        if (!result?.success) {
            ui.showToastNotification(`删除日记失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        state.selectedCardKeys.delete(buildCardSelectionKey(card));
        state.selectedCardKey = '';
        state.detail = null;
        closeNoteModal();
        await refresh({ force: true });
        ui.showToastNotification(`已删除 ${Number(result.deletedCount || 0)} 条日记记录。`, 'success');
    }

    async function deleteSelectedCards() {
        if (typeof chatAPI.deleteStudyDiaryWallCard !== 'function') {
            ui.showToastNotification('日记批量删除接口不可用。', 'error');
            return;
        }
        const selectedCards = getVisibleSelectedCards();
        if (!selectedCards.length) {
            ui.showToastNotification('请先选择要删除的日记。', 'warning');
            return;
        }
        const totalEntries = selectedCards.reduce((sum, card) => sum + Number(card.entryCount || 0), 0);
        if (!confirmAction(`确定删除选中的 ${selectedCards.length} 张日记卡、共 ${totalEntries || selectedCards.length} 条源记录吗？此操作无法从日记墙恢复。`)) {
            return;
        }

        let deletedCount = 0;
        let failedCount = 0;
        for (const card of selectedCards) {
            const result = await chatAPI.deleteStudyDiaryWallCard({
                diaryId: card.diaryId,
                notebookId: card.notebookId,
                dateKey: card.dateKey,
                entryRefs: card.entryRefs || [],
            });
            if (result?.success) {
                deletedCount += Number(result.deletedCount || 0);
            } else {
                failedCount += 1;
            }
        }

        state.selectedCardKeys.clear();
        state.selectedCardKey = '';
        state.detail = null;
        closeNoteModal();
        await refresh({ force: true });
        ui.showToastNotification(
            failedCount > 0
                ? `已删除 ${deletedCount} 条日记记录，${failedCount} 张删除失败。`
                : `已删除 ${deletedCount} 条日记记录。`,
            failedCount > 0 ? 'warning' : 'success'
        );
    }

    function openEntryEditor(ref = {}) {
        const entry = (state.detail?.entries || []).find((item) => (
            String(item.id || '') === String(ref.entryId || '')
            && (!ref.agentId || String(item.agentId || '') === String(ref.agentId))
            && (!ref.topicId || String(item.topicId || '') === String(ref.topicId))
        ));
        if (!entry) {
            ui.showToastNotification('没有找到要编辑的日记条目。', 'warning');
            return;
        }

        state.editingEntry = entry;
        openNoteModal();
        if (!el.diaryWallNoteContent) {
            return;
        }
        el.diaryWallNoteContent.innerHTML = `
            <form class="diary-wall-entry-editor" data-diary-wall-entry-editor>
              <div class="diary-wall-entry-editor__header">
                <div>
                  <p class="eyebrow">${escapeHtml(formatTimestamp(entry.createdAt))}</p>
                  <h3>编辑 DailyNote</h3>
                </div>
                <button type="button" class="ghost-button icon-text-btn" data-diary-wall-cancel-entry-edit>
                  <span class="material-symbols-outlined">arrow_back</span>
                  返回详情
                </button>
              </div>
              <label class="diary-wall-field">
                <span>日记本</span>
                <input name="notebookName" value="${escapeHtml(entry.notebookName || '')}" />
              </label>
              <label class="diary-wall-field">
                <span>日记本 ID</span>
                <input name="notebookId" value="${escapeHtml(entry.notebookId || '')}" />
              </label>
              <label class="diary-wall-field">
                <span>主题/学科</span>
                <input name="subjectSignature" value="${escapeHtml(entry.subjectSignature || entry.subjectRaw || '')}" />
              </label>
              <label class="diary-wall-field">
                <span>话题标题</span>
                <input name="topicNameSnapshot" value="${escapeHtml(entry.topicNameSnapshot || '')}" />
              </label>
              <label class="diary-wall-field">
                <span>标签</span>
                <input name="tags" value="${escapeHtml((entry.tags || []).join(', '))}" />
              </label>
              <label class="diary-wall-field">
                <span>正文</span>
                <textarea name="contentMarkdown" rows="14">${escapeHtml(entry.contentMarkdown || '')}</textarea>
              </label>
              <div class="diary-wall-entry-editor__actions">
                <button type="submit" class="primary-button">保存日记</button>
                <button type="button" class="ghost-button icon-text-btn danger" data-diary-wall-delete-current-entry>
                  <span class="material-symbols-outlined">delete</span>
                  删除此条
                </button>
              </div>
            </form>
        `;
    }

    async function saveEntryEditor(form) {
        if (!state.editingEntry || typeof chatAPI.updateStudyLogEntry !== 'function') {
            ui.showToastNotification('日记编辑接口不可用。', 'error');
            return;
        }
        const FormDataCtor = documentObj.defaultView?.FormData || FormData;
        const formData = new FormDataCtor(form);
        const entry = state.editingEntry;
        const result = await chatAPI.updateStudyLogEntry({
            agentId: entry.agentId,
            topicId: entry.topicId,
            entryId: entry.id,
            updates: {
                notebookName: formData.get('notebookName'),
                notebookId: formData.get('notebookId'),
                subjectSignature: formData.get('subjectSignature'),
                subjectRaw: formData.get('subjectSignature'),
                topicNameSnapshot: formData.get('topicNameSnapshot'),
                tags: parseTagInput(formData.get('tags')),
                contentMarkdown: formData.get('contentMarkdown'),
            },
        });
        if (!result?.success) {
            ui.showToastNotification(`保存日记失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        state.editingEntry = null;
        await refresh({ force: true });
        await loadDetail();
        if (state.detail) {
            openNoteModal();
        }
        ui.showToastNotification('日记已保存。', 'success');
    }

    async function deleteEntry(ref = {}) {
        if (!ref.entryId || typeof chatAPI.deleteStudyLogEntry !== 'function') {
            ui.showToastNotification('日记删除接口不可用。', 'error');
            return;
        }
        if (!confirmAction('确定删除这条 DailyNote 源记录吗？此操作无法从日记墙恢复。')) {
            return;
        }

        const result = await chatAPI.deleteStudyLogEntry(ref);
        if (!result?.success) {
            ui.showToastNotification(`删除日记条目失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        state.editingEntry = null;
        await refresh({ force: true });
        if (state.selectedCardKey) {
            await loadDetail();
        }
        if (state.detail) {
            openNoteModal();
        } else {
            closeNoteModal();
        }
        ui.showToastNotification('日记条目已删除。', 'success');
    }

    function renderDetail() {
        const emptyMarkup = `
            <div class="empty-list-state">
              <strong>选择一张日记卡</strong>
              <span>点击卡片后查看简洁详情。</span>
            </div>
        `;
        if (!state.detail) {
            if (el.diaryWallDetail) {
                el.diaryWallDetail.innerHTML = emptyMarkup;
            }
            if (el.diaryWallNoteContent) {
                el.diaryWallNoteContent.innerHTML = emptyMarkup;
            }
            return;
        }

        const item = state.detail;
        const detailPreview = buildMarkdownPreview(item.contentMarkdown || '', 960);
        const detailMarkdown = state.detailExpanded ? (item.contentMarkdown || '') : detailPreview.markdown;
        const showExpandToggle = detailPreview.truncated;
        const entryMarkup = Array.isArray(item.entries) && item.entries.length > 0
            ? item.entries.map((entry) => `
                <article class="diary-wall-entry">
                  <div class="diary-wall-entry__header">
                    <strong>${escapeHtml(formatTimestamp(entry.createdAt))}</strong>
                    <span>${escapeHtml(`${entry.requestedToolName || 'DailyNote'}.${entry.requestedCommand || 'create'}`)}</span>
                    ${state.manageMode ? `
                      <span class="diary-wall-entry__actions">
                        <button type="button" class="ghost-button icon-btn" data-diary-wall-edit-entry="${escapeHtml(entry.id)}" data-diary-wall-entry-agent="${escapeHtml(entry.agentId || '')}" data-diary-wall-entry-topic="${escapeHtml(entry.topicId || '')}" aria-label="编辑日记条目">
                          <span class="material-symbols-outlined">edit</span>
                        </button>
                        <button type="button" class="ghost-button icon-btn danger" data-diary-wall-delete-entry="${escapeHtml(entry.id)}" data-diary-wall-entry-agent="${escapeHtml(entry.agentId || '')}" data-diary-wall-entry-topic="${escapeHtml(entry.topicId || '')}" aria-label="删除日记条目">
                          <span class="material-symbols-outlined">delete</span>
                        </button>
                      </span>
                    ` : ''}
                  </div>
                  <div class="diary-wall-entry__meta">${escapeHtml([
                      `[${entry.notebookName || '默认'}]`,
                      entry.subjectSignature || entry.subjectRaw || '未记录主题',
                      entry.topicNameSnapshot || entry.topicId || '未命名话题',
                  ].join(' · '))}</div>
                  <div class="diary-wall-entry__body">${renderMarkdownFragment(entry.contentMarkdown || '')}</div>
                  <div class="diary-wall-entry__tags">${(entry.tags || []).map((tag) => `<button type="button" class="diary-wall-chip diary-wall-chip--button" data-diary-wall-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('')}</div>
                  <div class="diary-wall-entry__sources">${Array.isArray(entry.sourceMessageIds) && entry.sourceMessageIds.length
                        ? entry.sourceMessageIds.map((messageId) => `<button type="button" class="ghost-button icon-text-btn" data-diary-wall-jump="${escapeHtml(messageId)}" data-diary-wall-topic="${escapeHtml(entry.topicId || '')}">
                            <span class="material-symbols-outlined">forum</span> 跳到 ${escapeHtml(messageId)}
                          </button>`).join('')
                        : '<span class="settings-caption">当前没有来源消息 ID。</span>'}</div>
                </article>
            `).join('')
            : '<div class="empty-list-state"><strong>这张日记卡还没有逐条条目</strong><span>通常这表示它还没被写入或筛选条件过严。</span></div>';

        const detailMarkup = `
            <div class="diary-wall-detail__header">
              <div>
                <p class="eyebrow">${escapeHtml(item.dateKey || '未记录日期')}</p>
                <h3>[${escapeHtml(item.notebookName || '默认')}]</h3>
                <p class="settings-caption">${escapeHtml([
                    `${Number(item.entryCount || 0)} 条`,
                    `召回 ${Number(item.recallCount || 0)} 次`,
                    item.subjectSignatures?.length ? item.subjectSignatures.join(' / ') : '',
                ].filter(Boolean).join(' · '))}</p>
              </div>
            </div>
            <div class="diary-wall-detail__section">
              <div class="diary-wall-detail__section-head">
                <strong>${showExpandToggle ? '聚合日记预览' : '聚合日记'}</strong>
                ${showExpandToggle ? `
                    <button type="button" class="ghost-button icon-text-btn diary-wall-detail__toggle" data-diary-wall-toggle-preview>
                      <span class="material-symbols-outlined">${state.detailExpanded ? 'unfold_less' : 'unfold_more'}</span>
                      ${state.detailExpanded ? '收起完整日记' : '展开完整日记'}
                    </button>
                ` : ''}
              </div>
              <div class="diary-wall-detail__markdown ${state.detailExpanded ? '' : 'diary-wall-detail__markdown--preview'}">${renderMarkdownFragment(detailMarkdown || '当前没有聚合日记内容。')}</div>
            </div>
            <div class="diary-wall-detail__section">
              <strong>逐条 DailyNote</strong>
              <div class="diary-wall-entry-list">${entryMarkup}</div>
            </div>
        `;

        if (el.diaryWallDetail) {
            el.diaryWallDetail.innerHTML = detailMarkup;
            bindDetailActions(el.diaryWallDetail);
        }
        if (el.diaryWallNoteContent) {
            el.diaryWallNoteContent.innerHTML = detailMarkup;
            bindDetailActions(el.diaryWallNoteContent);
        }
    }

    async function loadDetail() {
        if (!state.selectedCardKey || typeof chatAPI.getStudyDiaryWallDetail !== 'function') {
            state.detail = null;
            renderDetail();
            return;
        }

        const selectedCard = getVisibleCards().find((card) => buildCardSelectionKey(card) === state.selectedCardKey) || null;
        if (!selectedCard) {
            state.detail = null;
            renderDetail();
            return;
        }

        const currentSelectedItem = getCurrentSelectedItem() || {};
        const detailScope = state.scope === 'topic'
            ? {
                agentId: currentSelectedItem.id || '',
                topicId: getCurrentTopicId() || '',
            }
            : state.scope === 'agent'
                ? {
                    agentId: currentSelectedItem.id || '',
                    topicId: '',
                }
                : {
                    agentId: '',
                    topicId: '',
                };

        const result = await chatAPI.getStudyDiaryWallDetail({
            diaryId: selectedCard.diaryId,
            notebookId: selectedCard.notebookId,
            dateKey: selectedCard.dateKey,
            ...detailScope,
        });
        if (!result?.success) {
            state.detail = null;
            renderDetail();
            ui.showToastNotification(`加载日记详情失败：${result?.error || '未知错误'}`, 'error');
            return;
        }

        state.detail = result.item || null;
        renderDetail();
    }

    async function refresh() {
        if (typeof chatAPI.listStudyDiaryWallCards !== 'function') {
            el.diaryWallCards.innerHTML = `
                <div class="empty-list-state">
                  <strong>日记墙接口不可用</strong>
                  <span>当前 preload 还没有暴露独立日记墙接口。</span>
                </div>
            `;
            return;
        }

        if (state.loadingPromise) {
            return state.loadingPromise;
        }

        state.loadingPromise = chatAPI.listStudyDiaryWallCards(buildRequest());
        let result;
        try {
            result = await state.loadingPromise;
        } finally {
            state.loadingPromise = null;
        }
        if (!result?.success) {
            ui.showToastNotification(`加载日记墙失败：${result?.error || '未知错误'}`, 'error');
            state.cards = [];
            state.selectedCardKey = '';
            state.detail = null;
            renderSummary();
            renderCards();
            renderDetail();
            return;
        }

        const previousCard = getCardByKey(state.selectedCardKey);
        const previousDiaryId = previousCard?.diaryId || '';
        state.cards = Array.isArray(result.items) ? result.items : [];
        state.lastLoadedAt = Date.now();
        const tabs = getAgentTabs();
        if (!tabs.some((tab) => tab.id === state.activeAgentFilter)) {
            state.activeAgentFilter = 'all';
        }
        if (previousDiaryId && !getCardByKey(state.selectedCardKey)) {
            const nextSelectedCard = getVisibleCards().find((card) => card.diaryId === previousDiaryId);
            state.selectedCardKey = nextSelectedCard ? buildCardSelectionKey(nextSelectedCard) : '';
        }
        syncSelectedDiary();
        state.detailExpanded = false;
        renderAgentNav();
        renderSummary();
        renderCards();
        state.detail = null;
        renderDetail();
    }

    function open(options = {}) {
        state.open = true;
        onOpen();
        el.diaryWallModal?.classList.remove('hidden');
        el.diaryWallModal?.setAttribute('aria-hidden', 'false');
        if (!isEmbeddedPanel()) {
            documentObj.body.classList.add('diary-wall-open');
        }
        if (el.diaryWallScopeSelect) {
            el.diaryWallScopeSelect.value = state.scope;
        }
        if (state.cards.length > 0 && options.forceRefresh !== true) {
            syncSelectedDiary();
            renderAgentNav();
            renderSummary();
            renderCards();
            return;
        }
        void refresh();
    }

    function close(options = {}) {
        state.open = false;
        closeNoteModal();
        el.diaryWallModal?.classList.add('hidden');
        el.diaryWallModal?.setAttribute('aria-hidden', 'true');
        if (!isEmbeddedPanel()) {
            documentObj.body.classList.remove('diary-wall-open');
        }
        if (options.skipCallback !== true) {
            onClose();
        }
    }

    async function jumpToMessage(messageId, topicId = '') {
        if (!messageId) {
            return;
        }

        if (topicId && topicId !== getCurrentTopicId()) {
            await selectTopic(topicId);
        }

        showSubjectWorkspace();
        const selector = `.message-item[data-message-id="${escapeSelectorValue(messageId)}"]`;
        const locate = () => documentObj.querySelector(selector);
        let node = locate();
        if (!node) {
            await new Promise((resolve) => setTimeout(resolve, 120));
            node = locate();
        }

        if (!node) {
            ui.showToastNotification('当前聊天页没有找到这条来源消息，请先切换到对应话题后再试。', 'warning');
            return;
        }

        close({ skipCallback: true });
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node.classList.add('message-item--logs-highlight');
        setTimeout(() => node.classList.remove('message-item--logs-highlight'), 1600);
    }

    function bindEvents() {
        el.openDiaryWallBtn?.addEventListener('click', open);
        el.diaryWallCloseBtn?.addEventListener('click', close);
        el.diaryWallModalBackdrop?.addEventListener('click', close);
        el.diaryWallScopeSelect?.addEventListener('change', () => {
            state.scope = el.diaryWallScopeSelect.value || 'global';
            state.selectedCardKey = '';
            void refresh();
        });
        el.diaryWallRefreshBtn?.addEventListener('click', () => {
            void refresh();
        });
        el.diaryWallEditBtn?.addEventListener('click', () => {
            state.manageMode = !state.manageMode;
            state.selectedCardKeys.clear();
            renderSummary();
            renderCards();
            renderDetail();
        });
        el.diaryWallAgentNav?.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target.closest('[data-diary-wall-agent-filter]') : null;
            if (!target) {
                return;
            }
            const nextFilter = target.getAttribute('data-diary-wall-agent-filter') || 'all';
            if (state.activeAgentFilter === nextFilter) {
                return;
            }
            state.activeAgentFilter = nextFilter;
            syncSelectedDiary();
            renderAgentNav();
            renderSummary();
            renderCards();
            void loadDetail();
        });
        [el.diaryWallSearchInput, el.diaryWallNotebookInput, el.diaryWallTagInput, el.diaryWallDateInput].forEach((node) => {
            node?.addEventListener(node === el.diaryWallDateInput ? 'change' : 'input', () => {
                void refresh();
            });
        });
        el.diaryWallCards?.addEventListener('click', (event) => {
            const actionTarget = event.target instanceof Element ? event.target : null;
            const deleteSelectedButton = actionTarget?.closest('[data-diary-wall-delete-selected]');
            if (deleteSelectedButton) {
                void deleteSelectedCards();
                return;
            }
            if (actionTarget?.closest('[data-diary-wall-toggle-all]')) {
                const visibleCards = getVisibleCards();
                const allVisibleSelected = visibleCards.length > 0
                    && visibleCards.every((card) => state.selectedCardKeys.has(buildCardSelectionKey(card)));
                visibleCards.forEach((card) => setCardSelected(buildCardSelectionKey(card), !allVisibleSelected));
                renderSummary();
                renderCards();
                return;
            }
            if (actionTarget?.closest('[data-diary-wall-exit-manage]')) {
                state.manageMode = false;
                state.selectedCardKeys.clear();
                renderSummary();
                renderCards();
                renderDetail();
                return;
            }
            const checkbox = actionTarget?.closest('[data-diary-wall-card-select]');
            if (checkbox) {
                const key = checkbox.getAttribute('data-diary-wall-card-select') || '';
                const isCheckboxInput = checkbox.tagName === 'INPUT' && checkbox.type === 'checkbox';
                setCardSelected(key, isCheckboxInput ? Boolean(checkbox.checked) : !state.selectedCardKeys.has(key));
                renderSummary();
                renderCards();
                return;
            }
            const openButton = actionTarget?.closest('[data-diary-wall-manage-open]');
            if (openButton) {
                void openCardDetail(getCardByKey(openButton.getAttribute('data-diary-wall-manage-open') || ''));
                return;
            }
            const deleteButton = actionTarget?.closest('[data-diary-wall-delete-card]');
            if (deleteButton) {
                void deleteCard(getCardByKey(deleteButton.getAttribute('data-diary-wall-delete-card') || ''));
                return;
            }
            const target = event.target instanceof Element ? event.target.closest('[data-diary-wall-card]') : null;
            if (!target) {
                return;
            }
            if (state.manageMode) {
                toggleCardSelected(target.getAttribute('data-diary-wall-card') || '');
                renderSummary();
                renderCards();
                return;
            }
            state.selectedCardKey = target.getAttribute('data-diary-wall-card') || '';
            state.detailExpanded = false;
            renderCards();
            void loadDetail().then(() => {
                if (state.detail) {
                    openNoteModal();
                }
            });
        });
        el.diaryWallNoteCloseBtn?.addEventListener('click', closeNoteModal);
        el.diaryWallNoteModalBackdrop?.addEventListener('click', closeNoteModal);
        el.diaryWallNoteContent?.addEventListener('submit', (event) => {
            const form = event.target instanceof Element ? event.target.closest('[data-diary-wall-entry-editor]') : null;
            if (!form) {
                return;
            }
            event.preventDefault();
            void saveEntryEditor(form);
        });
        el.diaryWallNoteContent?.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest('[data-diary-wall-cancel-entry-edit]')) {
                state.editingEntry = null;
                renderDetail();
                return;
            }
            if (target?.closest('[data-diary-wall-delete-current-entry]') && state.editingEntry) {
                void deleteEntry({
                    agentId: state.editingEntry.agentId,
                    topicId: state.editingEntry.topicId,
                    entryId: state.editingEntry.id,
                });
            }
        });
        documentObj.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && state.noteModalOpen) {
                closeNoteModal();
                return;
            }
            if (event.key === 'Escape' && state.open && !isEmbeddedPanel()) {
                close();
            }
        });
    }

    return {
        bindEvents,
        close,
        open,
        refresh,
    };
}

export {
    createDiaryWallController,
};
