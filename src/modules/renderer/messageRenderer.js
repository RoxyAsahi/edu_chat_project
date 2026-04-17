// modules/messageRenderer.js

// --- Enhanced Rendering Constants ---
const ENHANCED_RENDER_DEBOUNCE_DELAY = 400; // ms, for general blocks during streaming
const DIARY_RENDER_DEBOUNCE_DELAY = 1000; // ms, potentially longer for diary if complex
const enhancedRenderDebounceTimers = new WeakMap(); // For debouncing prettify calls

import { avatarColorCache, getDominantAvatarColor } from './colorUtils.js';
import { initializeImageHandler, setContentAndProcessImages } from './imageHandler.js';
import { processAnimationsInContent, cleanupAnimationsInContent } from './animation.js';
import * as visibilityOptimizer from './visibilityOptimizer.js';
import { createMessageSkeleton, formatMessageTimestamp } from './domBuilder.js';
import * as streamManager from './streamManager.js';
import * as emoticonUrlFixer from './emoticonUrlFixer.js';
import { createContentPipeline, PIPELINE_MODES } from './contentPipeline.js';

const colorExtractionPromises = new Map();
let delegatedClickHandler = null;
let delegatedContextMenuHandler = null;
let delegatedEventTarget = null;

async function getDominantAvatarColorCached(url) {
    if (!colorExtractionPromises.has(url)) {
        colorExtractionPromises.set(url, getDominantAvatarColor(url));
    }
    return colorExtractionPromises.get(url);
}

import * as contentProcessor from './contentProcessor.js';
import * as contextMenu from './messageContextMenu.js';


// --- LaTeX Protection ---
// Protect LaTeX blocks before handing content to marked so Markdown parsing
// does not break escaped characters or math delimiters.

/**
 * Protect LaTeX blocks after preprocessing but before marked.parse runs.
 * @param {string} text Preprocessed content.
 * @returns {{text: string, map: Map<string, string>}} Placeholder mapping.
 */
function protectLatexBlocks(text) {
    const map = new Map();
    let id = 0;

    // Preserve display math before inline math, and keep both \[...\] and \(...\).

    // 1. Protect $$...$$ display math blocks.
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match) => {
        const placeholder = `%%LATEX_BLOCK_${id}%%`;
        map.set(placeholder, match);
        id++;
        return placeholder;
    });

    // 2. Protect \[...\] display math blocks.
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (match) => {
        const placeholder = `%%LATEX_BLOCK_${id}%%`;
        map.set(placeholder, match);
        id++;
        return placeholder;
    });

    // 3. Protect \(...\) inline math blocks.
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (match) => {
        const placeholder = `%%LATEX_BLOCK_${id}%%`;
        map.set(placeholder, match);
        id++;
        return placeholder;
    });

    // 4. Protect $...$ inline math without crossing lines or catching prices.
    text = text.replace(/\$([^\$\n]+?)\$/g, (match, content) => {
        // Skip values that look like prices, for example $100.
        if (/^\d/.test(content.trim())) return match;
        const placeholder = `%%LATEX_BLOCK_${id}%%`;
        map.set(placeholder, match);
        id++;
        return placeholder;
    });

    return { text, map };
}

/**
 * Restore protected LaTeX blocks after marked has produced HTML.
 * @param {string} html HTML returned by marked.
 * @param {Map<string, string>} map Placeholder mapping.
 * @returns {string} HTML with original LaTeX restored.
 */
function restoreLatexBlocks(html, map) {
    if (!map || map.size === 0) return html;
    for (const [placeholder, original] of map.entries()) {
        // Placeholders may be wrapped by marked; replace every occurrence safely.
        html = html.split(placeholder).join(original);
    }
    return html;
}

// --- Pre-compiled Regular Expressions for Performance ---
const TOOL_REGEX = /(?<!`)<<<\[TOOL_REQUEST\]>>>(.*?)<<<\[END_TOOL_REQUEST\]>>>(?!`)/gs;
const NOTE_REGEX = /<<<DailyNoteStart>>>(.*?)<<<DailyNoteEnd>>>/gs;
const TOOL_RESULT_REGEX = /\[\[(?:\u0056\u0043\u0050\u8c03\u7528\u7ed3\u679c\u4fe1\u606f\u6c47\u603b)(.*?)?(?:\u0056\u0043\u0050\u8c03\u7528\u7ed3\u679c\u7ed3\u675f)\]\]/gs;
const BUTTON_CLICK_REGEX = /\[\[(?:\u70b9\u51fb\u6309\u94ae):(.*?)\]\]/gs;
const CANVAS_PLACEHOLDER_REGEX = /\{\{VCPChatCanvas\}\}/g;
const STYLE_REGEX = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const HTML_FENCE_CHECK_REGEX = /```\w*\n<!DOCTYPE html>/i;
const MERMAID_CODE_REGEX = /<code.*?>\s*(flowchart|graph|mermaid)\s+([\s\S]*?)<\/code>/gi;
const MERMAID_FENCE_REGEX = /```(mermaid|flowchart|graph)\n([\s\S]*?)```/g;
const CODE_FENCE_REGEX = /```\w*([\s\S]*?)```/g;
const THOUGHT_CHAIN_REGEX = /\[--- VCP(?:\u5143\u601d\u8003\u94fe)(?::\s*"([^"]*)")?\s*---\]([\s\S]*?)\[--- (?:\u5143\u601d\u8003\u94fe\u7ed3\u675f) ---\]/gs;
const CONVENTIONAL_THOUGHT_REGEX = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
const ROLE_DIVIDER_REGEX = /<<<\[(END_)?ROLE_DIVIDE_(SYSTEM|ASSISTANT|USER)\]>>>/g;
const DESKTOP_PUSH_REGEX = /(?<!`)<<<\[DESKTOP_PUSH\]>>>([\s\S]*?)<<<\[DESKTOP_PUSH_END\]>>>(?!`)/gs;
const DESKTOP_PUSH_PARTIAL_REGEX = /(?<!`)<<<\[DESKTOP_PUSH\]>>>([\s\S]*)$/s; // Handles unfinished blocks while streaming.


// --- Enhanced Rendering Styles (from UserScript) ---
function injectEnhancedStyles() {
    try {
        // Skip injection if the stylesheet is already present.
        const existingStyleElement = document.getElementById('unistudy-enhanced-ui-styles');
        if (existingStyleElement) return;

        const links = document.getElementsByTagName('link');
        for (let i = 0; i < links.length; i++) {
            if (links[i].href && links[i].href.includes('messageRenderer.css')) {
                return;
            }
        }

        // Fallback for root-level HTML entrypoints that did not preload the stylesheet.
        const linkElement = document.createElement('link');
        linkElement.id = 'unistudy-enhanced-ui-styles';
        linkElement.rel = 'stylesheet';
        linkElement.type = 'text/css';
        linkElement.href = '../styles/messageRenderer.css';
        document.head.appendChild(linkElement);
    } catch (error) {
        console.error('UniStudy Enhanced UI: Failed to load external styles:', error);
    }
}

// --- Core Logic ---

/**
 * A helper function to escape HTML special characters.
 * @param {string} text The text to escape.
 * @returns {string} The escaped text.
 */
function escapeHtml(text) {
    return contentProcessor.escapeHtml(text);
}

/**
 * Generates a unique ID for scoping CSS.
 * @returns {string} A unique ID string (e.g., 'unistudy-bubble-1a2b3c4d').
 */
function generateUniqueId() {
    // Use a combination of timestamp and random string for uniqueness
    const timestampPart = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 9);
    return `unistudy-bubble-${timestampPart}${randomPart}`;
}

/**
 * Renders Mermaid diagrams found within a given container.
 * Finds placeholders, replaces them with the actual Mermaid code,
 * and then calls the Mermaid API to render them.
 * @param {HTMLElement} container The container element to search within.
 */
async function renderMermaidDiagrams(container) {
    const placeholders = Array.from(container.querySelectorAll('.mermaid-placeholder'));
    if (placeholders.length === 0) return;

    // Prepare elements for rendering
    placeholders.forEach(placeholder => {
        const code = placeholder.dataset.mermaidCode;
        if (code) {
            try {
                // The placeholder div itself will become the mermaid container
                let decodedCode = decodeURIComponent(code);
                // Normalize smart-dash variants that frequently break Mermaid syntax.                decodedCode = decodedCode.replace(/[\u2013\u2014\u2015]/g, '--');

                placeholder.textContent = decodedCode;
                placeholder.classList.remove('mermaid-placeholder');
                placeholder.classList.add('mermaid');
            } catch (e) {
                console.error('Failed to decode mermaid code', e);                placeholder.textContent = '[Mermaid ??????]';
            }
        }
    });

    // Get the list of actual .mermaid elements to render
    const elementsToRender = placeholders.filter(el => el.classList.contains('mermaid'));

    if (elementsToRender.length > 0 && typeof mermaid !== 'undefined') {
        // Initialize mermaid if it hasn't been already
        mermaid.initialize({ startOnLoad: false });

        // Render diagrams one by one so one failure does not break the whole batch.
        for (const el of elementsToRender) {
            try {
                await mermaid.run({ nodes: [el] });
            } catch (error) {
                console.error("Error rendering Mermaid diagram:", error);
                const originalCode = el.textContent;                el.innerHTML = `<div class="mermaid-error">Mermaid ????: ${error.message}</div><pre>${escapeHtml(originalCode)}</pre>`;
            }
        }
    }
}

/**
 * Apply a single regex rule to the provided text.
 * @param {string} text Input text.
 * @param {Object} rule Regex rule definition.
 * @returns {string} Processed text.
 */
function applyRegexRule(text, rule) {
    if (!rule || !rule.findPattern || typeof text !== 'string') {
        return text;
    }

    try {
        // Use the shared helper when available to rebuild a RegExp from stored text.
        let regex = null;
        if (window.uiHelperFunctions && window.uiHelperFunctions.regexFromString) {
            regex = window.uiHelperFunctions.regexFromString(rule.findPattern);
        } else {
            // Fallback: parse the serialized regex manually.
            const regexMatch = rule.findPattern.match(/^\/(.+?)\/([gimuy]*)$/);
            if (regexMatch) {
                regex = new RegExp(regexMatch[1], regexMatch[2]);
            } else {
                regex = new RegExp(rule.findPattern, 'g');
            }
        }

        if (!regex) {
            console.error('Failed to parse frontend regex pattern:', rule.findPattern);
            return text;
        }

        // Apply the replacement, defaulting to an empty string when unset.
        return text.replace(regex, rule.replaceWith || '');
    } catch (error) {
        console.error('Failed to apply frontend regex rule:', rule.findPattern, error);
        return text;
    }
}

/**
 * Apply all matching frontend regex rules to the provided text.
 * @param {string} text Input text.
 * @param {Array} rules Regex rule list.
 * @param {string} role Message role ('user' or 'assistant').
 * @param {number} depth Message depth; `1` is the newest message.
 * @returns {string} Processed text.
 */
function applyFrontendRegexRules(text, rules, role, depth) {
    if (!rules || !Array.isArray(rules) || typeof text !== 'string') {
        return text;
    }

    let processedText = text;

    rules.forEach(rule => {
        // Check whether this rule should run at all.

        // 1. Frontend-only rules.
        if (!rule.applyToFrontend) return;

        // 2. Role filter.
        const shouldApplyToRole = rule.applyToRoles && rule.applyToRoles.includes(role);
        if (!shouldApplyToRole) return;

        // 3. Depth filter (-1 means unlimited).
        const minDepthOk = rule.minDepth === undefined || rule.minDepth === -1 || depth >= rule.minDepth;
        const maxDepthOk = rule.maxDepth === undefined || rule.maxDepth === -1 || depth <= rule.maxDepth;

        if (!minDepthOk || !maxDepthOk) return;

        // Apply the rule.
        processedText = applyRegexRule(processedText, rule);
    });

    return processedText;
}

/**
 * Finds special VCP blocks (Tool Requests, Daily Notes) and transforms them
 * directly into styled HTML divs, bypassing the need for markdown code fences.
 * @param {string} text The text content.
 * @param {Map} [codeBlockMap] Map of code block placeholders to their original content.
 * @returns {string} The processed text with special blocks as HTML.
 */
function transformSpecialBlocks(text, codeBlockMap) {
    let processed = text;

    const restoreBlocks = (textStr) => {
        if (!textStr || !codeBlockMap) return textStr;
        let res = textStr;
        for (const [placeholder, block] of codeBlockMap.entries()) {
            if (res.includes(placeholder)) {
                res = res.replace(placeholder, () => block);
            }
        }
        return res;
    };

    // Process VCP tool results.
    processed = processed.replace(TOOL_RESULT_REGEX, (match, rawContent) => {
        const content = rawContent.trim();
        const lines = content.split('\n');
        const TOOL_NAME_KEYS = new Set(['tool_name', 'tool name', 'name']);
        const STATUS_KEYS = new Set(['status']);
        const MARKDOWN_VALUE_KEYS = new Set(['result', 'output', 'content']);
        const IMAGE_VALUE_KEYS = new Set(['url', 'image']);

        const normalizeToolResultKey = (key) => {
            const normalized = String(key || '').trim();
            const lower = normalized.toLowerCase();
            const toolNameAliases = ['宸ュ叿'];
            const statusAliases = ['鐘舵€'];
            const contentAliases = ['鏉╂柨娲'];
            const urlAliases = ['閸欘垵'];

            if (normalized === '工具名称' || TOOL_NAME_KEYS.has(lower) || toolNameAliases.some(alias => normalized.includes(alias))) {
                return '工具名称';
            }

            if (normalized === '执行状态' || STATUS_KEYS.has(lower) || lower.startsWith('status') || statusAliases.some(alias => normalized.includes(alias))) {
                return '执行状态';
            }

            if (normalized === '返回内容' || normalized === '返回结果' || normalized === '内容' || MARKDOWN_VALUE_KEYS.has(lower) || contentAliases.some(alias => normalized.includes(alias))) {
                return '返回内容';
            }

            if (normalized === '可访问URL' || IMAGE_VALUE_KEYS.has(lower) || urlAliases.some(alias => normalized.includes(alias))) {
                return '可访问URL';
            }

            return normalized;
        };

        let toolName = '未知工具';
        let status = '未知状态';
        const details = [];
        const otherContent = [];

        let currentKey = null;
        let currentValue = [];

        const commitField = () => {
            if (!currentKey) return;

            const value = currentValue.join('\n').trim();
            const normalizedKey = normalizeToolResultKey(currentKey);

            if (normalizedKey === '工具名称') {
                toolName = value || toolName;
            } else if (normalizedKey === '执行状态') {
                status = value || status;
            } else {
                details.push({ key: normalizedKey, value });
            }
        };

        lines.forEach((line) => {
            const kvMatch = line.match(/^-\s*([^:]+):\s*(.*)/);
            if (kvMatch) {
                commitField();
                currentKey = kvMatch[1].trim();
                currentValue = [kvMatch[2].trim()];
            } else if (currentKey) {
                currentValue.push(line);
            } else if (line.trim() !== '') {
                otherContent.push(line);
            }
        });

        commitField();

        let html = `<div class="unistudy-tool-result-bubble collapsible">`;
        html += `<div class="unistudy-tool-result-header">`;
        html += `<span class="unistudy-tool-result-label">Tool Result</span>`;
        html += `<span class="unistudy-tool-result-name">${escapeHtml(toolName)}</span>`;
        html += `<span class="unistudy-tool-result-status">${escapeHtml(status)}</span>`;
        html += `<span class="unistudy-result-toggle-icon"></span>`;
        html += `</div>`;

        html += `<div class="unistudy-tool-result-collapsible-content">`;
        html += `<div class="unistudy-tool-result-details">`;

        details.forEach(({ key, value }) => {
            const isMarkdownField = key === '返回内容';
            const isImageUrl = typeof value === 'string' && /^https?:\/\/[^\s]+\.(jpeg|jpg|png|gif|webp)$/i.test(value);
            const isPreviewField = key === '可访问URL' || key === '返回内容';
            let processedValue;

            if (isImageUrl && isPreviewField) {
                processedValue = `<a href="${value}" target="_blank" rel="noopener noreferrer" title="打开预览"><img src="${value}" class="unistudy-tool-result-image" alt="生成图片"></a>`;
            } else if (isMarkdownField && mainRendererReferences.markedInstance) {
                try {
                    // Tool-result markdown is untrusted input, so escape it before parsing.
                    const escapedValue = escapeHtml(restoreBlocks(value));
                    processedValue = mainRendererReferences.markedInstance.parse(escapedValue);
                } catch (e) {
                    console.error('Failed to parse markdown in tool result', e);
                    processedValue = escapeHtml(restoreBlocks(value));
                }
            } else {
                processedValue = escapeHtml(restoreBlocks(value));
                processedValue = processedValue.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

                if (key === '返回内容') {
                    processedValue = processedValue.replace(/###(.*?)###/g, '<strong>$1</strong>');
                }
            }

            html += `<div class="unistudy-tool-result-item">`;
            html += `<span class="unistudy-tool-result-item-key">${escapeHtml(key)}:</span> `;
            const valueTag = (isMarkdownField && !isImageUrl) ? 'div' : 'span';
            html += `<${valueTag} class="unistudy-tool-result-item-value">${processedValue}</${valueTag}>`;
            html += `</div>`;
        });

        html += `</div>`;

        if (otherContent.length > 0) {
            const footerText = otherContent.join('\n');
            let processedFooter;
            if (mainRendererReferences.markedInstance) {
                try {
                    const escapedFooter = escapeHtml(restoreBlocks(footerText));
                    processedFooter = mainRendererReferences.markedInstance.parse(escapedFooter);
                } catch (e) {
                    console.error('Failed to parse markdown in tool result footer', e);
                    processedFooter = `<pre>${escapeHtml(restoreBlocks(footerText))}</pre>`;
                }
            } else {
                processedFooter = `<pre>${escapeHtml(restoreBlocks(footerText))}</pre>`;
            }
            html += `<div class="unistudy-tool-result-footer">${processedFooter}</div>`;
        }

        html += `</div>`;
        html += `</div>`;

        return html;
    });

    const renderDiaryBubble = ({ title = '学习日志 Learning Log', notebook = '', date = '', content = '' }) => {
        let html = `<div class="learning-diary-bubble">`;
        html += `<div class="diary-header">`;
        html += `<span class="diary-title">${escapeHtml(title)}</span>`;
        if (date) {
            html += `<span class="diary-date">${escapeHtml(date)}</span>`;
        }
        html += `</div>`;

        if (notebook) {
            html += `<div class="diary-notebook-info">`;
            html += `<span class="diary-notebook-label">日志本:</span> `;
            html += `<span class="diary-notebook-name">${escapeHtml(notebook)}</span>`;
            html += `</div>`;
        }

        let processedDiaryContent;
        if (mainRendererReferences.markedInstance) {
            try {
                processedDiaryContent = mainRendererReferences.markedInstance.parse(restoreBlocks(content));
            } catch (e) {
                processedDiaryContent = escapeHtml(restoreBlocks(content));
            }
        } else {
            processedDiaryContent = escapeHtml(restoreBlocks(content));
        }

        html += `<div class="diary-content">${processedDiaryContent}</div>`;
        html += `</div>`;
        return html;
    };

    // Process Tool Requests
    processed = processed.replace(TOOL_REGEX, (match, content) => {
        const readLineValue = (source, key) => {
            const pattern = new RegExp(`${key}:\\s*([^\\n\\r]+)`, 'i');
            const matchResult = source.match(pattern);
            return matchResult ? matchResult[1].trim() : '';
        };

        const readBlockValue = (source, key) => {
            const taggedPattern = new RegExp(`<${key}>([\\s\\S]*?)<\\/${key}>`, 'i');
            const taggedMatch = source.match(taggedPattern);
            if (taggedMatch) {
                return taggedMatch[1].trim();
            }

            const lineValue = readLineValue(source, key);
            if (lineValue) {
                return lineValue;
            }

            if (key.toLowerCase() === 'content') {
                const contentPattern = /content:\s*([\s\S]*)/i;
                const contentMatch = source.match(contentPattern);
                return contentMatch ? contentMatch[1].trim() : '';
            }

            return '';
        };

        const normalizeWrappedValue = (value) => {
            const textValue = String(value || '').trim();
            const wrappedMatch = textValue.match(/^「始」([\s\S]*?)「末」,?$/);
            return wrappedMatch ? wrappedMatch[1].trim() : textValue.replace(/,$/, '').trim();
        };

        const toolNameFromContent = readBlockValue(content, 'tool_name') || readLineValue(content, 'tool_name');
        const commandFromContent = readBlockValue(content, 'command') || readLineValue(content, 'command');
        const normalizedToolName = normalizeWrappedValue(toolNameFromContent);
        const normalizedCommand = normalizeWrappedValue(commandFromContent).toLowerCase();
        const isDailyNoteTool = /DailyNote/i.test(normalizedToolName);
        const isDailyNoteCreate = isDailyNoteTool && normalizedCommand === 'create';
        const isDailyNoteUpdate = isDailyNoteTool && normalizedCommand === 'update';

        if (isDailyNoteCreate || isDailyNoteUpdate) {
            const notebook = normalizeWrappedValue(readLineValue(content, 'maid') || readLineValue(content, 'maidName'));
            const date = normalizeWrappedValue(readLineValue(content, 'date') || readLineValue(content, 'Date'));

            if (isDailyNoteCreate) {
                const diaryContent = normalizeWrappedValue(readBlockValue(content, 'Content')) || '[Diary content unavailable]';
                return renderDiaryBubble({
                    title: '学习日志 Learning Log',
                    notebook,
                    date,
                    content: diaryContent,
                });
            }

            const target = normalizeWrappedValue(readBlockValue(content, 'target')) || '[Original content unavailable]';
            const replace = normalizeWrappedValue(readBlockValue(content, 'replace')) || '[Updated content unavailable]';
            const updateContent = [
                '**Original**',
                '',
                target,
                '',
                '**Updated**',
                '',
                replace,
            ].join('\n');

            return renderDiaryBubble({
                title: '学习日志更新 Learning Log Update',
                notebook,
                date,
                content: updateContent,
            });
        } else {
            // --- It's a regular tool call, render it normally ---
            let toolName = 'Processing...';
            if (normalizedToolName) {
                const extractedName = normalizedToolName;
                if (extractedName) {
                    toolName = extractedName;
                }
            }

            const escapedFullContent = escapeHtml(restoreBlocks(content));
            return `<div class="vcp-tool-use-bubble">` +
                `<div class="unistudy-tool-summary">` +
                `<span class="unistudy-tool-label">Tool Use:</span> ` +
                `<span class="unistudy-tool-name-highlight">${escapeHtml(toolName)}</span>` +
                `</div>` +
                `<div class="unistudy-tool-details"><pre>${escapedFullContent}</pre></div>` +
                `</div>`;
        }
    });

    // Process Daily Notes
    processed = processed.replace(NOTE_REGEX, (match, rawContent) => {
        const content = rawContent.trim();
        const maidRegex = /(?:Maid|日志本):\s*([^\n\r]*)/;
        const dateRegex = /Date:\s*([^\n\r]*)/;
        const contentRegex = /Content:\s*([\s\S]*)/;

        const maidMatch = content.match(maidRegex);
        const dateMatch = content.match(dateRegex);
        const contentMatch = content.match(contentRegex);

        const notebook = maidMatch ? maidMatch[1].trim() : '';
        const date = dateMatch ? dateMatch[1].trim() : '';
        // The rest of the text after "Content:", or the full text if "Content:" is not found
        const diaryContent = contentMatch ? contentMatch[1].trim() : content;

        let html = `<div class="learning-diary-bubble">`;
        html += `<div class="diary-header">`;
        html += `<span class="diary-title">学习日志 Learning Log</span>`;
        if (date) {
            html += `<span class="diary-date">${escapeHtml(date)}</span>`;
        }
        html += `</div>`;

        if (notebook) {
            html += `<div class="diary-notebook-info">`;
            html += `<span class="diary-notebook-label">日志本:</span> `;
            html += `<span class="diary-notebook-name">${escapeHtml(notebook)}</span>`;
            html += `</div>`;
        }

        let processedDiaryContent;
        if (mainRendererReferences.markedInstance) {
            try {
                processedDiaryContent = mainRendererReferences.markedInstance.parse(restoreBlocks(diaryContent));
            } catch (e) {
                processedDiaryContent = escapeHtml(restoreBlocks(diaryContent));
            }
        } else {
            processedDiaryContent = escapeHtml(restoreBlocks(diaryContent));
        }
        html += `<div class="diary-content">${processedDiaryContent}</div>`;
        html += `</div>`;

        return html;
    });

        // Process VCP thought chains.
    const renderThoughtChain = (theme, rawContent) => {
        const displayTheme = theme ? theme.trim() : '\u5143\u601d\u8003\u94fe';
        const content = rawContent.trim();
        const escapedContent = escapeHtml(restoreBlocks(content));

        let html = `<div class="vcp-thought-chain-bubble collapsible">`;
        html += `<div class="unistudy-thought-chain-header">`;
        html += `<span class="unistudy-thought-chain-icon">?</span>`;
        html += `<span class="unistudy-thought-chain-label">${escapeHtml(displayTheme)}</span>`;
        html += `<span class="unistudy-result-toggle-icon"></span>`;
        html += `</div>`;

        html += `<div class="unistudy-thought-chain-collapsible-content">`;

        let processedContent;
        if (mainRendererReferences.markedInstance) {
            try {
                processedContent = mainRendererReferences.markedInstance.parse(restoreBlocks(content));
            } catch (e) {
                processedContent = `<pre>${escapedContent}</pre>`;
            }
        } else {
            processedContent = `<pre>${escapedContent}</pre>`;
        }

        html += `<div class="unistudy-thought-chain-body">${processedContent}</div>`;
        html += `</div>`; // End of unistudy-thought-chain-collapsible-content
        html += `</div>`; // End of vcp-thought-chain-bubble

        return html;
    };

    processed = processed.replace(THOUGHT_CHAIN_REGEX, (match, theme, rawContent) => {
        return renderThoughtChain(theme, rawContent);
    });

    // Process conventional thought chains (<think>...</think>).
    processed = processed.replace(CONVENTIONAL_THOUGHT_REGEX, (match, rawContent) => {
        return renderThoughtChain('\u601d\u8003\u8fc7\u7a0b', rawContent);
    });

    // Desktop push blocks are already handled after code-block protection in preprocessFullContent.
    // Do not reprocess them here or we risk colliding with code-fence content.

    // Process role dividers.
    processed = processed.replace(ROLE_DIVIDER_REGEX, (match, isEnd, role) => {
        const isEndMarker = !!isEnd;
        const roleLower = role.toLowerCase();

        let label = '';
        if (roleLower === 'system') label = '\u7cfb\u7edf';
        else if (roleLower === 'assistant') label = '\u52a9\u624b';
        else if (roleLower === 'user') label = '\u7528\u6237';

        const actionText = isEndMarker ? '\u7ed3\u675f' : '\u5f00\u59cb';

        return `<div class="unistudy-role-divider role-${roleLower} type-${isEndMarker ? 'end' : 'start'}"><span class="divider-text">\u89d2\u8272\u5206\u9694: ${label} [${actionText}]</span></div>`;
    });

    return processed;
}

/**
 * Transforms user's "clicked button" indicators into styled bubbles.
 * @param {string} text The text content.
 * @returns {string} The processed text.
 */
function transformUserButtonClick(text) {
    return text.replace(BUTTON_CLICK_REGEX, (match, content) => {
        const escapedContent = escapeHtml(content.trim());
        return `<span class="user-clicked-button-bubble">${escapedContent}</span>`;
    });
}

function transformUniStudyChatCanvas(text) {
    return text.replace(CANVAS_PLACEHOLDER_REGEX, () => {
        // Use a div for better block-level layout and margin behavior
        return `<div class="unistudy-chat-canvas-placeholder">Canvas content is not supported in UniStudy.</div>`;
    });
}

function extractSpeakableTextFromContentElement(contentElement) {
    if (!contentElement) return '';

    const contentClone = contentElement.cloneNode(true);
    contentClone.querySelectorAll(
        '.vcp-tool-use-bubble, .unistudy-tool-result-bubble, .learning-diary-bubble, .unistudy-role-divider, .vcp-thought-chain-bubble, style, script'
    ).forEach(el => el.remove());

    return (contentClone.innerText || '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Extracts <style> tags from content, scopes the CSS, and injects it into the document head.
 * @param {string} content - The raw message content string.
 * @param {string} scopeId - The unique ID for scoping.
 * @returns {{processedContent: string, styleInjected: boolean}} The content with <style> tags removed, and a flag indicating if styles were injected.
 */
function processAndInjectScopedCss(content, scopeId) {
    let cssContent = '';
    let styleInjected = false;

    const processedContent = content.replace(STYLE_REGEX, (match, css) => {
        cssContent += css.trim() + '\n';
        return ''; // Remove style tags from the content
    });

    if (cssContent.length > 0) {
        try {
            const scopedCss = contentProcessor.scopeCss(cssContent, scopeId);

            const styleElement = document.createElement('style');
            styleElement.type = 'text/css';
            styleElement.setAttribute('data-unistudy-scope-id', scopeId);
            styleElement.textContent = scopedCss;
            document.head.appendChild(styleElement);
            styleInjected = true;

            console.debug(`[ScopedCSS] Injected scoped styles for ID: #${scopeId}`);
        } catch (error) {
            console.error(`[ScopedCSS] Failed to scope or inject CSS for ID: ${scopeId}`, error);
        }
    }

    return { processedContent, styleInjected };
}


/**
 * Wraps raw HTML documents in markdown code fences if they aren't already.
 * An HTML document is identified by the `<!DOCTYPE html>` declaration.
 * @param {string} text The text content.
 * @returns {string} The processed text.
 */
/**
 * Wraps raw HTML documents in markdown code fences if they aren't already.
 * Skip HTML inside protected start/end markers so tool payloads are not fenced by mistake.
 */
function ensureHtmlFenced(text) {
    const doctypeTag = '<!DOCTYPE html>';
    const htmlCloseTag = '</html>';
    const lowerText = text.toLowerCase();

    // Already fenced; no additional work needed.
    if (HTML_FENCE_CHECK_REGEX.test(text)) {
        return text;
    }

    // Fast exit when there is no HTML document marker.
    if (!lowerText.includes(doctypeTag.toLowerCase())) {
        return text;
    }

    // Build protected ranges for start/end markers.
    const protectedRanges = [];    const START_MARKER = '???';    const END_MARKER = '???';
    let searchStart = 0;

    while (true) {
        const startPos = text.indexOf(START_MARKER, searchStart);
        if (startPos === -1) break;

        const endPos = text.indexOf(END_MARKER, startPos + START_MARKER.length);
        if (endPos === -1) {
            // An unfinished start marker can reach the text tail during streaming.
            protectedRanges.push({ start: startPos, end: text.length });
            break;
        }

        protectedRanges.push({ start: startPos, end: endPos + END_MARKER.length });
        searchStart = endPos + END_MARKER.length;
    }

    // Check whether a position falls inside a protected range.
    const isProtected = (index) => {
        return protectedRanges.some(range => index >= range.start && index < range.end);
    };

    let result = '';
    let lastIndex = 0;

    while (true) {
        const startIndex = text.toLowerCase().indexOf(doctypeTag.toLowerCase(), lastIndex);

        result += text.substring(lastIndex, startIndex === -1 ? text.length : startIndex);

        if (startIndex === -1) break;

        const endIndex = text.toLowerCase().indexOf(htmlCloseTag.toLowerCase(), startIndex + doctypeTag.length);

        if (endIndex === -1) {
            result += text.substring(startIndex);
            break;
        }

        const block = text.substring(startIndex, endIndex + htmlCloseTag.length);

        // Keep HTML untouched when it is already inside a protected start/end segment.
        if (isProtected(startIndex)) {
            result += block;
            lastIndex = endIndex + htmlCloseTag.length;
            continue;
        }

        // Normal path: only wrap HTML when we are outside fenced code.
        const fencesInResult = (result.match(/```/g) || []).length;

        if (fencesInResult % 2 === 0) {
            result += `\n\`\`\`html\n${block}\n\`\`\`\n`;
        } else {
            result += block;
        }

        lastIndex = endIndex + htmlCloseTag.length;
    }

    return result;
}


/**
 * Removes leading whitespace from lines that appear to be HTML tags,
 * as long as they are not inside a fenced code block. This prevents
 * the markdown parser from misinterpreting indented HTML as an indented code block.
 * @param {string} text The text content.
 * @returns {string} The processed text.
 */
function deIndentHtml(text) {
    const lines = text.split('\n');
    let inFence = false;
    return lines.map(line => {
        if (line.trim().startsWith('```')) {
            inFence = !inFence;
            return line;
        }

    // Keep inline <img> tags intact instead of splitting them.
        if (!inFence && line.includes('<img')) {
            return line; // 娣囨繃瀵旈崢鐔哥壉
        }

        if (!inFence && /^\s+<(!|[a-zA-Z])/.test(line)) {
            return line.trimStart();
        }
        return line;
    }).join('\n');
}


/**
 * Calculate message depth using conversation turns.
 * @param {string} messageId Target message id.
 * @param {Array<Message>} history Full chat history array.
 * @returns {number} Calculated depth where 1 is the newest turn.
 */
function calculateDepthByTurns(messageId, history) {
    const turns = [];
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'assistant') {
            const turn = { assistant: history[i], user: null };
            if (i > 0 && history[i - 1].role === 'user') {
                turn.user = history[i - 1];
                i--;
            }
            turns.push(turn); // Use push while iterating backward.
        } else if (history[i].role === 'user') {
            turns.push({ assistant: null, user: history[i] });
        }
    }
    turns.reverse(); // Reverse once to restore chronological order.

    const turnIndex = turns.findIndex(t =>
        (t.assistant?.id === messageId) || (t.user?.id === messageId)
    );
    return turnIndex !== -1 ? (turns.length - 1 - turnIndex) : 0;
}


/**
 * A helper function to preprocess the full message content string before parsing.
 * @param {string} text The raw text content.
 * @returns {string} The processed text.
 */
function preprocessFullContent(text, settings = {}, messageRole = 'assistant', depth = 0) {
    if (!contentPipeline) {
        console.warn('[MessageRenderer] contentPipeline not initialized, falling back to raw text');
        return text;
    }

    return contentPipeline.process(text, {
        mode: PIPELINE_MODES.FULL_RENDER,
        settings,
        messageRole,
        depth
    }).text;
}

/**
 * Normalize emoticon URLs inside Markdown and HTML image tags.
 */
function fixEmoticonUrlsInMarkdown(text) {
    if (!text || typeof text !== 'string') return text;

    // 1. Normalize Markdown image syntax: ![alt](url)
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        if (emoticonUrlFixer && emoticonUrlFixer.fixEmoticonUrl) {
            const fixedUrl = emoticonUrlFixer.fixEmoticonUrl(url);
            if (fixedUrl !== url) {
                console.debug(`[PreprocessFix] Markdown image: ${url} -> ${fixedUrl}`);
            }
            return `![${alt}](${fixedUrl})`;
        }
        return match;
    });

    // 2. Normalize HTML image tags: <img src="url" ...>
    text = text.replace(/<img([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi, (match, before, url, after) => {
        if (emoticonUrlFixer && emoticonUrlFixer.fixEmoticonUrl) {
            const fixedUrl = emoticonUrlFixer.fixEmoticonUrl(url);
            if (fixedUrl !== url) {
                console.debug(`[PreprocessFix] HTML image: ${url} -> ${fixedUrl}`);
            }
            return `<img${before}src="${fixedUrl}"${after}>`;
        }
        return match;
    });

    return text;
}

/**
 * @typedef {Object} Message
 * @property {'user'|'assistant'|'system'} role
 * @property {string} content
 * @property {number} timestamp
 * @property {string} [id] 
 * @property {boolean} [isThinking]
 * @property {Array<{type: string, src: string, name: string}>} [attachments]
 * @property {string} [finishReason] 
 * @property {string} [agentId]
 * @property {string} [name]
 * @property {string} [avatarUrl]
 * @property {string} [avatarColor] // New: Specific avatar color for this message
 */


/**
 * @typedef {Object} CurrentSelectedItem
 * @property {string|null} id - The selected agent ID
 * @property {'agent'|null} type 
 * @property {string|null} name
 * @property {string|null} avatarUrl
 * @property {object|null} config - Full config of the selected item
 */


let mainRendererReferences = {
    currentChatHistoryRef: { get: () => [], set: () => { } }, // Ref to array
    currentSelectedItemRef: { get: () => ({ id: null, type: null, name: null, avatarUrl: null, config: null }), set: () => { } }, // Ref to object
    currentTopicIdRef: { get: () => null, set: () => { } }, // Ref to string/null
    globalSettingsRef: { get: () => ({ userName: 'User', userAvatarUrl: '../assets/default_user_avatar.png', userAvatarCalculatedColor: null }), set: () => { } }, // Ref to object
    setActiveRequestId: () => { },
    generateFollowUpsForAssistantMessage: async () => [],

    chatMessagesDiv: null,
    electronAPI: null,
    markedInstance: null,
    uiHelper: {
        scrollToBottom: () => { },
        openModal: () => { },
        autoResizeTextarea: () => { },
        // ... other uiHelper functions ...
    },
    summarizeTopicFromMessages: async () => "",
    // activeStreamingMessageId: null, // ID of the message currently being streamed - REMOVED
};


let contentPipeline = null;

let activeRenderSessionId = 0;

function invalidateRenderSession() {
    activeRenderSessionId += 1;
    return activeRenderSessionId;
}

function getActiveRenderSessionId() {
    return activeRenderSessionId;
}

function isRenderSessionActive(sessionId) {
    return sessionId === activeRenderSessionId;
}

function removeMessageById(messageId, saveHistory = false) {
    const item = mainRendererReferences.chatMessagesDiv.querySelector(`.message-item[data-message-id="${messageId}"]`);
    if (item) {
        // --- NEW: Cleanup dynamic content before removing from DOM ---
        const contentDiv = item.querySelector('.md-content');
        if (contentDiv) {
            contentProcessor.cleanupPreviewsInContent(contentDiv);
            cleanupAnimationsInContent(contentDiv);
        }
        // Release cached Pretext height data to avoid leaking memory.
        if (window.pretextBridge && window.pretextBridge.evict) {
            window.pretextBridge.evict(messageId);
        }
        // Stop observing visibility updates for the removed message.
        visibilityOptimizer.unobserveMessage(item);
        item.remove();
    }

    const currentChatHistoryArray = mainRendererReferences.currentChatHistoryRef.get();
    const index = currentChatHistoryArray.findIndex(m => m.id === messageId);

    if (index > -1) {
        currentChatHistoryArray.splice(index, 1);
        mainRendererReferences.currentChatHistoryRef.set([...currentChatHistoryArray]);
        window.updateSendButtonState?.();

        if (saveHistory) {
            const currentSelectedItemVal = mainRendererReferences.currentSelectedItemRef.get();
            const currentTopicIdVal = mainRendererReferences.currentTopicIdRef.get();
            if (currentSelectedItemVal.id && currentTopicIdVal) {
                if (currentSelectedItemVal.type === 'agent') {
                    mainRendererReferences.electronAPI.saveChatHistory(currentSelectedItemVal.id, currentTopicIdVal, currentChatHistoryArray);
                }
            }
        }
    }
}

function clearChat(options = {}) {
    const { preserveHistory = false } = options;
    invalidateRenderSession();

    if (mainRendererReferences.chatMessagesDiv) {
        // --- NEW: Cleanup all messages before clearing the container ---
        const allMessages = mainRendererReferences.chatMessagesDiv.querySelectorAll('.message-item');
        allMessages.forEach(item => {
            const contentDiv = item.querySelector('.md-content');
            if (contentDiv) {
                contentProcessor.cleanupPreviewsInContent(contentDiv);
                cleanupAnimationsInContent(contentDiv);
            }
            visibilityOptimizer.unobserveMessage(item);
        });

        // Remove all injected scoped CSS blocks.
        document.querySelectorAll('style[data-unistudy-scope-id]').forEach(el => el.remove());
        // Clear cached Pretext heights when the whole chat view resets.
        if (window.pretextBridge && window.pretextBridge.clearAll) {
            window.pretextBridge.clearAll();
        }

        mainRendererReferences.chatMessagesDiv.innerHTML = '';
    }
    if (!preserveHistory) {
        mainRendererReferences.currentChatHistoryRef.set([]); // Clear the history array via its ref
    }
    window.updateSendButtonState?.();
}


function initializeMessageRenderer(refs) {
    if (delegatedEventTarget && delegatedClickHandler) {
        delegatedEventTarget.removeEventListener('click', delegatedClickHandler);
    }
    if (delegatedEventTarget && delegatedContextMenuHandler) {
        delegatedEventTarget.removeEventListener('contextmenu', delegatedContextMenuHandler);
    }

    Object.assign(mainRendererReferences, refs);

    contentPipeline = createContentPipeline({
        escapeHtml,
        processStartEndMarkers: contentProcessor.processStartEndMarkers,
        fixEmoticonUrlsInMarkdown,
        deIndentMisinterpretedCodeBlocks: contentProcessor.deIndentMisinterpretedCodeBlocks,
        deIndentHtml,
        deIndentToolRequestBlocks: contentProcessor.deIndentToolRequestBlocks,
        applyContentProcessors: contentProcessor.applyContentProcessors,
        transformSpecialBlocks,
        ensureHtmlFenced,
        transformMermaidPlaceholders: (text) => {
            let transformed = text.replace(MERMAID_CODE_REGEX, (match, lang, code) => {
                const tempEl = document.createElement('textarea');
                tempEl.innerHTML = code;
                const encodedCode = encodeURIComponent(tempEl.value.trim());
                return `<div class="mermaid-placeholder" data-mermaid-code="${encodedCode}"></div>`;
            });

            transformed = transformed.replace(MERMAID_FENCE_REGEX, (match, lang, code) => {
                const encodedCode = encodeURIComponent(code.trim());
                return `<div class="mermaid-placeholder" data-mermaid-code="${encodedCode}"></div>`;
            });

            return transformed;
        },
        getToolResultRegex: () => TOOL_RESULT_REGEX,
        getCodeFenceRegex: () => CODE_FENCE_REGEX,
        getDesktopPushRegex: () => DESKTOP_PUSH_REGEX,
        getDesktopPushPartialRegex: () => DESKTOP_PUSH_PARTIAL_REGEX,
    });

    initializeImageHandler({
        electronAPI: mainRendererReferences.electronAPI,
        uiHelper: mainRendererReferences.uiHelper,
        chatMessagesDiv: mainRendererReferences.chatMessagesDiv,
    });

    // Start the emoticon fixer initialization, but don't wait for it here.
    // The await will happen inside renderMessage to ensure it's ready before rendering.
    emoticonUrlFixer.initialize(mainRendererReferences.electronAPI);

    // Initialize the visibility optimizer with the scrollable chat container as root.
    const scrollContainer = mainRendererReferences.chatMessagesDiv.closest('.chat-messages-container');
    visibilityOptimizer.destroyVisibilityOptimizer();
    visibilityOptimizer.initializeVisibilityOptimizer(scrollContainer || mainRendererReferences.chatMessagesDiv);

    // --- Event Delegation ---
    delegatedEventTarget = mainRendererReferences.chatMessagesDiv;
    delegatedClickHandler = (e) => {
        // 1. Handle collapsible tool results and thought chains
        const toolHeader = e.target.closest('.unistudy-tool-result-header');
        if (toolHeader) {
            const bubble = toolHeader.closest('.unistudy-tool-result-bubble.collapsible');
            if (bubble) {
                bubble.classList.toggle('expanded');
            }
            return;
        }

        const thoughtHeader = e.target.closest('.unistudy-thought-chain-header');
        if (thoughtHeader) {
            const bubble = thoughtHeader.closest('.vcp-thought-chain-bubble.collapsible');
            if (bubble) {
                bubble.classList.toggle('expanded');
            }
            return;
        }
    };
    mainRendererReferences.chatMessagesDiv.addEventListener('click', delegatedClickHandler);

    // Delegated context menu
    delegatedContextMenuHandler = (e) => {
        const messageItem = e.target.closest('.message-item');
        if (!messageItem) return;

        const messageId = messageItem.dataset.messageId;
        const message = mainRendererReferences.currentChatHistoryRef.get()
            .find(m => m.id === messageId);

        if (message && (message.role === 'assistant' || message.role === 'user')) {
            e.preventDefault();
            contextMenu.showContextMenu(e, messageItem, message);
        }
    };
    mainRendererReferences.chatMessagesDiv.addEventListener('contextmenu', delegatedContextMenuHandler);
    // --- End Event Delegation ---

    // Create a new marked instance wrapper specifically for the stream manager.
    const originalMarkedParse = mainRendererReferences.markedInstance.parse.bind(mainRendererReferences.markedInstance);
    const streamingMarkedInstance = {
        ...mainRendererReferences.markedInstance,
        parse: (text) => {
            const globalSettings = mainRendererReferences.globalSettingsRef.get();
            const processedText = preprocessFullContent(text, globalSettings);
            // Protect LaTeX before parsing Markdown.
            const { text: protectedText, map: latexMap } = protectLatexBlocks(processedText);
            let html = originalMarkedParse(protectedText);
            // Restore protected LaTeX after parsing.
            html = restoreLatexBlocks(html, latexMap);
            return html;
        }
    };

    contentProcessor.initializeContentProcessor(mainRendererReferences);

    const wrappedProcessRenderedContent = (contentDiv) => {
        const globalSettings = mainRendererReferences.globalSettingsRef.get();
        contentProcessor.processRenderedContent(contentDiv, globalSettings);
    };

    contextMenu.initializeContextMenu(mainRendererReferences, {
        removeMessageById: removeMessageById,
        finalizeStreamedMessage: finalizeStreamedMessage,
        renderMessage: renderMessage,
        startStreamingMessage: startStreamingMessage,
        setContentAndProcessImages: setContentAndProcessImages,
        processRenderedContent: wrappedProcessRenderedContent,
        runTextHighlights: contentProcessor.highlightAllPatternsInMessage,
        preprocessFullContent: preprocessFullContent,
        renderAttachments: renderAttachments,
        interruptHandler: mainRendererReferences.interruptHandler,
        setActiveRequestId: mainRendererReferences.setActiveRequestId,
        generateFollowUpsForAssistantMessage: mainRendererReferences.generateFollowUpsForAssistantMessage,
        updateMessageContent: updateMessageContent, // Pass through updateMessageContent.
        extractSpeakableTextFromContentElement: extractSpeakableTextFromContentElement,
    });

    streamManager.initStreamManager({
        globalSettingsRef: mainRendererReferences.globalSettingsRef,
        currentChatHistoryRef: mainRendererReferences.currentChatHistoryRef,
        currentSelectedItemRef: mainRendererReferences.currentSelectedItemRef,
        currentTopicIdRef: mainRendererReferences.currentTopicIdRef,
        chatMessagesDiv: mainRendererReferences.chatMessagesDiv,
        markedInstance: streamingMarkedInstance,
        electronAPI: mainRendererReferences.electronAPI,
        uiHelper: mainRendererReferences.uiHelper,
        morphdom: window.morphdom,
        renderMessage: renderMessage,
        showContextMenu: contextMenu.showContextMenu,
        setContentAndProcessImages: setContentAndProcessImages,
        processRenderedContent: wrappedProcessRenderedContent,
        runTextHighlights: contentProcessor.highlightAllPatternsInMessage,
        preprocessFullContent: preprocessFullContent,
        removeSpeakerTags: contentProcessor.removeSpeakerTags,
        ensureNewlineAfterCodeBlock: contentProcessor.ensureNewlineAfterCodeBlock,
        ensureSpaceAfterTilde: contentProcessor.ensureSpaceAfterTilde,
        removeIndentationFromCodeBlockMarkers: contentProcessor.removeIndentationFromCodeBlockMarkers,
        deIndentMisinterpretedCodeBlocks: contentProcessor.deIndentMisinterpretedCodeBlocks, // Pass through helper.
        processStartEndMarkers: contentProcessor.processStartEndMarkers, // Pass through safety helper.
        ensureSeparatorBetweenImgAndCode: contentProcessor.ensureSeparatorBetweenImgAndCode,
        processAnimationsInContent: processAnimationsInContent,
        emoticonUrlFixer: emoticonUrlFixer, // ? Pass emoticon fixer for live updates
        enhancedRenderDebounceTimers: enhancedRenderDebounceTimers,
        ENHANCED_RENDER_DEBOUNCE_DELAY: ENHANCED_RENDER_DEBOUNCE_DELAY,
        DIARY_RENDER_DEBOUNCE_DELAY: DIARY_RENDER_DEBOUNCE_DELAY,
    });
    injectEnhancedStyles();
    console.log("[MessageRenderer] Initialized. Current selected item type on init:", mainRendererReferences.currentSelectedItemRef.get()?.type);
}


function setCurrentSelectedItem(item) {
    // This function is mainly for renderer.js to update the shared state.
    // messageRenderer will read from currentSelectedItemRef.get() when rendering.
    // console.log("[MessageRenderer] setCurrentSelectedItem called with:", item);
}

function setCurrentTopicId(topicId) {
    // console.log("[MessageRenderer] setCurrentTopicId called with:", topicId);
}

// These are for the current UniStudy chat context avatar state.
function setCurrentItemAvatar(avatarUrl) { // Renamed from setCurrentAgentAvatar
// This updates the avatar for the main selected UniStudy agent.
    // The currentSelectedItemRef should hold the correct avatar for the overall context.
}

function setUserAvatar(avatarUrl) { // For the user's global avatar
    const globalSettings = mainRendererReferences.globalSettingsRef.get();
    const oldUrl = globalSettings.userAvatarUrl;
    if (oldUrl && oldUrl !== (avatarUrl || '../assets/default_user_avatar.png')) {
        avatarColorCache.delete(oldUrl.split('?')[0]);
    }
    mainRendererReferences.globalSettingsRef.set({ ...globalSettings, userAvatarUrl: avatarUrl || '../assets/default_user_avatar.png' });
}

function setCurrentItemAvatarColor(color) { // Renamed from setCurrentAgentAvatarColor
// For the main selected UniStudy agent
}

function setUserAvatarColor(color) { // For the user's global avatar
    const globalSettings = mainRendererReferences.globalSettingsRef.get();
    mainRendererReferences.globalSettingsRef.set({ ...globalSettings, userAvatarCalculatedColor: color });
}
function getAttachmentFileVisualDescriptor(name = '', type = '') {
    const resolver = window.uiHelperFunctions?.resolveAttachmentFileVisual;
    if (typeof resolver === 'function') {
        return resolver(name, type);
    }
    return {
        kind: 'file',
        iconMarkup: `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"></path>
    <path d="M14 2v5a1 1 0 0 0 1 1h5"></path>
</svg>`
    };
}

async function renderAttachments(message, contentDiv) {
    const { electronAPI } = mainRendererReferences;
    if (message.attachments && message.attachments.length > 0) {
        const attachmentsContainer = document.createElement('div');
        attachmentsContainer.classList.add('message-attachments');
        message.attachments.forEach((att) => {
            const wrapper = document.createElement('div');
            wrapper.classList.add('message-attachment-wrapper');
            
            let attachmentElement;
            if (att.type.startsWith('image/')) {
                attachmentElement = document.createElement('img');
                attachmentElement.src = att.src;
                attachmentElement.alt = `Image attachment: ${att.name}`;
                attachmentElement.title = `Open in a new window: ${att.name}`;
                attachmentElement.classList.add('message-attachment-image-thumbnail');
                attachmentElement.onclick = (e) => {
                    e.stopPropagation();
                    const currentTheme = document.body.classList.contains('light-theme') ? 'light' : 'dark';
                    electronAPI.openImageViewer({ src: att.src, title: att.name, theme: currentTheme });
                };
                attachmentElement.addEventListener('contextmenu', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    electronAPI.showImageContextMenu(att.src);
                });
            } else if (att.type.startsWith('audio/')) {
                attachmentElement = document.createElement('audio');
                attachmentElement.src = att.src;
                attachmentElement.controls = true;
            } else if (att.type.startsWith('video/')) {
                attachmentElement = document.createElement('video');
                attachmentElement.src = att.src;
                attachmentElement.controls = true;
                attachmentElement.style.maxWidth = '300px';
            } else {
                attachmentElement = document.createElement('a');
                attachmentElement.href = att.src;
                const fileVisual = getAttachmentFileVisualDescriptor(att.name, att.type);
                attachmentElement.classList.add('message-attachment-file', `message-attachment-file--${fileVisual.kind}`);
                attachmentElement.title = `Open file: ${att.name}`;
                attachmentElement.onclick = (e) => {
                    e.preventDefault();
                    if (electronAPI.sendOpenExternalLink && att.src.startsWith('file://')) {
                        electronAPI.sendOpenExternalLink(att.src);
                    } else {
                        console.warn("Cannot open local file attachment", att.src);
                    }
                };
                const iconSpan = document.createElement('span');
                iconSpan.className = 'message-attachment-file-icon';
                iconSpan.innerHTML = fileVisual.iconMarkup;
                const nameSpan = document.createElement('span');
                nameSpan.className = 'message-attachment-file-name';
                nameSpan.textContent = att.name;
                attachmentElement.appendChild(iconSpan);
                attachmentElement.appendChild(nameSpan);
            }
            if (attachmentElement) {
                wrapper.appendChild(attachmentElement);
                attachmentsContainer.appendChild(wrapper);
            }
        });
        contentDiv.appendChild(attachmentsContainer);
    }
}

function renderKnowledgeBaseRefs(message, contentDiv) {
    if (!Array.isArray(message?.kbContextRefs) || message.kbContextRefs.length === 0) {
        return;
    }

    const refsContainer = document.createElement('div');
    refsContainer.className = 'message-kb-refs';

    const title = document.createElement('div');
    title.className = 'message-kb-refs__title';
    title.textContent = 'KB 引用';
    refsContainer.appendChild(title);

    message.kbContextRefs.forEach((ref) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'message-kb-refs__item';
        const scoreParts = [];
        if (typeof ref.score === 'number') {
            scoreParts.push(`score ${ref.score}`);
        }
        if (typeof ref.vectorScore === 'number') {
            scoreParts.push(`vec ${ref.vectorScore}`);
        }
        if (typeof ref.rerankScore === 'number') {
            scoreParts.push(`rerank ${ref.rerankScore}`);
        }
        const locationParts = [];
        if (ref.pageNumber !== null && ref.pageNumber !== undefined && Number.isFinite(Number(ref.pageNumber))) {
            locationParts.push(`第 ${Number(ref.pageNumber)} 页`);
        }
        if (ref.paragraphIndex !== null && ref.paragraphIndex !== undefined && Number.isFinite(Number(ref.paragraphIndex))) {
            locationParts.push(`第 ${Number(ref.paragraphIndex)} 段`);
        }
        if (ref.sectionTitle) {
            locationParts.push(String(ref.sectionTitle));
        }
        item.innerHTML = `
            <strong>${escapeHtml(ref.documentName || ref.documentId || '未知文档')}</strong>
            <span>${escapeHtml(locationParts.join(' · ') || '点击回到阅读区')}</span>
            ${ref.snippet ? `<span>${escapeHtml(ref.snippet)}</span>` : ''}
            ${scoreParts.length > 0 ? `<span>${escapeHtml(scoreParts.join(' · '))}</span>` : ''}
        `;
        item.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('unistudy-open-kb-ref', {
                detail: ref,
            }));
        });
        refsContainer.appendChild(item);
    });

    contentDiv.appendChild(refsContainer);
}

async function renderMessage(message, isInitialLoad = false, appendToDom = true, renderSessionId = getActiveRenderSessionId()) {
    // console.debug('[MessageRenderer renderMessage] Received message:', JSON.parse(JSON.stringify(message)));
    const { chatMessagesDiv, electronAPI, markedInstance, uiHelper } = mainRendererReferences;
    const globalSettings = mainRendererReferences.globalSettingsRef.get();
    const currentSelectedItem = mainRendererReferences.currentSelectedItemRef.get();
    const currentChatHistory = mainRendererReferences.currentChatHistoryRef.get();

    // Prevent re-rendering if the message already exists in the DOM, unless it's a thinking message being replaced.
    const existingMessageDom = chatMessagesDiv.querySelector(`.message-item[data-message-id="${message.id}"]`);
    if (existingMessageDom && !existingMessageDom.classList.contains('thinking')) {
        // console.log(`[MessageRenderer] Message ${message.id} already in DOM. Skipping render.`);
        // return existingMessageDom;
    }

    if (!chatMessagesDiv || !electronAPI || !markedInstance) {
        console.error("MessageRenderer: Missing critical references for rendering.");
        return null;
    }

    if (!message.id) {
        message.id = `msg_${message.timestamp}_${Math.random().toString(36).substring(2, 9)}`;
    }

    const { messageItem, contentDiv, avatarImg, senderNameDiv } = createMessageSkeleton(message, globalSettings, currentSelectedItem);

    // --- NEW: Scoped CSS Implementation ---
    let scopeId = null;
    if (message.role === 'assistant') {
        scopeId = generateUniqueId();
        messageItem.id = scopeId; // Assign the unique ID to the message container
    }
    // --- END Scoped CSS Implementation ---


    // Resolve avatar color inputs before applying them.
    let avatarColorToUse;
    let avatarUrlToUse; // Resolved avatar URL for this message.
    let customBorderColor = null; // Optional custom avatar border color.
    let customNameColor = null; // Optional custom sender-name color.
    let shouldApplyColorToName = false; // Whether the sender name should mirror the avatar color.
    let useThemeColors = false; // Whether theme-driven colors take precedence.
    if (message.role === 'user') {
        avatarColorToUse = globalSettings.userAvatarCalculatedColor;
        avatarUrlToUse = globalSettings.userAvatarUrl;
        // Check whether the user wants theme colors inside the chat view.
        useThemeColors = globalSettings.userUseThemeColorsInChat || false;

        if (!useThemeColors) {
            // User messages can still use explicit custom colors when theme colors are off.
            customBorderColor = globalSettings.userAvatarBorderColor;
            customNameColor = globalSettings.userNameTextColor;
        }
        // User bubbles also tint the sender name.
        shouldApplyColorToName = true;
    } else if (message.role === 'assistant') {
    } else if (message.role === 'assistant') {
        if (currentSelectedItem) {
            avatarColorToUse = currentSelectedItem.config?.avatarCalculatedColor
                || currentSelectedItem.avatarCalculatedColor
                || currentSelectedItem.config?.avatarColor
                || currentSelectedItem.avatarColor;
            avatarUrlToUse = currentSelectedItem.avatarUrl;

            // For single-chat messages, read settings from the active agent.
            const agentConfig = currentSelectedItem.config || currentSelectedItem;
            if (agentConfig) {
                useThemeColors = agentConfig.useThemeColorsInChat || false;
                if (!useThemeColors) {
                    customBorderColor = agentConfig.avatarBorderColor;
                    customNameColor = agentConfig.nameTextColor;
                }
            }
        }
    }

    // Append the message to the DOM before starting visibility tracking.
    if (appendToDom) {
        chatMessagesDiv.appendChild(messageItem);
        // Observe the new message for visibility-based optimizations.
        visibilityOptimizer.observeMessage(messageItem);
    }

    if (message.isThinking) {
        contentDiv.innerHTML = `<span class="thinking-indicator">${message.content || '\u601d\u8003\u4e2d'}<span class="thinking-indicator-dots">...</span></span>`;
        messageItem.classList.add('thinking');
    } else {
        let textToRender = "";
        if (typeof message.content === 'string') {
            textToRender = message.content;
        } else if (message.content && typeof message.content.text === 'string') {
            // This case handles legacy structured content such as { text: "..." }.
            textToRender = message.content.text;
        } else if (message.content === null || message.content === undefined) {
            textToRender = ""; // Handle null or undefined content gracefully
            console.warn('[MessageRenderer] message.content is null or undefined for message ID:', message.id);
        } else {
            // Fallback for other unexpected object structures, log and use a placeholder
            console.warn('[MessageRenderer] Unexpected message.content type. Message ID:', message.id, 'Content:', JSON.stringify(message.content));
            textToRender = "[Message content format error]";
        }

        if (message.role === 'user') {
            textToRender = prepareUserMessageText(textToRender);
        } else if (message.role === 'assistant' && scopeId) {
            // Protect blocks that may legally contain <style> content before extracting styles.
            const protectedBlocks = [];
            
            // Protect tool request blocks because payloads may contain complete HTML documents.
            // Reuse the hardened TOOL_REGEX so backtick-wrapped payloads stay untouched.
            let textWithProtectedBlocks = textToRender.replace(TOOL_REGEX, (match) => {
                const placeholder = `__VCP_STYLE_PROTECT_${protectedBlocks.length}__`;
                protectedBlocks.push(match);
                return placeholder;
            });
            
            // Protect start/end marker blocks because they may contain arbitrary HTML.
            // Their content is tool payload data and must not be interpreted as page markup.
            textWithProtectedBlocks = textWithProtectedBlocks.replace(/「始」[\s\S]*?(「末」|$)/g, (match) => {
                const placeholder = `__VCP_STYLE_PROTECT_${protectedBlocks.length}__`;
                protectedBlocks.push(match);
                return placeholder;
            });
            
            // Protect desktop-push blocks before code-fence handling because they may include code fences.
            textWithProtectedBlocks = textWithProtectedBlocks.replace(DESKTOP_PUSH_REGEX, (match) => {
                const placeholder = `__VCP_STYLE_PROTECT_${protectedBlocks.length}__`;
                protectedBlocks.push(match);
                return placeholder;
            });
            // Also protect incomplete desktop-push blocks during streaming.
            textWithProtectedBlocks = textWithProtectedBlocks.replace(DESKTOP_PUSH_PARTIAL_REGEX, (match) => {
                const placeholder = `__VCP_STYLE_PROTECT_${protectedBlocks.length}__`;
                protectedBlocks.push(match);
                return placeholder;
            });
            
            // Protect fenced code blocks.
            textWithProtectedBlocks = textWithProtectedBlocks.replace(CODE_FENCE_REGEX, (match) => {
                const placeholder = `__VCP_STYLE_PROTECT_${protectedBlocks.length}__`;
                protectedBlocks.push(match);
                return placeholder;
            });

            // At this point only unprotected style tags can still be matched.
            const { processedContent: contentWithoutStyles } = processAndInjectScopedCss(textWithProtectedBlocks, scopeId);

            // Restore every protected block after scoped CSS extraction.
            textToRender = contentWithoutStyles;
            protectedBlocks.forEach((block, i) => {
                const placeholder = `__VCP_STYLE_PROTECT_${i}__`;
                textToRender = textToRender.replace(placeholder, block);
            });
            // --- End protected-style handling ---
        }

        // --- Calculate depth by conversation turn ---
        // New messages may not be inside history yet, so append them temporarily for depth calculation.
        const historyForDepthCalc = currentChatHistory.some(m => m.id === message.id)
            ? [...currentChatHistory]
            : [...currentChatHistory, message];
        const depth = calculateDepthByTurns(message.id, historyForDepthCalc);
        // --- End depth calculation ---

        // --- Apply frontend regex rules ---
        // Run regex transforms only on the full message to avoid breaking stream chunks.
        // This keeps pattern matching aligned with complete rendered content.
        const agentConfigForRegex = currentSelectedItem?.config || currentSelectedItem;
        if (agentConfigForRegex?.stripRegexes && Array.isArray(agentConfigForRegex.stripRegexes)) {
            textToRender = applyFrontendRegexRules(textToRender, agentConfigForRegex.stripRegexes, message.role, depth);
        }
        // End frontend regex rule application.

        const processedContent = preprocessFullContent(textToRender, globalSettings, message.role, depth);
        // Protect LaTeX before parsing Markdown.
        const { text: protectedContent, map: latexMap } = protectLatexBlocks(processedContent);
        let rawHtml = markedInstance.parse(protectedContent);
        // Restore protected LaTeX after parsing.
        rawHtml = restoreLatexBlocks(rawHtml, latexMap);
        // Fix malformed SVG viewBox attributes generated by Markdown parsing.
        // "Unexpected end of attribute" usually means the generated viewBox value was truncated.
        // This specifically guards against truncated values such as `viewBox="0 "`.
        rawHtml = rawHtml.replace(/viewBox="0 "/g, 'viewBox="0 0 24 24"');

        // Synchronously set the base HTML content
        const finalHtml = rawHtml;
        contentDiv.innerHTML = finalHtml;

        // Delay the Pretext height estimate to avoid blocking the first screen render.
        scheduleMessagePretextEstimate(message.id, textToRender, chatMessagesDiv);

        // Define the post-processing logic as a function.
        // This allows us to control WHEN it gets executed.
        const runPostRenderProcessing = async () => {
            if (!isRenderSessionActive(renderSessionId) || !messageItem.isConnected || !contentDiv.isConnected) {
                return;
            }

            // This function should only be called when messageItem is connected to the DOM.

            // Process images, attachments, and synchronous content first.
            setContentAndProcessImages(contentDiv, finalHtml, message.id);
            if (!isRenderSessionActive(renderSessionId) || !messageItem.isConnected || !contentDiv.isConnected) {
                return;
            }

            renderAttachments(message, contentDiv);
            renderKnowledgeBaseRefs(message, contentDiv);
            contentProcessor.processRenderedContent(contentDiv, globalSettings);
            await renderMermaidDiagrams(contentDiv); // Render mermaid diagrams

            if (!isRenderSessionActive(renderSessionId) || !messageItem.isConnected || !contentDiv.isConnected) {
                return;
            }

            // Defer TreeWalker-based highlighters with a hardcoded delay to ensure the DOM is stable.
            setTimeout(() => {
                if (isRenderSessionActive(renderSessionId) && contentDiv && contentDiv.isConnected) {
                    contentProcessor.highlightAllPatternsInMessage(contentDiv);
                }
            }, 0);

            // Finally, process any animations and execute scripts/3D scenes.
            processAnimationsInContent(contentDiv);
        };

        // If we are appending directly to the DOM, schedule the processing immediately.
        if (appendToDom) {
            // We still use requestAnimationFrame to ensure the element is painted before we process it.
            requestAnimationFrame(() => {
                if (!isRenderSessionActive(renderSessionId) || !messageItem.isConnected) return;
                runPostRenderProcessing();
            });
        } else {
            // If not, attach the processing function to the element itself.
            // The caller (e.g., a batch renderer) will be responsible for executing it
            // AFTER the element has been attached to the DOM.
            messageItem._vcp_process = () => {
                if (!isRenderSessionActive(renderSessionId) || !messageItem.isConnected) return;
                return runPostRenderProcessing();
            };
            messageItem._vcp_renderSessionId = renderSessionId;
        }
    }

    // Apply avatar-related colors only after the message element is connected.
    if ((message.role === 'user' || message.role === 'assistant') && avatarImg && senderNameDiv) {
        const applyColorToElements = (colorStr) => {
            if (colorStr) {
                console.debug(`[DEBUG] Applying color ${colorStr} to message item ${messageItem.dataset.messageId}`);
                messageItem.style.setProperty('--dynamic-avatar-color', colorStr);

                // Fallback: apply the border directly to the avatar element.
                if (avatarImg) {
                    avatarImg.style.borderColor = colorStr;
                    avatarImg.style.borderWidth = '2px';
                    avatarImg.style.borderStyle = 'solid';
                }

                // Apply the same color to the sender name when requested.
                if (shouldApplyColorToName && senderNameDiv) {
                    senderNameDiv.style.color = colorStr;
                }
            } else {
                console.debug(`[DEBUG] No color to apply, using default`);
                messageItem.style.removeProperty('--dynamic-avatar-color');
            }
        };

        // Theme colors take precedence over any custom overrides.
        if (useThemeColors) {
            console.debug(`[DEBUG] Using theme colors for message ${messageItem.dataset.messageId}`);
            messageItem.style.removeProperty('--dynamic-avatar-color');
            if (avatarImg) {
                avatarImg.style.removeProperty('border-color');
            }
            if (senderNameDiv) {
                senderNameDiv.style.removeProperty('color');
            }
        } else if (customBorderColor && avatarImg) {
            // Prefer explicit custom colors when enabled and theme colors are off.
            console.debug(`[DEBUG] Applying custom border color ${customBorderColor} to avatar`);
            avatarImg.style.borderColor = customBorderColor;
            avatarImg.style.borderWidth = '2px';
            avatarImg.style.borderStyle = 'solid';
        } else if (avatarColorToUse) {
            // Otherwise fall back to the computed avatar color.
            applyColorToElements(avatarColorToUse);
        } else if (avatarUrlToUse && !avatarUrlToUse.includes('default_')) { // No persisted color, try to extract
            // ? Non-blocking color calculation
            // Immediately apply a default border, which will be overridden if color extraction succeeds.
            if (avatarImg) {
                avatarImg.style.borderColor = 'var(--border-color)';
            }

            getDominantAvatarColorCached(avatarUrlToUse).then(dominantColor => {
                if (dominantColor && messageItem.isConnected) {
                    // Use the extracted dominant color only when no custom border override exists.
                    if (!customBorderColor) {
                        applyColorToElements(dominantColor);
                    } else if (shouldApplyColorToName && senderNameDiv) {
                        // When a custom border stays in place, we may still tint the sender name.
                        senderNameDiv.style.color = dominantColor;
                    }

                    // Persist the extracted color.
                    let typeToSave;
                    let idToSaveFor;
                    if (message.role === 'user') {
                        typeToSave = 'user';
                        idToSaveFor = 'user_global';
                    } else if (currentSelectedItem && currentSelectedItem.type === 'agent') {
                        typeToSave = 'agent';
                        idToSaveFor = currentSelectedItem.id;
                    }

                    if (typeToSave && idToSaveFor) {
                        electronAPI.saveAvatarColor({ type: typeToSave, id: idToSaveFor, color: dominantColor })
                            .then(result => {
                                if (result.success) {
                                    if (typeToSave === 'user') {
                                        mainRendererReferences.globalSettingsRef.set({ ...globalSettings, userAvatarCalculatedColor: dominantColor });
                                    } else if (typeToSave === 'agent' && idToSaveFor === currentSelectedItem.id) {
                                        if (currentSelectedItem.config) {
                                            currentSelectedItem.config.avatarCalculatedColor = dominantColor;
                                        } else {
                                            currentSelectedItem.avatarCalculatedColor = dominantColor;
                                        }
                                    }
                                }
                            });
                    }
                }
            }).catch(err => {
                console.warn(`[Color] Failed to extract dominant color for ${avatarUrlToUse}:`, err);
                // The default border is already applied, so no further action is needed on error.
            });
        } else if (!customBorderColor) { // Default avatar or no URL, reset to theme defaults (only if no custom color)
            // Remove the custom property. The CSS will automatically use its fallback values.
            messageItem.style.removeProperty('--dynamic-avatar-color');
        }

        // Apply the explicit custom sender-name color when configured.
        if (customNameColor && senderNameDiv) {
            console.debug(`[DEBUG] Applying custom name color ${customNameColor} to sender name`);
            senderNameDiv.style.color = customNameColor;
        }
    }


    // Attachments and content processing are now deferred within a requestAnimationFrame
    // to prevent race conditions during history loading. See the block above.

    // The responsibility of updating the history array is now moved to the caller (e.g., chatManager.handleSendMessage)
    // to ensure a single source of truth and prevent race conditions.
    /*
    if (!isInitialLoad && !message.isThinking) {
         const currentChatHistoryArray = mainRendererReferences.currentChatHistoryRef.get();
         currentChatHistoryArray.push(message);
         mainRendererReferences.currentChatHistoryRef.set(currentChatHistoryArray); // Update the ref
 
         if (currentSelectedItem.id && mainRendererReferences.currentTopicIdRef.get()) {
              if (currentSelectedItem.type === 'agent') {
                 electronAPI.saveChatHistory(currentSelectedItem.id, mainRendererReferences.currentTopicIdRef.get(), currentChatHistoryArray);
              }
         }
     }
     */
    if (isInitialLoad && message.isThinking) {
        // This case should ideally not happen if thinking messages aren't persisted.
        // If it does, remove the transient thinking message.
        const currentChatHistoryArray = mainRendererReferences.currentChatHistoryRef.get();
        const thinkingMsgIndex = currentChatHistoryArray.findIndex(m => m.id === message.id && m.isThinking);
        if (thinkingMsgIndex > -1) {
            currentChatHistoryArray.splice(thinkingMsgIndex, 1);
            mainRendererReferences.currentChatHistoryRef.set(currentChatHistoryArray);
        }
        messageItem.remove();
        return null;
    }

    // Highlighting is now part of processRenderedContent

    if (appendToDom) {
        mainRendererReferences.uiHelper.scrollToBottom();
    }
    return messageItem;
}

function startStreamingMessage(message, messageItem = null) {
    return streamManager.startStreamingMessage(message, messageItem);
}


function appendStreamChunk(messageId, chunkData, context) {
    streamManager.appendStreamChunk(messageId, chunkData, context);
}

/**
 * Fallback desktop-push extraction from the finalized message content.
 * Streaming delivery is preferred; this path only exists for cases where
 * the live streaming window was unavailable.
 */
function extractAndPushDesktopBlocks(content) {
    // Streaming desktop push is handled in streamManager.
    // Keep this function as a no-op fallback for historical call sites.
}

async function finalizeStreamedMessage(messageId, finishReason, context, finalPayload = null) {
    // streamManager owns stream accumulation and final payload selection.
    await streamManager.finalizeStreamedMessage(messageId, finishReason, context, finalPayload);

    // Reapply frontend regex rules after the stream finishes so markers split across
    // chunks can still be transformed correctly.
    const finalMessage = mainRendererReferences.currentChatHistoryRef.get().find(m => m.id === messageId);
    if (finalMessage) {
        // updateMessageContent performs a safe rerender with the final accumulated text.
        updateMessageContent(messageId, finalMessage.content);
    // --- End stream-finalization cleanup ---
        // Extract desktop-push blocks from the final content and hand them to the desktop canvas once.
        extractAndPushDesktopBlocks(finalMessage.content);
    }
    // --- 娣囶喖顦茬紒鎾存将 ---

    // After the stream is finalized in the DOM, find the message and render any mermaid blocks.
    const messageItem = mainRendererReferences.chatMessagesDiv.querySelector(`.message-item[data-message-id="${messageId}"]`);
    if (messageItem) {
        const contentDiv = messageItem.querySelector('.md-content');
        if (contentDiv) {
            await renderMermaidDiagrams(contentDiv);
        }
    }
}



/**
 * Renders a full, non-streamed message, replacing a 'thinking' placeholder.
 * @param {string} messageId - The ID of the message to update.
 * @param {string} fullContent - The full HTML or text content of the message.
 * @param {string} agentName - The name of the agent sending the message.
 * @param {string} agentId - The ID of the agent sending the message.
 */
async function renderFullMessage(messageId, fullContent, agentName, agentId) {
    console.debug(`[MessageRenderer renderFullMessage] Rendering full message for ID: ${messageId}`);
    const { chatMessagesDiv, electronAPI, uiHelper, markedInstance } = mainRendererReferences;
    const currentChatHistoryArray = mainRendererReferences.currentChatHistoryRef.get();
    const currentSelectedItem = mainRendererReferences.currentSelectedItemRef.get();
    const currentTopicIdVal = mainRendererReferences.currentTopicIdRef.get();

    // --- Update History First ---
    const messageIndex = currentChatHistoryArray.findIndex(msg => msg.id === messageId);
    if (messageIndex > -1) {
        const message = currentChatHistoryArray[messageIndex];
        message.content = fullContent;
        message.isThinking = false;
        message.finishReason = 'completed_non_streamed';
        message.name = agentName || message.name;
        message.agentId = agentId || message.agentId;
        mainRendererReferences.currentChatHistoryRef.set([...currentChatHistoryArray]);

        // Save history
        if (currentSelectedItem && currentSelectedItem.id && currentTopicIdVal && currentSelectedItem.type === 'agent') {
            try {
                await electronAPI.saveChatHistory(currentSelectedItem.id, currentTopicIdVal, currentChatHistoryArray.filter(m => !m.isThinking));
            } catch (error) {
                console.error(`[MR renderFullMessage] Failed to save history for ${currentSelectedItem.id}, topic ${currentTopicIdVal}:`, error);
            }
        }
    } else {
        console.warn(`[renderFullMessage] Message ID ${messageId} not found in history. UI will be updated, but history may be inconsistent.`);
        // Even if not in history, we might still want to render it if the DOM element exists (e.g., from a 'thinking' state)
    }

    const messageItem = chatMessagesDiv.querySelector(`.message-item[data-message-id="${messageId}"]`);
    if (!messageItem) {
        console.debug(`[renderFullMessage] No DOM element for ${messageId}. History updated, UI skipped.`);
        return; // No UI to update, but history is now consistent.
    }

    messageItem.classList.remove('thinking', 'streaming');
    window.updateSendButtonState?.();

    const contentDiv = messageItem.querySelector('.md-content');
    if (!contentDiv) {
        console.error(`[renderFullMessage] Could not find .md-content div for message ID ${messageId}.`);
        return;
    }

    // Update timestamp display if it was missing
    const nameTimeBlock = messageItem.querySelector('.name-time-block');
    if (nameTimeBlock && !nameTimeBlock.querySelector('.message-timestamp')) {
        const timestampDiv = document.createElement('div');
        timestampDiv.classList.add('message-timestamp');
        const messageFromHistory = currentChatHistoryArray.find(m => m.id === messageId);
        timestampDiv.textContent = formatMessageTimestamp(messageFromHistory?.timestamp || Date.now());
        nameTimeBlock.appendChild(timestampDiv);
    }

    // --- Update DOM ---
    const globalSettings = mainRendererReferences.globalSettingsRef.get();
    // Reapply frontend regex rules to the finalized content.
    const agentConfigForRegex = currentSelectedItem?.config || currentSelectedItem;
    const messageFromHistoryForRegex = currentChatHistoryArray.find(msg => msg.id === messageId);
    if (agentConfigForRegex?.stripRegexes && Array.isArray(agentConfigForRegex.stripRegexes) && messageFromHistoryForRegex) {
        const depth = calculateDepthByTurns(messageId, currentChatHistoryArray);
        fullContent = applyFrontendRegexRules(fullContent, agentConfigForRegex.stripRegexes, messageFromHistoryForRegex.role, depth);
    }
    // End frontend regex rule application.
    const processedFinalText = preprocessFullContent(fullContent, globalSettings, 'assistant');
    // Protect LaTeX before parsing Markdown.
    const { text: protectedFinalText, map: latexMapFinal } = protectLatexBlocks(processedFinalText);
    let rawHtml = markedInstance.parse(protectedFinalText);
    // Restore protected LaTeX after parsing.
    rawHtml = restoreLatexBlocks(rawHtml, latexMapFinal);

    setContentAndProcessImages(contentDiv, rawHtml, messageId);

    // Apply post-processing in two steps
    // Step 1: Synchronous processing
    contentProcessor.processRenderedContent(contentDiv, globalSettings);
    await renderMermaidDiagrams(contentDiv);

    // Step 2: Asynchronous, deferred highlighting for DOM stability with a hardcoded delay
    setTimeout(() => {
        if (contentDiv && contentDiv.isConnected) {
            contentProcessor.highlightAllPatternsInMessage(contentDiv);
        }
    }, 0);

    // After content is rendered, run animations/scripts/3D scenes
    processAnimationsInContent(contentDiv);

    mainRendererReferences.uiHelper.scrollToBottom();
}

function scheduleMessagePretextEstimate(messageId, text, container) {
    if (!window.pretextBridge || !window.pretextBridge.isReady() || !messageId || !text) return;

    const run = () => {
        try {
            const containerWidth = container ? container.clientWidth : 800;
            window.pretextBridge.estimateHeight(messageId, text, 'body', containerWidth);
        } catch (e) {
            // Pretext failures must not block normal rendering.
        }
    };

    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: 300 });
    } else {
        setTimeout(run, 0);
    }
}

function updateMessageContent(messageId, newContent) {
    const { chatMessagesDiv, markedInstance, globalSettingsRef } = mainRendererReferences;
    const messageItem = chatMessagesDiv.querySelector(`.message-item[data-message-id="${messageId}"]`);
    if (!messageItem) return;

    const contentDiv = messageItem.querySelector('.md-content');
    if (!contentDiv) return;

    const globalSettings = globalSettingsRef.get();
    let textToRender = (typeof newContent === 'string') ? newContent : (newContent?.text || "[\u5185\u5bb9\u683c\u5f0f\u9519\u8bef]");

    // --- Depth calculation for history message updates ---
    const currentChatHistoryForUpdate = mainRendererReferences.currentChatHistoryRef.get();
    const messageInHistory = currentChatHistoryForUpdate.find(m => m.id === messageId);

    if (messageInHistory && messageInHistory.role === 'user') {
        textToRender = prepareUserMessageText(textToRender);
    }

    // Calculate depth by conversation turn.
    const depthForUpdate = calculateDepthByTurns(messageId, currentChatHistoryForUpdate);
    // Reapply frontend regex rules after stream completion.
    const currentSelectedItem = mainRendererReferences.currentSelectedItemRef.get();
    const agentConfigForRegex = currentSelectedItem?.config || currentSelectedItem;
    if (agentConfigForRegex?.stripRegexes && Array.isArray(agentConfigForRegex.stripRegexes) && messageInHistory) {
        textToRender = applyFrontendRegexRules(textToRender, agentConfigForRegex.stripRegexes, messageInHistory.role, depthForUpdate);
    }
    // End frontend regex reapplication.
    const processedContent = preprocessFullContent(textToRender, globalSettings, messageInHistory?.role || 'assistant', depthForUpdate);
    // Protect LaTeX before parsing Markdown.
    const { text: protectedContentUpdate, map: latexMapUpdate } = protectLatexBlocks(processedContent);
    let rawHtml = markedInstance.parse(protectedContentUpdate);
    // Restore protected LaTeX after parsing.
    rawHtml = restoreLatexBlocks(rawHtml, latexMapUpdate);

    // --- Post-Render Processing (aligned with renderMessage logic) ---

    // 1. Set content and process images
    setContentAndProcessImages(contentDiv, rawHtml, messageId);

    // 2. Re-render attachments if they exist
    if (messageInHistory) {
        const existingAttachments = contentDiv.querySelector('.message-attachments');
        if (existingAttachments) existingAttachments.remove();
        const existingRefs = contentDiv.querySelector('.message-kb-refs');
        if (existingRefs) existingRefs.remove();
        renderAttachments({ ...messageInHistory, content: newContent }, contentDiv);
        renderKnowledgeBaseRefs({ ...messageInHistory, content: newContent }, contentDiv);
    }

    // 3. Synchronous processing (KaTeX, buttons, etc.)
    contentProcessor.processRenderedContent(contentDiv, globalSettings);
    renderMermaidDiagrams(contentDiv); // Fire-and-forget async rendering

    // 4. Asynchronous, deferred highlighting for DOM stability
    setTimeout(() => {
        if (contentDiv && contentDiv.isConnected) {
            contentProcessor.highlightAllPatternsInMessage(contentDiv);
        }
    }, 0);

    // 5. Re-run animations/scripts/3D scenes
    processAnimationsInContent(contentDiv);
}

function prepareUserMessageText(text) {
    let processedText = text;

    // User input is untrusted. Escape HTML first to prevent XSS.
    // Allow <img> tags for emoticons, but still reject event-handler attributes.
    const userImgBlocks = [];
    processedText = processedText.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, (match) => {
        if (/on\w+\s*=/i.test(match) || /src\s*=\s*["']\s*javascript:/i.test(match)) {
            return match;
        }
        const placeholder = `__VCP_USER_IMG_${userImgBlocks.length}__`;
        userImgBlocks.push(match);
        return placeholder;
    });

    processedText = escapeHtml(processedText);

    userImgBlocks.forEach((img, i) => {
        processedText = processedText.replace(`__VCP_USER_IMG_${i}__`, img);
    });

    processedText = transformUserButtonClick(processedText);
    processedText = transformUniStudyChatCanvas(processedText);

    return processedText;
}

// Expose methods to renderer.js
/**
 * Renders a complete chat history with progressive loading for better UX.
 * First shows the latest 5 messages, then loads older messages in batches of 10.
 * @param {Array<Message>} history The chat history to render.
 * @param {Object} options Rendering options
 * @param {number} options.initialBatch - Number of latest messages to show first (default: 5)
 * @param {number} options.batchSize - Size of subsequent batches (default: 10)
 * @param {number} options.batchDelay - Delay between batches in ms (default: 100)
 */
async function renderHistory(history, options = {}) {
    const renderSessionId = invalidateRenderSession();

    const {
        initialBatch = 5,
        batchSize = 10,
        batchDelay = 100
    } = options;

    // Initialize shared dependencies once before progressive batch rendering starts.
    await emoticonUrlFixer.initialize(mainRendererReferences.electronAPI);

    if (!history || history.length === 0) {
        return Promise.resolve();
    }

    // For short histories, use the legacy rendering path directly.
    if (history.length <= initialBatch) {
        return renderHistoryLegacy(history, renderSessionId);
    }

    console.debug(`[MessageRenderer] Progressive render start: total=${history.length}, initialBatch=${initialBatch}, batchSize=${batchSize}`);

    // Split newest messages from older history.
    const latestMessages = history.slice(-initialBatch);
    const olderMessages = history.slice(0, -initialBatch);

    // Stage 1: render the newest messages immediately.
    await renderMessageBatch(latestMessages, true, renderSessionId);
    if (!isRenderSessionActive(renderSessionId)) return;
    console.debug(`[MessageRenderer] Initial batch of ${latestMessages.length} newest messages rendered.`);

    // Stage 2: render the older history in batches from old to new.
    if (olderMessages.length > 0) {
        await renderOlderMessagesInBatches(olderMessages, batchSize, batchDelay, renderSessionId);
    }

    if (!isRenderSessionActive(renderSessionId)) return;

    // Scroll to the bottom after all batches finish.
    mainRendererReferences.uiHelper.scrollToBottom();
    console.debug(`[MessageRenderer] Progressive render completed: total=${history.length}`);
}

/**
 * Render one batch of messages.
 * @param {Array<Message>} messages Messages to render.
 * @param {boolean} scrollToBottom Whether to scroll after the batch is appended.
 */
async function renderMessageBatch(messages, scrollToBottom = false, renderSessionId = getActiveRenderSessionId()) {
    if (!isRenderSessionActive(renderSessionId)) return;

    const fragment = document.createDocumentFragment();
    const messageElements = [];

    // Use Promise.allSettled so one failure does not abort the full batch.
    const results = await Promise.allSettled(
        messages.map(msg => renderMessage(msg, true, false, renderSessionId))
    );

    results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
            messageElements.push(result.value);
        } else {
            console.error(`Failed to render message ${messages[index].id}:`,
                result.reason);
        }
    });

    // Append every rendered element to the fragment in one pass.
    messageElements.forEach(el => fragment.appendChild(el));

    // Use requestAnimationFrame so DOM insertion and deferred processing stay on the UI frame boundary.
    return new Promise(resolve => {
        requestAnimationFrame(() => {
            if (!isRenderSessionActive(renderSessionId)) {
                resolve();
                return;
            }

            // Step 1: Append all elements to the DOM at once.
            mainRendererReferences.chatMessagesDiv.appendChild(fragment);

            // Step 2: Now that they are in the DOM, run the deferred processing for each.
            messageElements.forEach(el => {
                if (!isRenderSessionActive(renderSessionId) || !el.isConnected) {
                    if (typeof el._vcp_process === 'function') {
                        delete el._vcp_process;
                    }
                    delete el._vcp_renderSessionId;
                    return;
                }

                // Observe each batch-rendered message after it enters the DOM.
                visibilityOptimizer.observeMessage(el);

                if (typeof el._vcp_process === 'function') {
                    el._vcp_process();
                    delete el._vcp_process; // Clean up to avoid memory leaks
                }
                delete el._vcp_renderSessionId;
            });

            if (scrollToBottom && isRenderSessionActive(renderSessionId)) {
                mainRendererReferences.uiHelper.scrollToBottom();
            }
            resolve();
        });
    });
}

/**
 * Render older messages in batches.
 * @param {Array<Message>} olderMessages Older history messages.
 * @param {number} batchSize Number of messages per batch.
 * @param {number} batchDelay Delay between batches in milliseconds.
 */
/**
 * Use requestIdleCallback when available so older history renders during idle time.
 */
async function renderOlderMessagesInBatches(olderMessages, batchSize, batchDelay, renderSessionId = getActiveRenderSessionId()) {
    const totalBatches = Math.ceil(olderMessages.length / batchSize);

    for (let i = totalBatches - 1; i >= 0; i--) {
        if (!isRenderSessionActive(renderSessionId)) return;

        const startIndex = i * batchSize;
        const endIndex = Math.min(startIndex + batchSize, olderMessages.length);
        const batch = olderMessages.slice(startIndex, endIndex);

        // Build the fragment for the current batch.
        const batchFragment = document.createDocumentFragment();
        const elementsForProcessing = [];

        for (const msg of batch) {
            if (!isRenderSessionActive(renderSessionId)) return;

            const messageElement = await renderMessage(msg, true, false, renderSessionId);
            if (messageElement) {
                batchFragment.appendChild(messageElement);
                elementsForProcessing.push(messageElement);
            }
        }

        // Prefer requestIdleCallback for batch insertion and fall back to requestAnimationFrame.
        await new Promise(resolve => {
            const insertBatch = () => {
                if (!isRenderSessionActive(renderSessionId)) {
                    resolve();
                    return;
                }

                const chatMessagesDiv = mainRendererReferences.chatMessagesDiv;
                let insertPoint = chatMessagesDiv.firstChild;
                while (insertPoint?.classList?.contains('topic-timestamp-bubble')) {
                    insertPoint = insertPoint.nextSibling;
                }

                if (insertPoint) {
                    chatMessagesDiv.insertBefore(batchFragment, insertPoint);
                } else {
                    chatMessagesDiv.appendChild(batchFragment);
                }

                elementsForProcessing.forEach(el => {
                    if (!isRenderSessionActive(renderSessionId) || !el.isConnected) {
                        if (typeof el._vcp_process === 'function') {
                            delete el._vcp_process;
                        }
                        delete el._vcp_renderSessionId;
                        return;
                    }

                    // Observe each history message after it is appended to the DOM.
                    visibilityOptimizer.observeMessage(el);

                    if (typeof el._vcp_process === 'function') {
                        el._vcp_process();
                        delete el._vcp_process;
                    }
                    delete el._vcp_renderSessionId;
                });

                resolve();
            };            // Prefer requestIdleCallback for batch insertion and fall back to rAF.
            if ('requestIdleCallback' in window) {
                requestIdleCallback(insertBatch, { timeout: 1000 });
            } else {
                requestAnimationFrame(insertBatch);
            }
        });

        // Shorter batches can use a smaller delay to keep the UI feeling responsive.

        if (!isRenderSessionActive(renderSessionId)) return;

        // Use a slightly shorter delay for smaller batches to keep the UI responsive.
        if (i > 0 && batchDelay > 0) {
            const actualDelay = batch.length < batchSize / 2 ? batchDelay / 2 : batchDelay;
            await new Promise(resolve => setTimeout(resolve, actualDelay));
        }
    }
}

/**
 * Legacy history rendering path for smaller histories.
 * @param {Array<Message>} history Chat history.
 */
async function renderHistoryLegacy(history, renderSessionId = getActiveRenderSessionId()) {
    if (!isRenderSessionActive(renderSessionId)) return;

    const fragment = document.createDocumentFragment();
    const allMessageElements = [];

    // Phase 1: Create all message elements in memory without appending to DOM
    for (const msg of history) {
        if (!isRenderSessionActive(renderSessionId)) return;

        const messageElement = await renderMessage(msg, true, false, renderSessionId);
        if (messageElement) {
            allMessageElements.push(messageElement);
        }
    }

    if (!isRenderSessionActive(renderSessionId)) return;

    // Phase 2: Append all created elements at once using a DocumentFragment
    allMessageElements.forEach(el => fragment.appendChild(el));

    return new Promise(resolve => {
        requestAnimationFrame(() => {
            if (!isRenderSessionActive(renderSessionId)) {
                resolve();
                return;
            }

            // Step 1: Append all elements to the DOM.
            mainRendererReferences.chatMessagesDiv.appendChild(fragment);

            // Step 2: Run the deferred processing for each element now that it's attached.
            allMessageElements.forEach(el => {
                if (!isRenderSessionActive(renderSessionId) || !el.isConnected) {
                    if (typeof el._vcp_process === 'function') {
                        delete el._vcp_process;
                    }
                    delete el._vcp_renderSessionId;
                    return;
                }

                // Observe history messages after they are attached.
                visibilityOptimizer.observeMessage(el);

                if (typeof el._vcp_process === 'function') {
                    el._vcp_process();
                    delete el._vcp_process; // Clean up
                }
                delete el._vcp_renderSessionId;
            });

            if (isRenderSessionActive(renderSessionId)) {
                mainRendererReferences.uiHelper.scrollToBottom();
            }
            resolve();
        });
    });
}

export {
    initializeMessageRenderer,
    setCurrentSelectedItem,
    setCurrentTopicId,
    setCurrentItemAvatar,
    setUserAvatar,
    setCurrentItemAvatarColor,
    setUserAvatarColor,
    renderMessage,
    renderHistory,
    renderHistoryLegacy,
    renderMessageBatch,
    startStreamingMessage,
    appendStreamChunk,
    finalizeStreamedMessage,
    renderFullMessage,
    clearChat,
    removeMessageById,
    updateMessageContent,
    extractSpeakableTextFromContentElement,
};
