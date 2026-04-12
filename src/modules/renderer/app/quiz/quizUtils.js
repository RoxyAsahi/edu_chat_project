const OPTION_LABELS = ['A', 'B', 'C', 'D'];

function stripMarkdown(text) {
    return String(text || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_~>-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractStructuredJsonPayload(text) {
    const raw = String(text || '').trim();
    if (!raw) {
        return null;
    }

    const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fencedMatch?.[1]?.trim() || raw;

    try {
        return JSON.parse(candidate);
    } catch {
        return null;
    }
}

function normalizeOptionLabel(label, index) {
    const normalized = String(label || '').trim().toUpperCase();
    if (OPTION_LABELS.includes(normalized)) {
        return normalized;
    }

    return OPTION_LABELS[index] || String.fromCharCode(65 + index);
}

function normalizeQuizOption(option, index) {
    if (option == null) {
        return null;
    }

    const label = normalizeOptionLabel(option?.label, index);
    const text = typeof option === 'string'
        ? String(option).trim()
        : String(option?.text || option?.content || option?.value || '').trim();

    if (!text) {
        return null;
    }

    return {
        id: String(option?.id || `option_${label.toLowerCase()}`),
        label,
        text,
    };
}

function resolveCorrectOptionId(rawValue, options = []) {
    const candidate = String(rawValue || '').trim();
    if (!candidate) {
        return '';
    }

    const byId = options.find((option) => option.id === candidate);
    if (byId) {
        return byId.id;
    }

    const normalizedLabel = candidate.toUpperCase();
    const byLabel = options.find((option) => option.label === normalizedLabel);
    if (byLabel) {
        return byLabel.id;
    }

    return '';
}

function normalizeQuizItem(item, index) {
    if (!item || typeof item !== 'object') {
        return null;
    }

    const stem = String(item.stem || item.question || '').trim();
    const options = Array.isArray(item.options)
        ? item.options.map((option, optionIndex) => normalizeQuizOption(option, optionIndex)).filter(Boolean)
        : [];
    const explanation = String(item.explanation || item.analysis || '').trim();
    const correctOptionId = resolveCorrectOptionId(
        item.correctOptionId || item.correctAnswer || item.answer,
        options,
    );

    if (!stem || options.length !== 4 || !correctOptionId || !explanation) {
        return null;
    }

    return {
        id: String(item.id || `quiz_${index + 1}`),
        stem,
        options,
        correctOptionId,
        explanation,
    };
}

function normalizeQuizSet(quizSet, fallbackTitle = '选择题练习') {
    if (!quizSet || typeof quizSet !== 'object') {
        return null;
    }

    const items = Array.isArray(quizSet.items)
        ? quizSet.items.map((item, index) => normalizeQuizItem(item, index)).filter(Boolean)
        : [];

    if (items.length === 0) {
        return null;
    }

    return {
        title: String(quizSet.title || fallbackTitle).trim() || fallbackTitle,
        items,
    };
}

function buildQuizSummaryMarkdown(quizSet) {
    if (!quizSet || !Array.isArray(quizSet.items) || quizSet.items.length === 0) {
        return '';
    }

    const blocks = [
        `# ${quizSet.title || '选择题练习'}`,
    ];

    quizSet.items.forEach((item, index) => {
        const correctOption = item.options.find((option) => option.id === item.correctOptionId);
        blocks.push([
            `## ${index + 1}. ${item.stem}`,
            ...item.options.map((option) => `${option.label}. ${option.text}`),
            `正确答案：${correctOption?.label || ''}`,
            `解析：${item.explanation}`,
        ].join('\n'));
    });

    return blocks.join('\n\n');
}

function parseQuizSetFromResponse(text, fallbackTitle = '选择题练习') {
    const payload = extractStructuredJsonPayload(text);
    const candidate = payload?.quizSet && typeof payload.quizSet === 'object'
        ? payload.quizSet
        : payload;

    return normalizeQuizSet(candidate, fallbackTitle);
}

function extractQuestionBlocks(rawText) {
    const lines = String(rawText || '').split(/\r?\n/);
    const questionStartIndexes = [];

    lines.forEach((line, index) => {
        const normalized = stripMarkdown(line);
        if (/^\d+[\.\u3001、]\s+/.test(normalized)) {
            questionStartIndexes.push(index);
        }
    });

    if (questionStartIndexes.length === 0) {
        return [];
    }

    return questionStartIndexes.map((startIndex, index) => {
        const endIndex = questionStartIndexes[index + 1] ?? lines.length;
        return lines.slice(startIndex, endIndex);
    });
}

function parseQuizItemFromMarkdown(lines, index) {
    const strippedLines = lines
        .map((line) => String(line || '').trim())
        .filter((line) => line.length > 0)
        .map((line) => stripMarkdown(line));

    if (strippedLines.length === 0) {
        return null;
    }

    const stem = strippedLines[0].replace(/^\d+[\.\u3001、]\s+/, '').trim();
    const options = [];
    let correctLabel = '';
    let collectingExplanation = false;
    const explanationParts = [];

    strippedLines.slice(1).forEach((line) => {
        const optionMatch = line.match(/^([A-D])[\.\u3001、:：]\s+(.+)$/i);
        if (optionMatch) {
            options.push({
                id: `option_${optionMatch[1].toLowerCase()}`,
                label: optionMatch[1].toUpperCase(),
                text: optionMatch[2].trim(),
            });
            collectingExplanation = false;
            return;
        }

        const answerMatch = line.match(/^(?:正确答案|答案)\s*[:：]\s*([A-D])/i);
        if (answerMatch) {
            correctLabel = answerMatch[1].toUpperCase();
            collectingExplanation = false;
            return;
        }

        const explanationMatch = line.match(/^(?:解析|解释)\s*[:：]\s*(.*)$/i);
        if (explanationMatch) {
            const leading = explanationMatch[1].trim();
            if (leading) {
                explanationParts.push(leading);
            }
            collectingExplanation = true;
            return;
        }

        if (collectingExplanation) {
            explanationParts.push(line);
        }
    });

    const explanation = explanationParts.join('\n').trim();
    const correctOption = options.find((option) => option.label === correctLabel);

    if (!stem || options.length !== 4 || !correctOption || !explanation) {
        return null;
    }

    return {
        id: `quiz_${index + 1}`,
        stem,
        options,
        correctOptionId: correctOption.id,
        explanation,
    };
}

function parseQuizSetFromMarkdown(text, fallbackTitle = '选择题练习') {
    const rawText = String(text || '').trim();
    if (!rawText) {
        return null;
    }

    const titleMatch = rawText.match(/^#\s+(.+)$/m);
    const title = String(titleMatch?.[1] || fallbackTitle).trim() || fallbackTitle;
    const questionBlocks = extractQuestionBlocks(rawText);
    const items = questionBlocks
        .map((block, index) => parseQuizItemFromMarkdown(block, index))
        .filter(Boolean);

    if (items.length === 0) {
        return null;
    }

    return normalizeQuizSet({ title, items }, fallbackTitle);
}

function hasStructuredQuiz(note) {
    return Boolean(
        note?.kind === 'quiz'
        && note?.quizSet
        && Array.isArray(note.quizSet.items)
        && note.quizSet.items.length > 0
    );
}

export {
    buildQuizSummaryMarkdown,
    hasStructuredQuiz,
    normalizeQuizSet,
    parseQuizSetFromMarkdown,
    parseQuizSetFromResponse,
};
