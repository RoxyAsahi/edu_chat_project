function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getAgentMonogram(agent) {
    return 'school';
}

function buildSubjectOverviewMarkup({ agents = [], statsByAgent = {}, selectedAgentId = null } = {}) {
    const hasAgents = agents.length > 0;
    const headline = hasAgents ? '学科总视图' : '创建你的第一个学科';
    const summary = hasAgents ? '选择一个学科继续你的学习。' : 'Ready to start';

    const totalTopics = agents.reduce((sum, agent) => sum + Number(statsByAgent[agent.id]?.topicCount || 0), 0);
    const totalUnread = agents.reduce((sum, agent) => sum + Number(statsByAgent[agent.id]?.unreadCount || 0), 0);

    const clockMarkup = `
        <section class="overview-clock-panel" aria-label="当前时间">
            <div id="overviewClockTime">00:00</div>
        </section>
    `;
    const statsRowMarkup = `
        <section class="overview-stats-row" aria-label="学科概览统计">
            <article class="overview-stat-card">
                <span class="overview-stat-card__label">学科</span>
                <strong>${agents.length}</strong>
            </article>
            <article class="overview-stat-card overview-stat-card--accent">
                <span class="overview-stat-card__label">话题</span>
                <strong>${totalTopics}</strong>
            </article>
            <article class="overview-stat-card overview-stat-card--warm">
                <span class="overview-stat-card__label">待处理</span>
                <strong>${totalUnread}</strong>
            </article>
        </section>
    `;

    const cardsMarkup = agents.map((agent) => {
        const stats = statsByAgent[agent.id] || {};
        const isActive = agent.id === selectedAgentId;
        const topicCount = Number(stats.topicCount || 0);
        const unreadCount = Number(stats.unreadCount || 0);
        const lastTopicName = stats.lastTopicName || '尚未创建话题';
        const statusText = isActive
            ? (unreadCount > 0 ? `当前学科，还有 ${unreadCount} 项内容待处理` : '当前学科，已经做好学习准备')
            : (unreadCount > 0 ? `还有 ${unreadCount} 项内容待处理` : '可以继续开始新的学习');

        return `
            <article class="subject-overview-card ${isActive ? 'subject-overview-card--active' : ''}" data-subject-card data-agent-id="${escapeHtml(agent.id)}">
                <div class="subject-overview-card__topline">
                    <span class="subject-overview-card__icon">
                        <span class="material-symbols-outlined">${getAgentMonogram(agent)}</span>
                    </span>
                    ${isActive ? '<span class="subject-overview-card__badge">当前</span>' : ''}
                    <button
                        type="button"
                        class="subject-overview-card__delete"
                        data-delete-subject-card
                        data-agent-id="${escapeHtml(agent.id)}"
                        data-agent-name="${escapeHtml(agent.name || agent.id)}"
                        aria-label="删除"
                        title="删除学科"
                    >
                        <span class="material-symbols-outlined">more_vert</span>
                    </button>
                </div>
                <div class="subject-overview-card__body">
                    <strong>${escapeHtml(agent.name || agent.id)}</strong>
                    <p>${escapeHtml(statusText)}</p>
                </div>
                <div class="subject-overview-card__meta">
                    <span class="subject-overview-card__chip">${topicCount} 个话题</span>
                    <span class="subject-overview-card__chip">话题数量</span>
                    <span class="subject-overview-card__chip">待处理的数量</span>
                </div>
                <div class="subject-overview-card__footer">
                    <span class="subject-overview-card__footer-label">最近话题：${escapeHtml(lastTopicName)}</span>
                </div>
            </article>
        `;
    }).join('');

    const createCardMarkup = `
        <button type="button" class="subject-overview-create-card" id="subjectOverviewCreateCard">
            <div class="subject-overview-create-card__inner">
                <span class="subject-overview-create-card__icon material-symbols-outlined">add</span>
                <strong>新建学科</strong>
            </div>
        </button>
    `;

    const emptyMarkup = `
        <article class="subject-overview-empty">
            <span class="subject-overview-empty__eyebrow">Ready to start</span>
            <strong>创建你的第一个学科</strong>
            <p>从一个学科开始整理你的学习内容和话题。</p>
        </article>
    `;

    return {
        headline,
        summary,
        clockMarkup,
        statsRowMarkup,
        gridMarkup: `<section class="overview-subject-wall" aria-label="学科卡片墙">${hasAgents ? cardsMarkup : emptyMarkup}${createCardMarkup}</section>`,
    };
}

export { buildSubjectOverviewMarkup };
