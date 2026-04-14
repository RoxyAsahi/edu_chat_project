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

    const maidNames = Array.isArray(card.maidSignatures)
        ? card.maidSignatures.map((name) => String(name || '').trim()).filter(Boolean)
        : [];
    if (maidNames.length > 0) {
        return maidNames;
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

    const state = {
        open: false,
        scope: 'global',
        cards: [],
        activeAgentFilter: 'all',
        selectedDiaryId: '',
        detail: null,
        detailExpanded: false,
    };

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
        if (!state.selectedDiaryId || !visibleCards.some((item) => item.diaryId === state.selectedDiaryId)) {
            state.selectedDiaryId = visibleCards[0]?.diaryId || '';
        }
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
                limit: 120,
            };
        }

        if (state.scope === 'agent') {
            return {
                scope: 'agent',
                agentId: currentSelectedItem.id || '',
                topicId: '',
                ...filters,
                limit: 120,
            };
        }

        if (state.scope === 'public') {
            return {
                scope: 'global',
                agentId: '',
                topicId: '',
                ...filters,
                notebookName: '公共',
                limit: 120,
            };
        }

        return {
            scope: 'global',
            agentId: '',
            topicId: '',
            ...filters,
            limit: 120,
        };
    }

    function renderSummary() {
        if (!el.diaryWallSummary) {
            return;
        }

        const visibleCards = getVisibleCards();
        const uniqueNotebooks = [...new Set(visibleCards.map((item) => item.notebookName).filter(Boolean))];
        const uniqueAgents = [...new Set(visibleCards.flatMap((item) => getCardAgentNames(item)))];
        const latest = [...visibleCards].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0];
        const currentSelectedItem = getCurrentSelectedItem() || {};
        const currentTopicName = getCurrentTopicName() || getCurrentTopicId() || '当前话题';
        const scopeLabel = state.scope === 'topic'
            ? `当前话题 · ${currentSelectedItem.name || '未选择学科'} / ${currentTopicName}`
            : state.scope === 'agent'
                ? `当前学科 · ${currentSelectedItem.name || '未选择学科'}`
                : state.scope === 'public'
                    ? '[公共] 日记本'
                    : '全局所有日记';
        const filterLabel = state.activeAgentFilter === 'all' ? '全部' : state.activeAgentFilter;

        el.diaryWallSummary.innerHTML = `
            <div class="diary-wall-summary">
              <strong>${escapeHtml(scopeLabel)}</strong>
              <span>当前 Agent：${escapeHtml(filterLabel)}</span>
              <span>卡片数：${escapeHtml(String(visibleCards.length))}</span>
              <span>Agent 分组：${escapeHtml(String(uniqueAgents.length || groupCardsByAgent(state.cards).length))}</span>
              <span>日记本：${escapeHtml(String(uniqueNotebooks.length))}</span>
              <span>最近更新：${escapeHtml(latest ? formatTimestamp(latest.updatedAt) : '未记录')}</span>
              <span>最近日记本：${escapeHtml(latest?.notebookName || '未记录')}</span>
            </div>
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

        const groups = groupCardsByAgent(visibleCards);
        el.diaryWallCards.innerHTML = groups.map((group) => `
            <section class="diary-wall-group" data-diary-wall-group="${escapeHtml(group.label)}">
              <div class="diary-wall-group__header">
                <strong>${escapeHtml(group.label)}</strong>
                <span>${escapeHtml(`${group.items.length} 张日记卡`)}</span>
              </div>
              <div class="diary-wall-group__grid">
                ${group.items.map((card) => `
                    <button type="button" class="diary-wall-card ${card.diaryId === state.selectedDiaryId ? 'diary-wall-card--active' : ''}" data-diary-wall-card="${escapeHtml(card.diaryId)}">
                      <div class="diary-wall-card__meta">
                        <span>${escapeHtml(card.dateKey)}</span>
                        <span>[${escapeHtml(card.notebookName || '默认')}]</span>
                      </div>
                      <h3>${escapeHtml(buildCardTitle(card))}</h3>
                      <div class="diary-wall-card__summary diary-wall-markdown-preview">${renderMarkdownFragment(
                          buildMarkdownPreview(card.previewMarkdown || card.contentMarkdown || '', 280).markdown || '查看这张日记卡的聚合摘要。'
                      )}</div>
                      <div class="diary-wall-card__stats">${escapeHtml([
                          getCardAgentNames(card).join(' / '),
                          `${Number(card.entryCount || 0)} 条`,
                          `召回 ${Number(card.recallCount || 0)} 次`,
                          card.maidSignatures?.length ? card.maidSignatures.slice(0, 2).join(' / ') : '',
                      ].filter(Boolean).join(' · '))}</div>
                      <div class="diary-wall-card__tags">${(card.tags || []).slice(0, 6).map((tag) => `<span class="diary-wall-chip">#${escapeHtml(tag)}</span>`).join('')}</div>
                    </button>
                `).join('')}
              </div>
            </section>
        `).join('');
    }

    function renderDetail() {
        if (!el.diaryWallDetail) {
            return;
        }

        if (!state.detail) {
            el.diaryWallDetail.innerHTML = `
                <div class="empty-list-state">
                  <strong>选择一张日记卡</strong>
                  <span>右侧会展示完整聚合日记、来源条目和原始 DailyNote 请求。</span>
                </div>
            `;
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
                  </div>
                  <div class="diary-wall-entry__meta">${escapeHtml([
                      `[${entry.notebookName || '默认'}]`,
                      entry.maidSignature || entry.maidRaw || '未记录署名',
                      entry.topicNameSnapshot || entry.topicId || '未命名话题',
                  ].join(' · '))}</div>
                  <div class="diary-wall-entry__body">${renderMarkdownFragment(entry.contentMarkdown || '')}</div>
                  <div class="diary-wall-entry__tags">${(entry.tags || []).map((tag) => `<button type="button" class="diary-wall-chip diary-wall-chip--button" data-diary-wall-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('')}</div>
                  <details class="diary-wall-entry__tool">
                    <summary>原始 DailyNote 请求</summary>
                    <pre>${escapeHtml(JSON.stringify(entry.toolRequest || {}, null, 2))}</pre>
                  </details>
                  <div class="diary-wall-entry__sources">${Array.isArray(entry.sourceMessageIds) && entry.sourceMessageIds.length
                        ? entry.sourceMessageIds.map((messageId) => `<button type="button" class="ghost-button icon-text-btn" data-diary-wall-jump="${escapeHtml(messageId)}" data-diary-wall-topic="${escapeHtml(entry.topicId || '')}">
                            <span class="material-symbols-outlined">forum</span> 跳到 ${escapeHtml(messageId)}
                          </button>`).join('')
                        : '<span class="settings-caption">当前没有来源消息 ID。</span>'}</div>
                </article>
            `).join('')
            : '<div class="empty-list-state"><strong>这张日记卡还没有逐条条目</strong><span>通常这表示它还没被写入或筛选条件过严。</span></div>';

        el.diaryWallDetail.innerHTML = `
            <div class="diary-wall-detail__header">
              <div>
                <p class="eyebrow">${escapeHtml(item.dateKey || '未记录日期')}</p>
                <h3>[${escapeHtml(item.notebookName || '默认')}]</h3>
                <p class="settings-caption">${escapeHtml([
                    `${Number(item.entryCount || 0)} 条`,
                    `召回 ${Number(item.recallCount || 0)} 次`,
                    item.maidSignatures?.length ? item.maidSignatures.join(' / ') : '',
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

        el.diaryWallDetail.querySelectorAll('[data-diary-wall-tag]').forEach((button) => {
            button.addEventListener('click', () => {
                if (el.diaryWallTagInput) {
                    el.diaryWallTagInput.value = button.getAttribute('data-diary-wall-tag') || '';
                }
                void refresh();
            });
        });
        el.diaryWallDetail.querySelectorAll('[data-diary-wall-jump]').forEach((button) => {
            button.addEventListener('click', () => {
                void jumpToMessage(
                    button.getAttribute('data-diary-wall-jump') || '',
                    button.getAttribute('data-diary-wall-topic') || ''
                );
            });
        });
        el.diaryWallDetail.querySelector('[data-diary-wall-toggle-preview]')?.addEventListener('click', () => {
            state.detailExpanded = !state.detailExpanded;
            renderDetail();
        });
    }

    async function loadDetail() {
        if (!state.selectedDiaryId || typeof chatAPI.getStudyDiaryWallDetail !== 'function') {
            state.detail = null;
            renderDetail();
            return;
        }

        const selectedCard = getVisibleCards().find((card) => card.diaryId === state.selectedDiaryId) || null;
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

        const result = await chatAPI.listStudyDiaryWallCards(buildRequest());
        if (!result?.success) {
            ui.showToastNotification(`加载日记墙失败：${result?.error || '未知错误'}`, 'error');
            state.cards = [];
            state.selectedDiaryId = '';
            state.detail = null;
            renderSummary();
            renderCards();
            renderDetail();
            return;
        }

        state.cards = Array.isArray(result.items) ? result.items : [];
        const tabs = getAgentTabs();
        if (!tabs.some((tab) => tab.id === state.activeAgentFilter)) {
            state.activeAgentFilter = 'all';
        }
        syncSelectedDiary();
        state.detailExpanded = false;
        renderAgentNav();
        renderSummary();
        renderCards();
        await loadDetail();
    }

    function open() {
        state.open = true;
        el.diaryWallModal?.classList.remove('hidden');
        el.diaryWallModal?.setAttribute('aria-hidden', 'false');
        documentObj.body.classList.add('diary-wall-open');
        if (el.diaryWallScopeSelect) {
            el.diaryWallScopeSelect.value = state.scope;
        }
        void refresh();
    }

    function close() {
        state.open = false;
        el.diaryWallModal?.classList.add('hidden');
        el.diaryWallModal?.setAttribute('aria-hidden', 'true');
        documentObj.body.classList.remove('diary-wall-open');
    }

    async function jumpToMessage(messageId, topicId = '') {
        if (!messageId) {
            return;
        }

        if (topicId && topicId !== getCurrentTopicId()) {
            await selectTopic(topicId);
        }

        const selector = `.message-item[data-message-id="${escapeSelectorValue(messageId)}"]`;
        const locate = () => documentObj.querySelector(selector);
        let node = locate();
        if (!node) {
            await new Promise((resolve) => setTimeout(resolve, 120));
            node = locate();
        }

        if (!node) {
            await openLogsPanel();
            ui.showToastNotification('当前聊天页没有找到这条来源消息，已帮你切到 Logs。', 'warning');
            return;
        }

        close();
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
            state.selectedDiaryId = '';
            void refresh();
        });
        el.diaryWallRefreshBtn?.addEventListener('click', () => {
            void refresh();
        });
        el.diaryWallOpenLogsBtn?.addEventListener('click', () => {
            close();
            void openLogsPanel();
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
            const target = event.target instanceof Element ? event.target.closest('[data-diary-wall-card]') : null;
            if (!target) {
                return;
            }
            state.selectedDiaryId = target.getAttribute('data-diary-wall-card') || '';
            state.detailExpanded = false;
            renderCards();
            void loadDetail();
        });
        documentObj.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && state.open) {
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
