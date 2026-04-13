function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getAgentMonogram(agent) {
    const source = String(agent?.name || agent?.id || 'US').trim();
    if (!source) {
        return 'US';
    }

    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
    }

    return source.slice(0, 2).toUpperCase();
}

function formatSubjectStatus(stats = {}, isActive = false) {
    const topicCount = Number(stats.topicCount || 0);
    const unreadCount = Number(stats.unreadCount || 0);
    if (topicCount === 0) {
        return isActive ? '当前学科，等待创建第一个话题' : '尚未创建学习话题';
    }
    if (unreadCount > 0) {
        return `${unreadCount} 个待处理话题`;
    }
    if (isActive) {
        return '当前学科工作台';
    }
    return '已准备好进入学习';
}

function getSubjectState(stats = {}, isActive = false) {
    const topicCount = Number(stats.topicCount || 0);
    const unreadCount = Number(stats.unreadCount || 0);

    if (isActive) {
        return 'active';
    }
    if (unreadCount > 0) {
        return 'attention';
    }
    if (topicCount === 0) {
        return 'empty';
    }
    return 'ready';
}

function buildSubjectOverviewMarkup({ agents = [], statsByAgent = {}, selectedAgentId = null } = {}) {
    const totalTopics = agents.reduce((sum, agent) => sum + Number(statsByAgent[agent.id]?.topicCount || 0), 0);
    const totalUnread = agents.reduce((sum, agent) => sum + Number(statsByAgent[agent.id]?.unreadCount || 0), 0);
    const activeAgent = agents.find((agent) => agent.id === selectedAgentId) || null;
    const headline = agents.length > 0 ? '学科总视图' : '创建你的第一个学科';
    const summary = activeAgent
        ? `继续管理 ${activeAgent.name || activeAgent.id}，或从下方切换到其他学科。`
        : '把不同学科整理成独立工作台，在这里快速切换学习上下文。';

    const heroMarkup = `
        <article class="overview-hero-card">
            <div class="overview-hero-card__eyebrow">Overview</div>
            <div class="overview-hero-card__content">
                <h2>${escapeHtml(headline)}</h2>
                <p>${escapeHtml(summary)}</p>
            </div>
            <div class="overview-hero-card__stats" aria-label="学科总览统计">
                <div class="overview-stat-pill">
                    <span class="overview-stat-pill__label">学科</span>
                    <strong>${agents.length}</strong>
                </div>
                <div class="overview-stat-pill overview-stat-pill--warm">
                    <span class="overview-stat-pill__label">话题</span>
                    <strong>${totalTopics}</strong>
                </div>
                <div class="overview-stat-pill overview-stat-pill--accent">
                    <span class="overview-stat-pill__label">待处理</span>
                    <strong>${totalUnread}</strong>
                </div>
            </div>
        </article>
    `;

    const cardsMarkup = agents.length > 0
        ? agents.map((agent) => {
            const stats = statsByAgent[agent.id] || {};
            const isActive = agent.id === selectedAgentId;
            const topicCount = Number(stats.topicCount || 0);
            const unreadCount = Number(stats.unreadCount || 0);
            const lastTopicName = stats.lastTopicName || '';
            const cardState = getSubjectState(stats, isActive);
            const statusChips = [
                isActive ? '<span class="subject-overview-card__chip subject-overview-card__chip--selected">当前学科</span>' : '',
                unreadCount > 0 ? `<span class="subject-overview-card__chip subject-overview-card__chip--attention">${unreadCount} 个待处理</span>` : '',
                topicCount === 0 ? '<span class="subject-overview-card__chip">待创建话题</span>' : `<span class="subject-overview-card__chip">${topicCount} 个话题</span>`,
            ].filter(Boolean).join('');

            return `
                <button
                    type="button"
                    class="subject-overview-card subject-overview-card--${cardState} ${isActive ? 'is-active' : ''}"
                    data-subject-card
                    data-agent-id="${escapeHtml(agent.id)}"
                    aria-label="进入 ${escapeHtml(agent.name || agent.id)} 学科"
                >
                    <div class="subject-overview-card__topline">
                        <span class="subject-overview-card__monogram" aria-hidden="true">${escapeHtml(getAgentMonogram(agent))}</span>
                        ${isActive ? '<span class="subject-overview-card__badge">当前</span>' : ''}
                    </div>
                    <div class="subject-overview-card__body">
                        <strong>${escapeHtml(agent.name || agent.id)}</strong>
                        <p>${escapeHtml(formatSubjectStatus(stats, isActive))}</p>
                    </div>
                    <div class="subject-overview-card__chips">
                        ${statusChips}
                    </div>
                    <div class="subject-overview-card__meta" aria-label="学科摘要">
                        <span class="subject-overview-card__meta-item">
                            <span class="subject-overview-card__meta-label">话题</span>
                            <strong>${topicCount}</strong>
                        </span>
                        <span class="subject-overview-card__meta-item">
                            <span class="subject-overview-card__meta-label">待处理</span>
                            <strong>${unreadCount}</strong>
                        </span>
                    </div>
                    <div class="subject-overview-card__footer">
                        <span class="subject-overview-card__footer-label">
                            ${escapeHtml(lastTopicName ? `最近话题：${lastTopicName}` : '点击进入学科工作台')}
                        </span>
                        <span class="material-symbols-outlined">arrow_outward</span>
                    </div>
                </button>
            `;
        }).join('')
        : `
            <article class="subject-overview-empty">
                <span class="subject-overview-empty__icon material-symbols-outlined">school</span>
                <span class="subject-overview-empty__eyebrow">Ready to start</span>
                <strong>还没有学科工作台</strong>
                <p>创建一个学科后，你就可以把话题、来源、对话和笔记组织到独立的学习空间中。</p>
            </article>
        `;

    const createCardMarkup = `
        <button type="button" class="subject-overview-create-card" id="subjectOverviewCreateCard">
            <span class="subject-overview-create-card__icon material-symbols-outlined">add</span>
            <span class="subject-overview-create-card__eyebrow">New subject</span>
            <strong>新建学科</strong>
            <p>为新的学习方向创建一个独立工作台。</p>
        </button>
    `;

    return {
        headline,
        summary,
        heroMarkup,
        gridMarkup: `${cardsMarkup}${createCardMarkup}`,
    };
}

export {
    buildSubjectOverviewMarkup,
};
