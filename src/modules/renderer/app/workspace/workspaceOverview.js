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

function buildSubjectWallCard({ agent, stats = {}, isCurrent = false, tone = 'violet' } = {}) {
    const agentId = agent?.id || '';
    const agentName = agent?.name || agentId || '未命名学科';
    const topicCount = Math.max(0, Number(stats?.topicCount || 0));
    const unreadCount = Math.max(0, Number(stats?.unreadCount || 0));
    const lastTopicName = stats?.lastTopicName || '从一个新话题开始今天的学习';
    const summaryText = unreadCount > 0
        ? `${unreadCount} 项待整理`
        : (topicCount > 0 ? `${topicCount} 个话题` : '准备好开始');

    return `
        <button
            type="button"
            class="subject-overview-card subject-overview-card--${escapeHtml(tone)}${isCurrent ? ' subject-overview-card--current' : ''}"
            data-subject-card
            data-agent-id="${escapeHtml(agentId)}"
        >
            <div class="subject-overview-card__topline">
                <span class="subject-overview-card__badge">${isCurrent ? '当前学科' : '学习空间'}</span>
                ${isCurrent ? '<span class="subject-overview-card__current-dot" aria-hidden="true"></span>' : ''}
            </div>
            <div class="subject-overview-card__body">
                <strong>${escapeHtml(agentName)}</strong>
                <p>${escapeHtml(lastTopicName)}</p>
            </div>
            <div class="subject-overview-card__meta" aria-hidden="true">
                <span>${escapeHtml(summaryText)}</span>
                <span class="material-symbols-outlined">arrow_forward</span>
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
            <span class="subject-overview-list__badge">${isCurrent ? '当前' : '学科'}</span>
            <div class="subject-overview-list__main">
                <strong>${escapeHtml(agentName)}</strong>
                <p>${escapeHtml(lastTopicName)}</p>
            </div>
            <div class="subject-overview-list__stats">
                <span>${topicCount} 话题</span>
                <span>${unreadCount} 待处理</span>
            </div>
            <span class="subject-overview-list__cta">
                <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
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
                    <p>创建一个新的学科学习空间</p>
                </div>
                <span class="subject-overview-list__cta">创建</span>
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

function buildCalendarMarkup(activeDates = []) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const today = now.getDate();
    const activeSet = new Set(activeDates.map((d) => Number(d)));

    let daysHtml = '';
    for (let i = 0; i < startOffset; i++) {
        daysHtml += '<span class="bento-calendar__day bento-calendar__day--pad"></span>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const isToday = d === today;
        const isActive = activeSet.has(d);
        const cls = [
            'bento-calendar__day',
            isToday ? 'bento-calendar__day--today' : '',
            isActive ? 'bento-calendar__day--active' : '',
        ].filter(Boolean).join(' ');
        daysHtml += `<span class="${cls}">${d}</span>`;
    }

    return `
        <div class="bento-calendar">
            <div class="bento-calendar__header">
                <strong>学习日历</strong>
                <span class="bento-calendar__month">${year}年${monthNames[month]}</span>
            </div>
            <div class="bento-calendar__weekdays">
                ${weekDays.map((w) => `<span>${w}</span>`).join('')}
            </div>
            <div class="bento-calendar__days">
                ${daysHtml}
            </div>
        </div>
    `;
}

function buildStatsMarkup({
    weekHours = 0,
    weekChange = 0,
    streakDays = 0,
    noteCount = 0,
    chatCount = 0,
    aiAskCount = 0,
} = {}) {
    const bars = [0.4, 0.6, 0.3, 0.8, 0.5, 0.9, 0.7];
    const maxBar = Math.max(...bars);
    const barHtml = bars.map((h) => {
        const pct = maxBar > 0 ? Math.round((h / maxBar) * 100) : 0;
        return `<span class="bento-stats__bar" style="height:${pct}%"></span>`;
    }).join('');

    const changeSign = weekChange > 0 ? '+' : '';
    const changeColor = weekChange >= 0 ? 'bento-stats__change--up' : 'bento-stats__change--down';

    return `
        <div class="bento-stats">
            <div class="bento-stats__header">
                <strong>学习统计</strong>
            </div>
            <div class="bento-stats__top">
                <div class="bento-stats__main">
                    <span class="bento-stats__label">本周学习时长</span>
                    <div class="bento-stats__value">
                        <strong>${escapeHtml(String(weekHours))}</strong>
                        <span>小时</span>
                    </div>
                    <span class="bento-stats__change ${changeColor}">
                        <span class="material-symbols-outlined" aria-hidden="true">trending_up</span>
                        较上周 ${changeSign}${weekChange}%
                    </span>
                </div>
                <div class="bento-stats__chart" aria-hidden="true">
                    ${barHtml}
                </div>
            </div>
            <div class="bento-stats__grid">
                <div class="bento-stats__item">
                    <span class="bento-stats__item-label">连续学习</span>
                    <strong>${escapeHtml(String(streakDays))}<small>天</small></strong>
                </div>
                <div class="bento-stats__item">
                    <span class="bento-stats__item-label">笔记数量</span>
                    <strong>${escapeHtml(String(noteCount))}<small>条</small></strong>
                </div>
                <div class="bento-stats__item">
                    <span class="bento-stats__item-label">对话数量</span>
                    <strong>${escapeHtml(String(chatCount))}<small>次</small></strong>
                </div>
                <div class="bento-stats__item">
                    <span class="bento-stats__item-label">AI 提问</span>
                    <strong>${escapeHtml(String(aiAskCount))}<small>次</small></strong>
                </div>
            </div>
        </div>
    `;
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
    const score = Math.max(0, Number(learningMetrics?.score || 0));
    const activeDaysLast7 = Math.max(0, Number(learningMetrics?.activeDaysLast7 || 0));
    const totalLearningDays = Math.max(0, Number(learningMetrics?.totalLearningDays || 0));

    const hour = new Date().getHours();
    const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    const primaryAction = hasAgents ? 'continue-learning' : 'create-subject';
    const primaryActionText = hasAgents ? '继续学习' : '新建学科';
    const heroTitle = '个人 AI 学习中心';
    const heroSubtitle = hasAgents
        ? '把资料、对话、笔记和复盘放在同一个学习空间里，围绕当前话题持续推进。'
        : '先创建一个学科工作台，把课件、论文、题目、图片和对话都收进同一个学习空间。';

    const workflowCards = [
        { title: '放入资料', desc: 'PDF、DOCX、图片和文本会归入当前话题的 Source。', icon: 'upload_file', action: 'open-subject', step: '01' },
        { title: '提问理解', desc: '围绕资料追问概念、推导、例题和作业思路。', icon: 'forum', action: 'open-subject', step: '02' },
        { title: '整理笔记', desc: '把关键结论、错因和可复用模板沉淀下来。', icon: 'edit_note', action: 'open-notes', step: '03' },
        { title: '复盘巩固', desc: '用学习日志和闪卡检查今天真正掌握了什么。', icon: 'task_alt', action: 'open-diary', step: '04' },
    ].map((item) => `
        <button type="button" class="home-flow-card" data-home-action="${item.action}">
            <span class="home-flow-card__step">${item.step}</span>
            <span class="home-flow-card__icon material-symbols-outlined" aria-hidden="true">${item.icon}</span>
            <strong>${item.title}</strong>
            <span>${item.desc}</span>
        </button>
    `).join('');

    const activityCards = recentItems.map((item) => `
        <article class="home-activity-card home-activity-card--${escapeHtml(item.accent)}">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.meta)}</span>
        </article>
    `).join('');

    const calendarMarkup = buildCalendarMarkup(learningMetrics?.activeDates || []);
    const subjectSection = hasAgents
        ? `
        <section class="home-subjects">
            <div class="home-section-header">
                <div>
                    <span>学习空间</span>
                    <h3>选择一个学科继续</h3>
                </div>
                <div class="home-subjects__actions">
                    <div class="overview-subject-browser__view-toggle" role="tablist" aria-label="学科视图切换">
                        <button type="button" class="overview-subject-browser__toggle-btn is-active" data-subject-view="grid" aria-pressed="true">
                            <span class="material-symbols-outlined" aria-hidden="true">grid_view</span>
                        </button>
                        <button type="button" class="overview-subject-browser__toggle-btn" data-subject-view="list" aria-pressed="false">
                            <span class="material-symbols-outlined" aria-hidden="true">view_list</span>
                        </button>
                    </div>
                    <button type="button" class="overview-subject-browser__create" id="subjectOverviewCreateCard">
                        <span class="material-symbols-outlined" aria-hidden="true">add</span>
                        <span>新建</span>
                    </button>
                </div>
            </div>
            <div class="home-subjects__scroll bento-subjects__scroll" id="subjectOverviewCollectionHost">
                ${buildSubjectCollectionMarkup({
                    agents,
                    statsByAgent,
                    selectedAgentId,
                    viewMode: 'grid',
                })}
            </div>
        </section>
        `
        : `
        <section class="home-subjects home-subjects--empty">
            <button id="subjectOverviewCreateCard" type="button" class="home-empty-subject">
                <span class="material-symbols-outlined" aria-hidden="true">school</span>
                <strong>创建第一个学科工作台</strong>
                <p>例如：数学、英语、论文阅读、考研复习。每个学科下面可以继续拆话题、放资料、做笔记。</p>
            </button>
        </section>
        `;

    return {
        headline: '学习工作台',
        summary: '',
        highlightsMarkup: '',
        heroMarkup: '',
        gridMarkup: `
            <div class="app-home app-home--learning">
                <div class="home-grid home-grid--bento">
                    <div class="home-left">
                        <section class="home-hero">
                            <div class="home-hero__visual" aria-hidden="true">
                                <img src="../assets/写作业.svg" alt="" />
                            </div>
                            <div class="home-hero__copy">
                                <h2>${escapeHtml(heroTitle)}</h2>
                                <p class="home-hero__tagline">资料理解 · 对话辅导 · 笔记复盘</p>
                                <p>${escapeHtml(heroSubtitle)}</p>
                                <div class="home-hero__actions">
                                    <button type="button" class="home-primary-action" data-home-action="${primaryAction}">
                                        <span class="material-symbols-outlined" aria-hidden="true">${hasAgents ? 'play_arrow' : 'add'}</span>
                                        <span>${primaryActionText}</span>
                                    </button>
                                    <button type="button" class="home-secondary-action" data-home-action="open-notes">
                                        <span class="material-symbols-outlined" aria-hidden="true">edit_note</span>
                                        <span>看笔记</span>
                                    </button>
                                </div>
                            </div>
                        </section>

                        <section class="home-flow">
                            <div class="home-section-header">
                                <div>
                                    <span>功能怎么用</span>
                                    <h3>一条完整学习链路</h3>
                                </div>
                            </div>
                            <div class="home-flow__grid">${workflowCards}</div>
                        </section>
                    </div>

                    ${subjectSection}

                    <aside class="home-side home-right">
                        <section class="home-status">
                            <div class="home-section-header">
                                <div>
                                    <span>学习状态</span>
                                    <h3>今天的概览</h3>
                                </div>
                            </div>
                            <div class="home-status__grid">
                                <div><span>学科</span><strong>${agents.length}</strong></div>
                                <div><span>话题</span><strong>${totalTopics}</strong></div>
                                <div><span>待整理</span><strong>${totalUnread}</strong></div>
                                <div><span>连续</span><strong>${streakDays}<small>天</small></strong></div>
                            </div>
                            <div class="home-status__score">
                                <span>学习力</span>
                                <strong>${escapeHtml(String(score || 0))}</strong>
                                <p>近 7 天活跃 ${activeDaysLast7} 天，总学习 ${totalLearningDays} 天</p>
                            </div>
                        </section>
                        ${calendarMarkup}
                        <section class="home-activity">
                            <div class="home-section-header">
                                <div>
                                    <span>接下来</span>
                                    <h3>可继续的事项</h3>
                                </div>
                                <button type="button" class="ghost-button" data-home-action="open-diary">
                                    查看全部
                                    <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                                </button>
                            </div>
                            <div class="home-activity__list">${activityCards}</div>
                        </section>
                    </aside>
                </div>
            </div>
        `,
    };
}

export { buildSubjectCollectionMarkup, buildSubjectOverviewMarkup };
