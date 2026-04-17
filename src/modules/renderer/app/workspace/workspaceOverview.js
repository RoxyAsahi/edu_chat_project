function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getAgentAccent(agentId = '') {
    const colors = ['#4285f4', '#ea4335', '#fbbc04', '#34a853', '#673ab7', '#e91e63'];
    let charCode = 0;
    const id = String(agentId || '');
    for (let index = 0; index < id.length; index += 1) {
        charCode += id.charCodeAt(index);
    }
    return colors[charCode % colors.length];
}

function buildClockMarkup() {
    return `
        <section class="overview-clock-panel" aria-label="当前时间">
            <div class="overview-clock-panel__face">
                <span class="overview-clock-panel__label">当前时间</span>
                <strong id="overviewClockTime" class="overview-clock-panel__time">00:00</strong>
                <span id="overviewClockDate" class="overview-clock-panel__date">4月17日 星期四</span>
            </div>
        </section>
    `;
}

function buildStatsRowMarkup(stats = {}) {
    const subjects = Number(stats.subjectCount || 0);
    const topics = Number(stats.topicCount || 0);
    const pending = Number(stats.pendingCount || 0);

    return `
        <section class="overview-stats-row" aria-label="首页概览摘要">
            <article class="overview-stat-card">
                <span class="overview-stat-card__label">学科</span>
                <strong>${subjects}</strong>
            </article>
            <article class="overview-stat-card overview-stat-card--warm">
                <span class="overview-stat-card__label">话题</span>
                <strong>${topics}</strong>
            </article>
            <article class="overview-stat-card overview-stat-card--accent">
                <span class="overview-stat-card__label">待处理</span>
                <strong>${pending}</strong>
            </article>
        </section>
    `;
}

function buildHeroSummaryCard(headline, summary) {
    return `
        <article class="overview-hero-card overview-hero-card--summary">
            <span class="overview-hero-card__eyebrow">Overview</span>
            <strong class="overview-hero-card__title">${escapeHtml(headline)}</strong>
            <p class="overview-hero-card__summary">${escapeHtml(summary)}</p>
        </article>
    `;
}

function buildFocusedAgentCard(agent, stats) {
    if (!agent) {
        return `
            <article class="overview-hero-card overview-hero-card--current">
                <span class="overview-hero-card__eyebrow">当前学科</span>
                <strong class="overview-hero-card__title">还没有学科</strong>
                <p class="overview-hero-card__summary">先创建一个学习方向，首页就会在这里显示你的当前学科概览。</p>
            </article>
        `;
    }

    const topicCount = Number(stats?.topicCount || 0);
    const unreadCount = Number(stats?.unreadCount || 0);
    const lastTopicName = stats?.lastTopicName || '尚未创建话题';
    const accent = getAgentAccent(agent.id);
    const statusText = unreadCount > 0
        ? `当前有 ${unreadCount} 个待处理话题`
        : '当前学科已经做好学习准备';

    return `
        <article class="overview-hero-card overview-hero-card--current subject-overview-card is-active" data-subject-card data-agent-id="${escapeHtml(agent.id)}">
            <div class="overview-hero-card__topline">
                <span class="overview-hero-card__pill" style="--overview-pill-accent: ${accent};">当前</span>
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
            <span class="overview-hero-card__eyebrow">当前学科</span>
            <strong class="overview-hero-card__title">${escapeHtml(agent.name || agent.id)}</strong>
            <p class="overview-hero-card__summary">${escapeHtml(statusText)}</p>
            <div class="overview-hero-card__stats">
                <span class="overview-hero-card__stat">
                    <span class="overview-hero-card__stat-label">当前学科</span>
                    <strong>${escapeHtml(agent.name || agent.id)}</strong>
                </span>
                <span class="overview-hero-card__stat">
                    <span class="overview-hero-card__stat-label">话题</span>
                    <strong>${topicCount}</strong>
                </span>
                <span class="overview-hero-card__stat">
                    <span class="overview-hero-card__stat-label">待处理</span>
                    <strong>${unreadCount}</strong>
                </span>
            </div>
            <div class="overview-hero-card__footer">
                <span>最近话题：${escapeHtml(lastTopicName)}</span>
                <span class="material-symbols-outlined" aria-hidden="true">arrow_outward</span>
            </div>
        </article>
    `;
}

function buildCreateCardMarkup() {
    return `
        <button type="button" class="overview-hero-card overview-hero-card--create subject-overview-create-card" id="subjectOverviewCreateCard">
            <div class="subject-overview-create-card__inner">
                <span class="subject-overview-create-card__icon material-symbols-outlined">add</span>
                <span class="overview-hero-card__eyebrow">New Subject</span>
                <strong class="overview-hero-card__title">新建学科</strong>
                <p class="overview-hero-card__summary">为新的学习方向创建一个独立工作台。</p>
            </div>
        </button>
    `;
}

function buildAgentWallCard(agent, stats, isActive) {
    const topicCount = Number(stats?.topicCount || 0);
    const unreadCount = Number(stats?.unreadCount || 0);
    const lastTopicName = stats?.lastTopicName || '尚未创建话题';
    const accent = getAgentAccent(agent.id);

    return `
        <article class="subject-overview-card ${isActive ? 'is-active subject-overview-card--active' : ''}" data-subject-card data-agent-id="${escapeHtml(agent.id)}">
            <div class="subject-overview-card__topline">
                <span class="subject-overview-card__icon" style="color: ${accent};">
                    <span class="material-symbols-outlined">book_2</span>
                </span>
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
                <span class="subject-overview-card__eyebrow">学科</span>
                <strong>${escapeHtml(agent.name || agent.id)}</strong>
                <p>${unreadCount > 0 ? `还有 ${unreadCount} 项待处理内容。` : '可以继续进入当前学习工作台。'}</p>
            </div>
            <div class="subject-overview-card__meta">
                <span class="subject-overview-card__chip">${topicCount} 个话题</span>
                <span class="subject-overview-card__chip">${unreadCount} 项待处理</span>
                ${isActive ? '<span class="subject-overview-card__badge">当前</span>' : ''}
            </div>
            <div class="subject-overview-card__footer">
                <span class="subject-overview-card__footer-label">最近话题：${escapeHtml(lastTopicName)}</span>
                <span class="material-symbols-outlined" aria-hidden="true">arrow_outward</span>
            </div>
        </article>
    `;
}

function buildSubjectOverviewMarkup({ agents = [], statsByAgent = {}, selectedAgentId = null, overviewStats = null } = {}) {
    const hasAgents = Array.isArray(agents) && agents.length > 0;
    const headline = hasAgents ? '学科总视图' : '创建你的第一个学科';
    const summary = hasAgents
        ? '继续管理你的学习，或从下方切换到其他学科。'
        : '先创建一个学科入口，UniStudy 会在这里为你组织学习工作台。';

    const normalizedOverviewStats = overviewStats && typeof overviewStats === 'object'
        ? overviewStats
        : {
            subjectCount: agents.length,
            topicCount: agents.reduce((sum, agent) => sum + Number(statsByAgent?.[agent.id]?.topicCount || 0), 0),
            pendingCount: agents.reduce((sum, agent) => sum + Number(statsByAgent?.[agent.id]?.unreadCount || 0), 0),
        };

    const focusedAgent = agents.find((agent) => agent.id === selectedAgentId) || agents[0] || null;
    const focusedStats = focusedAgent ? (statsByAgent[focusedAgent.id] || {}) : {};

    const wallAgents = hasAgents
        ? agents.filter((agent) => agent?.id !== focusedAgent?.id)
        : [];

    const wallMarkup = hasAgents
        ? (
            wallAgents.length > 0
                ? wallAgents.map((agent) => buildAgentWallCard(agent, statsByAgent[agent.id] || {}, false)).join('')
                : `
                    <article class="subject-overview-empty">
                        <span class="subject-overview-empty__eyebrow">All set</span>
                        <strong>当前没有其他学科</strong>
                        <p>上方已经展示了当前学科；创建新的学科后，会在这里显示更多学习工作台。</p>
                    </article>
                `
        )
        : `
            <article class="subject-overview-empty">
                <span class="subject-overview-empty__eyebrow">Ready to start</span>
                <strong>还没有学科卡片</strong>
                <p>点击右侧的新建学科卡，创建第一个学习工作台。</p>
            </article>
        `;

    return {
        headline,
        summary,
        clockMarkup: buildClockMarkup(),
        statsRowMarkup: buildStatsRowMarkup(normalizedOverviewStats),
        gridMarkup: `
            <section class="overview-hero-grid" aria-label="首页重点卡片">
                ${buildHeroSummaryCard(headline, summary)}
                ${buildFocusedAgentCard(focusedAgent, focusedStats)}
                ${buildCreateCardMarkup()}
            </section>
            <section class="overview-subject-wall" aria-label="全部学科卡片">
                ${wallMarkup}
            </section>
        `,
    };
}

export { buildSubjectOverviewMarkup };
