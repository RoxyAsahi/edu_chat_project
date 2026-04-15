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
        return isActive ? `当前学科，还有 ${unreadCount} 项内容待处理` : `还有 ${unreadCount} 项内容待处理`;
    }
    if (isActive) {
        return '当前学科，已经做好学习准备';
    }
    return '已经做好学习准备';
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
    const headline = agents.length > 0 ? '学科总视图' : '创建你的第一个学科';
    const summary = agents.length > 0
        ? '选择一个学科继续你的学习。'
        : '创建一个学科后，你就可以开始组织自己的学习空间。';

    const clockMarkup = `
        <section class="overview-clock-panel" aria-label="当前时间">
            <div class="overview-clock-panel__face">
                <div id="overviewClockDate" class="overview-clock-panel__date">4月15日 星期三</div>
                <div id="overviewClockTime" class="overview-clock-panel__time">00:00</div>
            </div>
        </section>
    `;

    const statsRowMarkup = `
        <section class="overview-stats-row" aria-label="学科总览统计">
            <article class="overview-stat-card">
                <span class="overview-stat-card__label">学科</span>
                <strong>${agents.length}</strong>
            </article>
            <article class="overview-stat-card overview-stat-card--warm">
                <span class="overview-stat-card__label">话题</span>
                <strong>${totalTopics}</strong>
            </article>
            <article class="overview-stat-card overview-stat-card--accent">
                <span class="overview-stat-card__label">待处理</span>
                <strong>${totalUnread}</strong>
            </article>
        </section>
    `;

    const cardsMarkup = agents.length > 0
        ? agents.map((agent) => {
            const stats = statsByAgent[agent.id] || {};
            const isActive = agent.id === selectedAgentId;
            const topicCount = Number(stats.topicCount || 0);
            const unreadCount = Number(stats.unreadCount || 0);
            const lastTopicName = stats.lastTopicName || '';
            const cardState = getSubjectState(stats, isActive);

            return `
                <article
                    class="subject-overview-card subject-overview-card--${cardState} ${isActive ? 'is-active' : ''}"
                    aria-label="${escapeHtml(agent.name || agent.id)} 学科卡片"
                >
                    <div class="subject-overview-card__topline">
                        <span class="subject-overview-card__monogram" aria-hidden="true">${escapeHtml(getAgentMonogram(agent))}</span>
                        <div class="subject-overview-card__actions">
                            ${isActive ? '<span class="subject-overview-card__badge">当前</span>' : ''}
                            <button
                                type="button"
                                class="subject-overview-card__delete"
                                data-delete-subject-card
                                data-agent-id="${escapeHtml(agent.id)}"
                                data-agent-name="${escapeHtml(agent.name || agent.id)}"
                                aria-label="删除 ${escapeHtml(agent.name || agent.id)} 学科"
                                title="删除此学科及其全部内容"
                            >
                                <span class="material-symbols-outlined" aria-hidden="true">delete</span>
                            </button>
                        </div>
                    </div>
                    <button
                        type="button"
                        class="subject-overview-card__action"
                        data-subject-card
                        data-agent-id="${escapeHtml(agent.id)}"
                        aria-label="进入 ${escapeHtml(agent.name || agent.id)} 学科"
                    >
                        <div class="subject-overview-card__body">
                            <strong>${escapeHtml(agent.name || agent.id)}</strong>
                            <p>${escapeHtml(formatSubjectStatus(stats, isActive))}</p>
                        </div>
                        <div class="subject-overview-card__chips">
                            <span class="subject-overview-card__chip">${topicCount} 个话题</span>
                        </div>
                        <div class="subject-overview-card__meta" aria-label="学科摘要">
                            <span class="subject-overview-card__meta-item">
                                <span class="subject-overview-card__meta-label">话题数量</span>
                                <strong>${topicCount}</strong>
                            </span>
                            <span class="subject-overview-card__meta-item">
                                <span class="subject-overview-card__meta-label">待处理的数量</span>
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
                </article>
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
        clockMarkup,
        statsRowMarkup,
        gridMarkup: `<section class="overview-subject-wall" aria-label="学科卡片墙">${cardsMarkup}${createCardMarkup}</section>`,
    };
}

export {
    buildSubjectOverviewMarkup,
};
