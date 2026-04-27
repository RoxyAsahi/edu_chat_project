function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatRelativeTimeShort(value) {
    const timestamp = Number(value || 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return '';
    }

    const diff = Math.max(0, Date.now() - timestamp);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < minute) {
        return '刚刚';
    }
    if (diff < hour) {
        return `${Math.max(1, Math.floor(diff / minute))} 分钟前`;
    }
    if (diff < day) {
        return `${Math.max(1, Math.floor(diff / hour))} 小时前`;
    }
    if (diff < 7 * day) {
        return `${Math.max(1, Math.floor(diff / day))} 天前`;
    }

    return new Date(timestamp).toLocaleDateString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
    });
}

function stripMarkdownForPreview(value, maxChars = 120) {
    let source = String(value || '')
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

    return source.length > maxChars ? `${source.slice(0, maxChars).trim()}…` : source;
}

function buildDiaryCardsMarkup({ diaryCards = [] } = {}) {
    const cards = Array.isArray(diaryCards) ? diaryCards : [];

    if (cards.length === 0) {
        return `
            <div class="home-diary__empty">
                <span class="home-diary__empty-icon" aria-hidden="true">✒️</span>
                <strong>还没有学习日记</strong>
                <p>和 AI 助手对话学习时，系统会自动把学习结晶整理成日记。开始一段对话，这里就会展示你的学习足迹。</p>
            </div>
        `;
    }

    return cards.slice(0, 4).map((card) => {
        const preview = stripMarkdownForPreview(card.previewMarkdown || card.contentMarkdown || '', 140);
        const agentNames = Array.isArray(card.agentNames) && card.agentNames.length > 0
            ? card.agentNames
            : (Array.isArray(card.subjectSignatures) && card.subjectSignatures.length > 0 ? card.subjectSignatures : []);
        const agentLabel = agentNames[0] || 'AI 助手';
        const topicNames = Object.values(card.topics || {})
            .map((t) => String(t?.topicName || '').trim())
            .filter(Boolean);
        const topicLabel = topicNames[0] || '';

        return `
            <article class="home-diary-card" data-home-action="open-diary">
                <span class="home-diary-card__quill" aria-hidden="true">✒️</span>
                <strong class="home-diary-card__title">${escapeHtml(topicLabel || agentLabel || '学习日记')}</strong>
                <p class="home-diary-card__preview">${escapeHtml(preview || '这张日记还没有摘要内容。')}</p>
            </article>
        `;
    }).join('');
}

function buildRecentLearningItems({ agents = [], statsByAgent = {}, selectedAgentId = null } = {}) {
    const tones = [
        { tone: 'blue', icon: 'auto_stories' },
        { tone: 'orange', icon: 'article' },
        { tone: 'green', icon: 'local_library' },
    ];

    const rankedAgents = agents
        .map((agent, index) => {
            const stats = statsByAgent[agent.id] || {};
            const topicCount = Math.max(0, Number(stats.topicCount || 0));
            const timestamp = Number(stats.lastTopicCreatedAt || 0);
            const isCurrent = agent.id === selectedAgentId;
            const title = stats.lastTopicName || `${agent.name || agent.id || '学科'} 新对话`;
            const relativeTime = formatRelativeTimeShort(timestamp);
            const fallbackMeta = topicCount > 0 ? `${topicCount} 个话题` : '准备开始';

            return {
                agentId: agent.id,
                title,
                meta: `${agent.name || agent.id || '未命名学科'} · ${relativeTime || fallbackMeta}`,
                rank: (isCurrent ? 2_000_000_000 : 0) + (timestamp || (topicCount * 1000)) - index,
            };
        })
        .sort((left, right) => right.rank - left.rank)
        .slice(0, 3);

    if (rankedAgents.length === 0) {
        return [
            {
                title: '创建第一个学科',
                meta: '开始一段新的学习对话',
                action: 'create-subject',
            },
        ];
    }

    return rankedAgents.map((item, index) => ({
        ...item,
        action: item.agentId ? 'open-agent' : 'create-subject',
        tone: tones[index % tones.length].tone,
        icon: tones[index % tones.length].icon,
    }));
}

function buildFallbackTrendDays() {
    const oneDay = 24 * 60 * 60 * 1000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = today.getTime() - (6 * oneDay);

    return Array.from({ length: 7 }, (_item, index) => {
        const date = new Date(start + (index * oneDay));
        return {
            dateKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
            label: `${date.getMonth() + 1}/${date.getDate()}`,
            value: 0,
            active: false,
        };
    });
}

function normalizeTrendDays(trendDays = []) {
    const source = Array.isArray(trendDays) && trendDays.length > 0
        ? trendDays
        : buildFallbackTrendDays();

    return source.slice(-7).map((day) => {
        const value = Math.max(0, Number(day?.value || 0));
        return {
            dateKey: String(day?.dateKey || ''),
            label: String(day?.label || ''),
            value,
            active: Boolean(day?.active) || value > 0,
        };
    });
}

function buildSmoothTrendPath(points = []) {
    if (!Array.isArray(points) || points.length === 0) {
        return '';
    }
    if (points.length === 1) {
        return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    }

    const commands = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`];
    for (let index = 0; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        const previous = points[index - 1] || current;
        const afterNext = points[index + 2] || next;
        const tension = 0.18;
        const cp1x = current.x + ((next.x - previous.x) * tension);
        const cp1y = current.y + ((next.y - previous.y) * tension);
        const cp2x = next.x - ((afterNext.x - current.x) * tension);
        const cp2y = next.y - ((afterNext.y - current.y) * tension);

        commands.push(`C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`);
    }

    return commands.join(' ');
}

function buildStudyTrendMarkup({ trendDays = [] } = {}) {
    const days = normalizeTrendDays(trendDays);
    const width = 320;
    const height = 132;
    const chartLeft = 34;
    const chartRight = 16;
    const chartTop = 20;
    const chartBottom = 30;
    const chartWidth = width - chartLeft - chartRight;
    const chartHeight = height - chartTop - chartBottom;
    const maxValue = Math.max(1, ...days.map((day) => day.value));
    const topTick = Math.max(4, Math.ceil(maxValue / 2) * 2);
    const ticks = [topTick, Math.round(topTick / 2), 0];

    const points = days.map((day, index) => {
        const x = chartLeft + ((chartWidth / Math.max(1, days.length - 1)) * index);
        const y = chartTop + chartHeight - ((day.value / topTick) * chartHeight);
        return { ...day, x, y };
    });

    const linePath = buildSmoothTrendPath(points);
    const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${chartTop + chartHeight} L ${points[0].x.toFixed(1)} ${chartTop + chartHeight} Z`;
    const highlightedPoint = [...points].reverse().find((point) => point.active) || points[points.length - 1];
    const bubbleWidth = 64;
    const bubbleX = Math.min(width - bubbleWidth - 4, Math.max(4, highlightedPoint.x - (bubbleWidth / 2)));
    const bubbleY = Math.max(2, highlightedPoint.y - 30);
    const bubbleText = highlightedPoint.value > 0 ? `活跃度 ${highlightedPoint.value}` : '暂无活跃';

    const tickMarkup = ticks.map((tick) => {
        const y = chartTop + chartHeight - ((tick / topTick) * chartHeight);
        return `
            <g class="home-status-trend__tick">
                <text x="4" y="${(y + 4).toFixed(1)}">${escapeHtml(String(tick))}</text>
                <line x1="${chartLeft}" y1="${y.toFixed(1)}" x2="${width - chartRight}" y2="${y.toFixed(1)}"></line>
            </g>
        `;
    }).join('');

    const pointMarkup = points.map((point) => `
        <circle
            class="home-status-trend__point${point === highlightedPoint ? ' home-status-trend__point--active' : ''}"
            cx="${point.x.toFixed(1)}"
            cy="${point.y.toFixed(1)}"
            r="${point === highlightedPoint ? 3.6 : 2.4}"
        ></circle>
    `).join('');

    const labelMarkup = points.map((point) => `
        <text class="home-status-trend__label" x="${point.x.toFixed(1)}" y="${height - 8}">${escapeHtml(point.label)}</text>
    `).join('');

    return `
        <div class="home-status-trend" aria-label="近 7 天学习活跃度趋势">
            <svg class="home-status-trend__chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="近 7 天学习活跃度折线图">
                ${tickMarkup}
                <path class="home-status-trend__area" d="${areaPath}"></path>
                <path class="home-status-trend__line" d="${linePath}"></path>
                ${pointMarkup}
                <g class="home-status-trend__bubble">
                    <rect x="${bubbleX.toFixed(1)}" y="${bubbleY.toFixed(1)}" width="${bubbleWidth}" height="22" rx="7"></rect>
                    <text x="${(bubbleX + bubbleWidth / 2).toFixed(1)}" y="${(bubbleY + 14.5).toFixed(1)}">${escapeHtml(bubbleText)}</text>
                </g>
                ${labelMarkup}
            </svg>
        </div>
    `;
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
    diaryCards = [],
} = {}) {
    const hasAgents = agents.length > 0;
    const totalTopics = agents.reduce((sum, agent) => sum + Number(statsByAgent[agent.id]?.topicCount || 0), 0);
    const totalUnread = agents.reduce((sum, agent) => sum + Number(statsByAgent[agent.id]?.unreadCount || 0), 0);
    const currentAgentLabel = selectedAgentName || '还没有创建学科';
    const currentTopicLabel = currentTopicName || '还没有选中话题';
    const recentLearningItems = buildRecentLearningItems({ agents, statsByAgent, selectedAgentId });
    const streakDays = Math.max(0, Number(learningMetrics?.streakDays || 0));
    const activeDaysLast7 = Math.max(0, Number(learningMetrics?.activeDaysLast7 || 0));
    const totalLearningDays = Math.max(0, Number(learningMetrics?.totalLearningDays || 0));
    const trendMarkup = buildStudyTrendMarkup({
        trendDays: learningMetrics?.trendDays,
    });

    const hour = new Date().getHours();
    const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    const primaryAction = hasAgents ? 'continue-learning' : 'create-subject';
    const primaryActionText = hasAgents ? '继续学习' : '新建学科';
    const heroTitle = '个人 AI 学习中心';

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

    const recentLearningRows = recentLearningItems.map((item) => `
        <button
            type="button"
            class="home-recent-learning__item home-recent-learning__item--${escapeHtml(item.tone || 'blue')}"
            data-home-action="${escapeHtml(item.action || 'open-agent')}"
            ${item.agentId ? `data-agent-id="${escapeHtml(item.agentId)}"` : ''}
        >
            <span class="home-recent-learning__icon material-symbols-outlined" aria-hidden="true">${escapeHtml(item.icon || 'auto_stories')}</span>
            <span class="home-recent-learning__copy">
                <strong>${escapeHtml(item.title)}</strong>
                <small>${escapeHtml(item.meta)}</small>
            </span>
        </button>
    `).join('');

    const workflowSection = `
        <section class="home-flow">
            <div class="home-section-header">
                <h3>功能怎么用</h3>
            </div>
            <div class="home-flow__grid">${workflowCards}</div>
        </section>
    `;
    const statusSection = `
        <section class="home-status">
            <div class="home-section-header">
                <h3>学习状态</h3>
            </div>
            <div class="home-status__grid">
                <div><span>学科</span><strong>${agents.length}</strong></div>
                <div><span>话题</span><strong>${totalTopics}</strong></div>
                <div><span>待整理</span><strong>${totalUnread}</strong></div>
                <div><span>连续</span><strong>${streakDays}<small>天</small></strong></div>
            </div>
            ${trendMarkup}
        </section>
    `;
    const recentLearningSection = `
        <section class="home-recent-learning">
            <div class="home-section-header">
                <h3>最近学习</h3>
                <button type="button" class="ghost-button" data-home-action="continue-learning">
                    查看更多
                    <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
                </button>
            </div>
            <div class="home-recent-learning__list">${recentLearningRows}</div>
        </section>
    `;

    const diarySection = `
        <section class="home-diary">
            <div class="home-section-header">
                <h3>学习结晶</h3>
                <button type="button" class="ghost-button" data-home-action="open-diary">
                    查看全部
                    <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                </button>
            </div>
            <div class="home-diary__list">${buildDiaryCardsMarkup({ diaryCards })}</div>
        </section>
    `;

    const subjectSection = hasAgents
        ? `
        <section class="home-subjects">
            <div class="home-section-header">
                <h3>学习空间</h3>
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
            <div class="home-subjects__intro">
                <div class="home-subjects__intro-visual" aria-hidden="true">
                    <img src="../assets/写作业.svg" alt="" />
                </div>
                <strong>把每个学科当作一个长期学习空间</strong>
                <p>资料、对话、笔记和复盘都会沉淀在这里。选择下方卡片，继续进入对应学科。</p>
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

                        ${statusSection}
                        ${recentLearningSection}
                    </div>

                    ${subjectSection}

                    <aside class="home-side home-right">
                        ${workflowSection}
                        ${diarySection}
                    </aside>
                </div>
            </div>
        `,
    };
}

export { buildSubjectCollectionMarkup, buildSubjectOverviewMarkup };
