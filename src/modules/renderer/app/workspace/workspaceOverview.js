function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildRecentItems({ agents = [], statsByAgent = {}, selectedAgentId = null } = {}) {
    const items = [];
    const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) || null;
    const selectedStats = selectedAgent ? (statsByAgent[selectedAgent.id] || {}) : null;

    if (selectedAgent) {
        items.push({
            title: selectedStats?.lastTopicName
                ? `继续：${selectedStats.lastTopicName}`
                : `进入：${selectedAgent.name || selectedAgent.id}`,
            meta: `${selectedAgent.name || selectedAgent.id} · 当前学习空间`,
            accent: 'primary',
        });
    }

    const unreadAgent = agents
        .map((agent) => ({
            agent,
            stats: statsByAgent[agent.id] || {},
        }))
        .filter((item) => item.agent.id !== selectedAgentId && Number(item.stats.unreadCount || 0) > 0)
        .sort((left, right) => Number(right.stats.unreadCount || 0) - Number(left.stats.unreadCount || 0))[0];

    if (unreadAgent) {
        items.push({
            title: `待处理：${unreadAgent.agent.name || unreadAgent.agent.id}`,
            meta: `${unreadAgent.stats.unreadCount || 0} 项内容等待整理`,
            accent: 'success',
        });
    }

    const topicAgent = agents
        .map((agent) => ({
            agent,
            stats: statsByAgent[agent.id] || {},
        }))
        .filter((item) => item.stats.lastTopicName && item.agent.id !== selectedAgentId)
        .sort((left, right) => Number(right.stats.topicCount || 0) - Number(left.stats.topicCount || 0))[0];

    if (topicAgent) {
        items.push({
            title: `归档：${topicAgent.stats.lastTopicName}`,
            meta: `${topicAgent.agent.name || topicAgent.agent.id} · 已整理 ${topicAgent.stats.topicCount || 0} 个话题`,
            accent: 'muted',
        });
    }

    if (items.length === 0) {
        return [
            {
                title: '创建第一个学科',
                meta: '从一个学习入口开始，把资料、对话和笔记组织起来',
                accent: 'primary',
            },
            {
                title: '沉淀你的学习过程',
                meta: '后续这里会自动汇总最近的话题、笔记和成长记录',
                accent: 'success',
            },
            {
                title: '继续完成当天任务',
                meta: '通过首页快速回到当前学习空间',
                accent: 'muted',
            },
        ];
    }

    return items.slice(0, 3);
}

function buildFeatureCard({ title, description, accent, action, icon } = {}) {
    return `
        <button type="button" class="overview-dashboard-card overview-dashboard-card--${escapeHtml(accent)}" data-home-action="${escapeHtml(action)}">
            <span class="overview-dashboard-card__icon">
                <span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(icon)}</span>
            </span>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(description)}</p>
        </button>
    `;
}

function buildHeaderHighlight({ icon, label } = {}) {
    return `
        <button type="button" class="workspace-overview-page__highlight-chip" data-home-action="${escapeHtml(icon === 'grid_view' ? 'view-highlights' : icon === 'forum' ? 'open-subject' : 'open-notes')}">
            <span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(icon)}</span>
            <span>${escapeHtml(label)}</span>
        </button>
    `;
}

function buildSubjectWallCard({ agent, stats = {}, isCurrent = false, tone = 'violet' } = {}) {
    const agentId = agent?.id || '';
    const agentName = agent?.name || agentId || '未命名学科';
    const topicCount = Math.max(0, Number(stats?.topicCount || 0));
    const unreadCount = Math.max(0, Number(stats?.unreadCount || 0));
    const lastTopicName = stats?.lastTopicName || '从一个新话题开始今天的学习';
    const summaryText = unreadCount > 0
        ? `${unreadCount} 项内容待整理`
        : (topicCount > 0 ? `已累计 ${topicCount} 个学习话题` : '准备好开始第一条学习链路');

    return `
        <button
            type="button"
            class="subject-overview-card subject-overview-card--${escapeHtml(tone)}${isCurrent ? ' subject-overview-card--current' : ''}"
            data-subject-card
            data-agent-id="${escapeHtml(agentId)}"
        >
            <div class="subject-overview-card__topline">
                <span class="subject-overview-card__badge">${isCurrent ? '当前学科' : '学习空间'}</span>
                <span class="subject-overview-card__metric">${topicCount} 话题</span>
            </div>
            <div class="subject-overview-card__body">
                <strong>${escapeHtml(agentName)}</strong>
                <p>${escapeHtml(lastTopicName)}</p>
            </div>
            <div class="subject-overview-card__meta" aria-hidden="true">
                <span>
                    <span class="material-symbols-outlined">schedule</span>
                    ${escapeHtml(summaryText)}
                </span>
                <span>
                    <span class="material-symbols-outlined">arrow_outward</span>
                    进入学习
                </span>
            </div>
        </button>
    `;
}

function buildSubjectListRow({ agent, stats = {}, isCurrent = false, tone = 'violet' } = {}) {
    const agentId = agent?.id || '';
    const agentName = agent?.name || agentId || '未命名学科';
    const topicCount = Math.max(0, Number(stats?.topicCount || 0));
    const unreadCount = Math.max(0, Number(stats?.unreadCount || 0));
    const lastTopicName = stats?.lastTopicName || '从一个新话题开始今天的学习';
    const toneClass = `subject-overview-list__item--${escapeHtml(tone)}`;

    return `
        <button
            type="button"
            class="subject-overview-list__item ${toneClass}${isCurrent ? ' subject-overview-list__item--current' : ''}"
            data-subject-card
            data-agent-id="${escapeHtml(agentId)}"
        >
            <span class="subject-overview-list__badge">${isCurrent ? '当前学科' : '学习空间'}</span>
            <div class="subject-overview-list__main">
                <strong>${escapeHtml(agentName)}</strong>
                <p>${escapeHtml(lastTopicName)}</p>
            </div>
            <div class="subject-overview-list__stats">
                <span>${topicCount} 个话题</span>
                <span>${unreadCount} 项待处理</span>
            </div>
            <span class="subject-overview-list__cta">
                <span class="material-symbols-outlined" aria-hidden="true">arrow_outward</span>
                进入学习
            </span>
        </button>
    `;
}

function buildSubjectCreateCard(viewMode = 'grid') {
    if (viewMode === 'list') {
        return `
            <button
                type="button"
                class="subject-overview-list__item subject-overview-list__item--create"
                data-create-subject-card
            >
                <span class="subject-overview-list__badge subject-overview-list__badge--create">
                    <span class="material-symbols-outlined" aria-hidden="true">add</span>
                </span>
                <div class="subject-overview-list__main">
                    <strong>新建笔记本</strong>
                    <p>创建一个新的学科学习空间，放在这里随时开始。</p>
                </div>
                <span class="subject-overview-list__cta">立即创建</span>
            </button>
        `;
    }

    return `
        <button
            type="button"
            class="subject-overview-card subject-overview-card--create"
            data-create-subject-card
        >
            <div class="subject-overview-card__create-body">
                <span class="subject-overview-card__create-icon" aria-hidden="true">
                    <span class="material-symbols-outlined">add</span>
                </span>
                <strong>新建笔记本</strong>
            </div>
        </button>
    `;
}

function buildSubjectCollectionMarkup({
    agents = [],
    statsByAgent = {},
    selectedAgentId = null,
    viewMode = 'grid',
} = {}) {
    const subjectTones = ['violet', 'green', 'warm', 'rose', 'slate'];
    const subjectItemsMarkup = agents.map((agent, index) => {
        const payload = {
            agent,
            stats: statsByAgent[agent.id] || {},
            isCurrent: agent.id === selectedAgentId,
            tone: subjectTones[index % subjectTones.length],
        };
        return viewMode === 'list'
            ? buildSubjectListRow(payload)
            : buildSubjectWallCard(payload);
    }).join('');
    const itemsMarkup = `${buildSubjectCreateCard(viewMode)}${subjectItemsMarkup}`;

    return viewMode === 'list'
        ? `<div class="subject-overview-list" data-subject-collection data-view-mode="list">${itemsMarkup}</div>`
        : `<div class="overview-subject-wall" data-subject-collection data-view-mode="grid">${itemsMarkup}</div>`;
}

function buildSubjectOverviewMarkup({
    agents = [],
    statsByAgent = {},
    selectedAgentId = null,
    selectedAgentName = '',
    currentTopicName = '',
    learningMetrics = {},
} = {}) {
    const hasAgents = agents.length > 0;
    const totalTopics = agents.reduce((sum, agent) => sum + Number(statsByAgent[agent.id]?.topicCount || 0), 0);
    const totalUnread = agents.reduce((sum, agent) => sum + Number(statsByAgent[agent.id]?.unreadCount || 0), 0);
    const currentAgentLabel = selectedAgentName || '还没有创建学科';
    const currentTopicLabel = currentTopicName || '还没有选中话题';
    const recentItems = buildRecentItems({ agents, statsByAgent, selectedAgentId });
    const streakDays = Math.max(0, Number(learningMetrics?.streakDays || 0));
    const activeDaysLast7 = Math.max(0, Number(learningMetrics?.activeDaysLast7 || 0));
    const totalLearningDays = Math.max(0, Number(learningMetrics?.totalLearningDays || 0));
    const score = Math.max(0, Number(learningMetrics?.score || 0));

    const featureMarkup = [
        buildFeatureCard({
            title: '学科辅导',
            description: '启发对话 · 深度解析',
            accent: 'primary',
            action: 'open-subject',
            icon: 'forum',
        }),
        buildFeatureCard({
            title: '知识沉淀',
            description: '自动整理 · 资料索引',
            accent: 'success',
            action: 'open-notes',
            icon: 'library_books',
        }),
        buildFeatureCard({
            title: '训练转化',
            description: '变式练习 · 记忆闪卡',
            accent: 'warm',
            action: 'continue-learning',
            icon: 'task_alt',
        }),
        buildFeatureCard({
            title: '成长复盘',
            description: 'DailyNote · 进步轨迹',
            accent: 'rose',
            action: 'open-diary',
            icon: 'auto_stories',
        }),
    ].join('');

    const recentMarkup = recentItems.map((item) => `
        <article class="overview-dashboard-activity overview-dashboard-activity--${escapeHtml(item.accent)}">
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.meta)}</p>
        </article>
    `).join('');

    const subjectWallMarkup = hasAgents
        ? `
            <section class="overview-subject-section overview-subject-section--pending" aria-label="学科入口">
                <div class="overview-subject-browser">
                    <div class="overview-subject-browser__toolbar">
                        <div class="overview-subject-browser__view-toggle" role="tablist" aria-label="学科视图切换">
                            <button
                                type="button"
                                class="overview-subject-browser__toggle-btn is-active"
                                data-subject-view="grid"
                                aria-pressed="true"
                            >
                                <span class="material-symbols-outlined" aria-hidden="true">grid_view</span>
                                <span>卡片</span>
                            </button>
                            <button
                                type="button"
                                class="overview-subject-browser__toggle-btn"
                                data-subject-view="list"
                                aria-pressed="false"
                            >
                                <span class="material-symbols-outlined" aria-hidden="true">view_list</span>
                                <span>列表</span>
                            </button>
                        </div>
                        <button
                            type="button"
                            class="overview-subject-browser__sort"
                            data-subject-sort="recent"
                        >
                            <span data-subject-sort-label>最近</span>
                            <span class="material-symbols-outlined" aria-hidden="true">swap_vert</span>
                        </button>
                        <button
                            id="subjectOverviewCreateCard"
                            type="button"
                            class="overview-subject-browser__create"
                        >
                            <span class="material-symbols-outlined" aria-hidden="true">add</span>
                            <span>新建</span>
                        </button>
                    </div>

                    <div class="overview-subject-browser__meta">
                        <div class="overview-subject-browser__tabs" role="tablist" aria-label="学科筛选">
                            <button
                                type="button"
                                class="overview-subject-browser__tab is-active"
                                data-subject-filter="all"
                                aria-pressed="true"
                            >
                                全部
                            </button>
                            <button type="button" class="overview-subject-browser__tab" data-subject-filter="current" aria-pressed="false">
                                当前学科
                            </button>
                            <button type="button" class="overview-subject-browser__tab" data-subject-filter="pending" aria-pressed="false">
                                待整理
                            </button>
                        </div>
                    </div>

                    <div class="overview-subject-section__body" id="subjectOverviewCollectionHost">
                        ${buildSubjectCollectionMarkup({
                            agents,
                            statsByAgent,
                            selectedAgentId,
                            viewMode: 'grid',
                        })}
                    </div>
                </div>
            </section>
        `
        : `
            <section class="overview-subject-section overview-subject-section--pending" aria-label="学科入口">
                <div class="overview-subject-section__header">
                    <div>
                        <p class="overview-subject-section__eyebrow">All Subjects</p>
                        <h3>全部学科</h3>
                        <p class="overview-subject-section__caption">先创建第一个学科入口，首页就会开始聚合你的学习记录。</p>
                    </div>
                </div>
                <button id="subjectOverviewCreateCard" type="button" class="subject-overview-empty">
                    <span class="subject-overview-empty__icon material-symbols-outlined" aria-hidden="true">school</span>
                    <span class="subject-overview-empty__eyebrow">Ready</span>
                    <strong>创建你的第一个学科工作台</strong>
                    <p>把资料、对话、笔记和复盘收进同一个学习入口，后面首页就会自动帮你继续追踪。</p>
                </button>
            </section>
        `;

    return {
        headline: '学习首页',
        summary: '把首页变成一个能直接继续学习的入口，而不是只做概览。',
        highlightsMarkup: [
            buildHeaderHighlight({ icon: 'grid_view', label: '学科仪表盘' }),
            buildHeaderHighlight({ icon: 'forum', label: '对话学习' }),
            buildHeaderHighlight({ icon: 'library_books', label: '来源阅读' }),
        ].join(''),
        heroMarkup: '',
        gridMarkup: `
            <section class="overview-dashboard" aria-label="首页工作台">
                <header class="overview-dashboard__header">
                    <div class="overview-dashboard__welcome">
                        <h2>你好，同学 👋</h2>
                        <p>${streakDays > 0
                            ? `今天是你连续学习的第 ${escapeHtml(streakDays)} 天，近 7 天活跃 ${escapeHtml(activeDaysLast7)} 天。`
                            : (hasAgents
                                ? `当前学科：${escapeHtml(currentAgentLabel)} · 当前话题：${escapeHtml(currentTopicLabel)}`
                                : '先创建一个学科入口，然后开始你的第一条学习链路。')}</p>
                    </div>
                    <div class="overview-dashboard__score">
                        <span>学习力指数</span>
                        <strong>${escapeHtml(score)}</strong>
                    </div>
                </header>

                <section class="overview-dashboard__body">
                    <div class="overview-dashboard__features">
                        ${featureMarkup}
                    </div>

                    <aside class="overview-dashboard__activity-card">
                        <div class="overview-dashboard__activity-title">
                            <span class="overview-dashboard__activity-dot"></span>
                            <strong>最近成长动态</strong>
                        </div>
                        <div class="overview-dashboard__activity-list">
                            ${recentMarkup}
                        </div>
                        <button type="button" class="ghost-button overview-dashboard__activity-button" data-home-action="open-diary">
                            查看全部记录 →
                        </button>
                    </aside>
                </section>

                <footer class="overview-dashboard__footer">
                    <div class="overview-dashboard__footer-copy">
                        <span class="overview-dashboard__footer-icon material-symbols-outlined" aria-hidden="true">menu_book</span>
                        <strong>${hasAgents ? '全部学科' : '从创建学科开始你的学习工作台'}</strong>
                        <p>${hasAgents
                            ? `点击下方卡片即可进入对应学科`
                            : '创建后即可开始整理资料、笔记和训练内容。'}</p>
                    </div>
                    <button type="button" class="accent-button overview-dashboard__footer-button" data-home-action="${hasAgents ? 'view-highlights' : 'create-agent'}">
                        ${hasAgents ? '继续学习' : '立即开始'}
                    </button>
                </footer>
            </section>
            ${subjectWallMarkup}
        `,
    };
}

export { buildSubjectCollectionMarkup, buildSubjectOverviewMarkup };
