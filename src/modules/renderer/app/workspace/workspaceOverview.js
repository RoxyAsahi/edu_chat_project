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
    const headline = '最近打开的学科';
    const summary = '选择一个学科继续你的学习。';

    const clockMarkup = '';
    const statsRowMarkup = '';

    const cardsMarkup = agents.map((agent) => {
        const stats = statsByAgent[agent.id] || {};
        const isActive = agent.id === selectedAgentId;
        const topicCount = Number(stats.topicCount || 0);
        const lastTopicName = stats.lastTopicName || '尚未创建话题';
        
        const colors = ['#4285f4', '#ea4335', '#fbbc04', '#34a853', '#673ab7', '#e91e63'];
        let charCode = 0;
        const id = agent.id || '';
        for (let i = 0; i < id.length; i++) charCode += id.charCodeAt(i);
        const color = colors[charCode % colors.length];

        return `
            <article class="subject-overview-card ${isActive ? 'is-active' : ''}" data-subject-card data-agent-id="${escapeHtml(agent.id)}">
                <div class="subject-overview-card__topline">
                    <span class="subject-overview-card__icon" style="color: ${color};">
                        <span class="material-symbols-outlined">book</span>
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
                    <strong>${escapeHtml(agent.name || agent.id)}</strong>
                </div>
                <div class="subject-overview-card__footer">
                    <span class="subject-overview-card__footer-label">
                        ${topicCount} 个话题 · ${escapeHtml(lastTopicName)}
                    </span>
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

    return {
        headline,
        summary,
        clockMarkup,
        statsRowMarkup,
        gridMarkup: `<section class="overview-subject-wall" aria-label="学科卡片墙">${createCardMarkup}${cardsMarkup}</section>`,
    };
}

export { buildSubjectOverviewMarkup };
