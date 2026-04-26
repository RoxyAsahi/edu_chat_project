// modules/renderer/contentProcessor.js

import { scopeCss } from './scopedCss.js';

let mainRefs = {};

/**
 * Initializes the content processor with necessary references.
 * @param {object} refs - References to main modules and utilities.
 */
function initializeContentProcessor(refs) {
    mainRefs = refs;
}

/**
 * A helper function to escape HTML special characters.
 * @param {string} text The text to escape.
 * @returns {string} The escaped text.
 */
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/&/g, '\x26amp;')    // & -> &
        .replace(/</g, '\x26lt;')     // < -> <
        .replace(/>/g, '\x26gt;')     // > -> >
        .replace(/"/g, '\x26quot;')   // " -> "
        .replace(/'/g, '\x26#039;');  // ' -> &#039;
}

/**
 * 处理「始」和「末」之间的内容，将其视为纯文本并转义。
 * 支持流式传输中未闭合的情况。
 * @param {string} text 输入文本
 * @returns {string} 处理后的文本
 */
function processStartEndMarkers(text) {
    if (typeof text !== 'string' || !text.includes('「始」')) return text;
    
    // 使用非贪婪匹配，同时支持匹配到字符串末尾（处理流式传输中未闭合的情况）
    return text.replace(/「始」([\s\S]*?)(「末」|$)/g, (match, content, end) => {
        return `「始」${escapeHtml(content)}${end}`;
    });
}

/**
 * Ensures that triple backticks for code blocks are followed by a newline.
 * @param {string} text The input string.
 * @returns {string} The processed string with newlines after ``` if they were missing.
 */
function ensureNewlineAfterCodeBlock(text) {
    if (typeof text !== 'string') return text;
    // Keep valid info strings such as ```html intact; only split truly inline fences.
    return text.replace(/^(\s*```)(?![A-Za-z0-9_-]*[\r\n])(?=\S)/gm, '$1\n');
}

/**
 * Ensures that a tilde (~) is followed by a space, to prevent accidental strikethrough.
 * It avoids doing this for tildes inside URLs or file paths.
 * @param {string} text The input string.
 * @returns {string} The processed string with spaces after tildes where they were missing.
 */
function ensureSpaceAfterTilde(text) {
    if (typeof text !== 'string') return text;
    // Replace a tilde `~` with `~ ` to prevent it from being interpreted as a strikethrough marker.
    // This should not affect tildes in URLs (e.g., `.../~user/`) or code (e.g., `var_~a`).
    // The regex matches a tilde if it's:
    // 1. At the start of the string (`^`).
    // 2. Preceded by a character that is NOT a word character (`\w`), path separator (`/`, `\`), or equals sign (`=`).
    // It also ensures it's not already followed by a space or another tilde `(?![\s~])`.
    return text.replace(/(^|[^\w/\\=])~(?![\s~])/g, '$1~ ');
}

/**
 * Removes leading whitespace from lines starting with ``` (code block markers).
 * This only removes indentation from the fence markers themselves, NOT the code content.
 * @param {string} text The input string.
 * @returns {string} The processed string.
 */
function removeIndentationFromCodeBlockMarkers(text) {
    if (typeof text !== 'string') return text;
    // Only remove indentation from the opening and closing fence markers
    // Do NOT touch the content between them
    const lines = text.split('\n');
    let inCodeBlock = false;
    
    return lines.map(line => {
        const trimmedLine = line.trim();
        
        // Check if this is a fence marker
        if (trimmedLine.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            return trimmedLine; // Remove indentation from fence markers
        }
        
        // Keep original formatting for code content
        return line;
    }).join('\n');
}

/**
 * Removes speaker tags like "[Sender's speech]: " from the beginning of a string.
 * @param {string} text The input string.
 * @returns {string} The processed string without the leading speaker tag.
 */
function removeSpeakerTags(text) {
    if (typeof text !== 'string') return text;
    const speakerTagRegex = /^\[(?:(?!\]:\s).)*的发言\]:\s*/;
    let newText = text;
    // Loop to remove all occurrences of the speaker tag at the beginning of the string
    while (speakerTagRegex.test(newText)) {
        newText = newText.replace(speakerTagRegex, '');
    }
    return newText;
}

/**
* Ensures there is a separator between an <img> tag and a subsequent code block fence (```).
* This prevents the markdown parser from failing to recognize the code block.
* It inserts a double newline and an HTML comment. The comment acts as a "hard" separator
* for the markdown parser, forcing it to reset its state after the raw HTML img tag.
* @param {string} text The input string.
* @returns {string} The processed string.
*/
function ensureSeparatorBetweenImgAndCode(text) {
    if (typeof text !== 'string') return text;
    // Looks for an <img> tag, optional whitespace, and then a ```.
    // Inserts a double newline and an HTML comment.
    return text.replace(/(<img[^>]+>)\s*(```)/g, '$1\n\n<!-- UniStudy-Renderer-Separator -->\n\n$2');
}


/**
 * Removes leading whitespace from special tool-protocol blocks like tool requests.
 * This prevents the markdown parser from misinterpreting the entire indented
 * block as a single code block before it can be transformed into a bubble.
 * @param {string} text The input string.
 * @returns {string} The processed string.
 */
function deIndentToolRequestBlocks(text) {
    if (typeof text !== 'string') return text;

    const lines = text.split('\n');
    let inToolBlock = false;

    return lines.map(line => {
        // 🟢 加固：排除被反引号包裹的占位符（如 `<<<[TOOL_REQUEST]>>>`）
        const isBacktickWrapped = /`[^`]*<<<\[TOOL_REQUEST\]>>>[^`]*`/.test(line) ||
                                   /`[^`]*<<<\[END_TOOL_REQUEST\]>>>[^`]*`/.test(line);
        
        const isStart = !isBacktickWrapped && line.includes('<<<[TOOL_REQUEST]>>>');
        const isEnd = !isBacktickWrapped && line.includes('<<<[END_TOOL_REQUEST]>>>');

        let needsTrim = false;
        // If a line contains the start marker, we begin trimming.
        if (isStart) {
            needsTrim = true;
            inToolBlock = true;
        }
        // If we are already in a block, we continue trimming.
        else if (inToolBlock) {
            needsTrim = true;
        }

        const processedLine = needsTrim ? line.trimStart() : line;

        // If a line contains the end marker, we stop trimming from the *next* line.
        if (isEnd) {
            inToolBlock = false;
        }

        return processedLine;
    }).join('\n');
}


/**
 * Parses tool_name from a tool request block.
 * @param {string} toolContent - The raw string content of the tool request.
 * @returns {string|null} The extracted tool name or null.
 */
function extractToolNameFromRequest(toolContent) {
    const match = toolContent.match(/tool_name:\s*「始」([^「」]+)「末」/);
    return match ? match[1] : null;
}

function extractToolFieldFromRequest(toolContent, fieldName) {
    const escapedFieldName = String(fieldName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(toolContent || '').match(new RegExp(`${escapedFieldName}:\\s*「始」([\\s\\S]*?)「末」`, 'i'));
    return match ? match[1].trim() : '';
}

/**
 * Prettifies a single <pre> code block for DailyNote or tool use.
 * @param {HTMLElement} preElement - The <pre> element to prettify.
 * @param {'dailynote' | 'toolrequest'} type - The type of block.
 * @param {string} relevantContent - The relevant text content for the block.
 */
function prettifySinglePreElement(preElement, type, relevantContent) {
    if (!preElement || preElement.dataset.toolRequestPrettified === "true" || preElement.dataset.learningDiaryPrettified === "true") {
        return;
    }

    // Remove the <code> element to prevent Turndown's default code block rule from matching
    // This ensures our custom Turndown rule can handle these special blocks
    const codeElement = preElement.querySelector('code');
    if (codeElement) {
        // Move any copy buttons or other elements before removing
        const copyButton = codeElement.querySelector('.code-copy, .fa-copy');
        if (copyButton) {
            copyButton.remove();
        }
        // Remove the code wrapper, we'll set content directly on pre
        preElement.innerHTML = '';
    }

    if (type === 'toolrequest') {
        const toolName = extractToolNameFromRequest(relevantContent);
        const command = extractToolFieldFromRequest(relevantContent, 'command').toLowerCase();

        if (toolName === 'DailyNote' && (command === 'create' || command === 'update')) {
            preElement.classList.add('learning-diary-bubble');

            const notebook = extractToolFieldFromRequest(relevantContent, 'subject')
                || extractToolFieldFromRequest(relevantContent, 'maid')
                || extractToolFieldFromRequest(relevantContent, 'maidName');
            const date = extractToolFieldFromRequest(relevantContent, 'Date')
                || extractToolFieldFromRequest(relevantContent, 'date');
            const diaryTitle = command === 'update'
                ? '学习日志更新 Learning Log Update'
                : '学习日志 Learning Log';
            const diaryContent = command === 'update'
                ? [
                    '<strong>Original</strong>',
                    '',
                    escapeHtml(extractToolFieldFromRequest(relevantContent, 'target') || '[Original content unavailable]'),
                    '',
                    '<strong>Updated</strong>',
                    '',
                    escapeHtml(extractToolFieldFromRequest(relevantContent, 'replace') || '[Updated content unavailable]'),
                ].join('<br>')
                : escapeHtml(extractToolFieldFromRequest(relevantContent, 'Content') || '[Diary content unavailable]').replace(/\n/g, '<br>');

            let html = `<div class="diary-header">`;
            html += `<span class="diary-title">${escapeHtml(diaryTitle)}</span>`;
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

            html += `<div class="diary-content">${diaryContent}</div>`;
            preElement.innerHTML = html;
            preElement.dataset.learningDiaryPrettified = "true";
            return;
        }

        preElement.classList.add('tool-request-bubble');

        let newInnerHtml = `<span class="unistudy-tool-label">Tool Use:</span>`;
        if (toolName) {
            newInnerHtml += `<span class="unistudy-tool-name-highlight">${toolName}</span>`;
        } else {
            newInnerHtml += `<span class="unistudy-tool-name-highlight">UnknownTool</span>`;
        }

        preElement.innerHTML = newInnerHtml;
        preElement.dataset.toolRequestPrettified = "true";

    } else if (type === 'dailynote') {
        preElement.classList.add('learning-diary-bubble');
        let actualNoteContent = relevantContent.trim();

        let finalHtml = "";
        const lines = actualNoteContent.split('\n');
        const firstLineTrimmed = lines[0] ? lines[0].trim() : "";

        if (firstLineTrimmed.startsWith('Subject:') || firstLineTrimmed.startsWith('Maid:') || firstLineTrimmed.startsWith('日志本:')) {
            finalHtml = `<span class="diary-notebook-inline-label">${lines.shift().trim()}</span>`;
            finalHtml += lines.join('\n');
        } else if (firstLineTrimmed.startsWith('Subject') || firstLineTrimmed.startsWith('Maid') || firstLineTrimmed.startsWith('日志本')) {
            finalHtml = `<span class="diary-notebook-inline-label">${lines.shift().trim()}</span>`;
            finalHtml += lines.join('\n');
        } else {
            finalHtml = actualNoteContent;
        }

        preElement.innerHTML = finalHtml.replace(/\n/g, '<br>');
        preElement.dataset.learningDiaryPrettified = "true";
    }
}

const TAG_REGEX = /@([\u4e00-\u9fa5A-Za-z0-9_]+)/g;
const ALERT_TAG_REGEX = /@!([\u4e00-\u9fa5A-Za-z0-9_]+)/g;
const BOLD_REGEX = /\*\*([^\*]+)\*\*/g;
const QUOTE_REGEX = /(?:"([^"]*)"|“([^”]*)”)/g; // Matches English "..." and Chinese “...”

/**
 * 一次性高亮所有文本模式（标签、粗体、引号），替换旧的多次遍历方法
 * @param {HTMLElement} messageElement The message content element.
 */
function highlightAllPatternsInMessage(messageElement) {
    if (!messageElement) return;

    const walker = document.createTreeWalker(
        messageElement,
        NodeFilter.SHOW_TEXT,
        (node) => {
            let parent = node.parentElement;
            while (parent && parent !== messageElement) {
                if (['PRE', 'CODE', 'STYLE', 'SCRIPT', 'STRONG', 'B'].includes(parent.tagName) ||
                    parent.classList.contains('highlighted-tag') ||
                    parent.classList.contains('highlighted-quote')) {
                    return NodeFilter.FILTER_REJECT;
                }
                parent = parent.parentElement;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
        false
    );

    const nodesToProcess = [];
    let node;

    try {
        while ((node = walker.nextNode())) {
            const text = node.nodeValue || '';
            if (!text) continue;
            const matches = [];

            // 收集所有匹配
            let match;
            while ((match = TAG_REGEX.exec(text)) !== null) {
                matches.push({ type: 'tag', index: match.index, length: match[0].length, content: match[0] });
            }
            while ((match = ALERT_TAG_REGEX.exec(text)) !== null) {
                matches.push({ type: 'alert-tag', index: match.index, length: match[0].length, content: match[0] });
            }
            while ((match = BOLD_REGEX.exec(text)) !== null) {
                matches.push({ type: 'bold', index: match.index, length: match[0].length, content: match[1] });
            }
            while ((match = QUOTE_REGEX.exec(text)) !== null) {
                // 确保引号内有内容
                if (match[1] || match[2]) {
                    matches.push({ type: 'quote', index: match.index, length: match[0].length, content: match[0] });
                }
            }

            if (matches.length > 0) {
                // 按位置排序
                matches.sort((a, b) => a.index - b.index);
                nodesToProcess.push({ node, matches });
            }
        }
    } catch (error) {
        if (!error.message.includes("no longer runnable")) {
            console.error("highlightAllPatterns: TreeWalker error", error);
        }
    }

    // 逆序处理节点
    for (let i = nodesToProcess.length - 1; i >= 0; i--) {
        const { node, matches } = nodesToProcess[i];
        if (!node.parentNode) continue;

        // 健壮的重叠匹配过滤逻辑
        const filteredMatches = [];
        let lastIndexProcessed = -1;
        for (const currentMatch of matches) {
            if (currentMatch.index >= lastIndexProcessed) {
                filteredMatches.push(currentMatch);
                lastIndexProcessed = currentMatch.index + currentMatch.length;
            }
        }

        if (filteredMatches.length === 0) continue;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;

        // 构建新的节点结构
        filteredMatches.forEach(match => {
            // 添加匹配前的文本
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(node.nodeValue.substring(lastIndex, match.index)));
            }

            // 创建高亮元素
            const span = document.createElement(match.type === 'bold' ? 'strong' : 'span');
            if (match.type === 'tag') {
                span.className = 'highlighted-tag';
                span.textContent = match.content;
            } else if (match.type === 'alert-tag') {
                span.className = 'highlighted-alert-tag';
                span.textContent = match.content;
            } else if (match.type === 'quote') {
                span.className = 'highlighted-quote';
                span.textContent = match.content;
            } else { // bold
                span.textContent = match.content;
            }
            fragment.appendChild(span);

            lastIndex = match.index + match.length;
        });

        // 添加剩余文本
        if (lastIndex < node.nodeValue.length) {
            fragment.appendChild(document.createTextNode(node.nodeValue.substring(lastIndex)));
        }

        node.parentNode.replaceChild(fragment, node);
    }
}

/**
 * Processes all relevant <pre> blocks within a message's contentDiv AFTER marked.parse().
 * @param {HTMLElement} contentDiv - The div containing the parsed Markdown.
 */
function processAllPreBlocksInContentDiv(contentDiv) {
    if (!contentDiv) return;

    const allPreElements = contentDiv.querySelectorAll('pre');
    allPreElements.forEach(preElement => {
        // 🟢 增加防御性检查：确保 preElement 仍在 DOM 中
        // 在嵌套的 pre 场景下，外层 pre 的处理可能会导致内层 pre 被移出 DOM
        if (!preElement || !preElement.parentElement) return;

        if (preElement.dataset.toolRequestPrettified === "true" ||
            preElement.dataset.learningDiaryPrettified === "true" ||
            preElement.dataset.richHtmlPreview === "true" ||
            preElement.dataset.richHtmlPreview === "blocked") {
            return; // Already processed or blocked
        }

        // 🟢 首先检查是否在工具协议气泡内
        const isInsideRichBubble = preElement.closest('.tool-request-bubble, .unistudy-tool-result-bubble, .learning-diary-bubble');
        if (isInsideRichBubble) {
            // 在气泡内的 pre 不应该被处理为可预览的 HTML
            preElement.dataset.richHtmlPreview = "blocked";
            return;
        }

        const codeElement = preElement.querySelector('code');
        const blockText = codeElement ? (codeElement.textContent || "") : (preElement.textContent || "");
        // 在美化前，将原始文本内容存储到 data-* 属性中
        // 这是为了在后续的上下文净化过程中，能够恢复原始内容，避免特殊字符被转义
        preElement.setAttribute('data-raw-content', blockText);

        // Check for tool request blocks
        if (blockText.includes('<<<[TOOL_REQUEST]>>>') && blockText.includes('<<<[END_TOOL_REQUEST]>>>')) {
            const toolRequestContentMatch = blockText.match(/<<<\[TOOL_REQUEST\]>>>([\s\S]*?)<<<\[END_TOOL_REQUEST\]>>>/);
            const actualToolRequestText = toolRequestContentMatch ? toolRequestContentMatch[1].trim() : "";
            prettifySinglePreElement(preElement, 'toolrequest', actualToolRequestText);
        }
        // Check for DailyNote
        else if (blockText.includes('<<<DailyNoteStart>>>') && blockText.includes('<<<DailyNoteEnd>>>')) {
            const dailyNoteContentMatch = blockText.match(/<<<DailyNoteStart>>>([\s\S]*?)<<<DailyNoteEnd>>>/);
            const actualDailyNoteText = dailyNoteContentMatch ? dailyNoteContentMatch[1].trim() : "";
            prettifySinglePreElement(preElement, 'dailynote', actualDailyNoteText);
        }
        // Check for HTML code block
        else if (codeElement && (codeElement.classList.contains('language-html') || blockText.trim().startsWith('<!DOCTYPE html>') || blockText.trim().startsWith('<html'))) {
            setupHtmlPreview(preElement, blockText);
        }
        // Check for standalone Three.js code. AI-rendered learning cards often emit
        // raw <pre><code> blocks without a language class, so content detection matters.
        else if (codeElement && isThreeJsCodeBlock(codeElement, blockText)) {
            setupThreeJsPreview(preElement, blockText);
        }
    });
}

function isThreeJsCodeBlock(codeElement, blockText) {
    if (!codeElement || typeof blockText !== 'string') return false;

    const classLooksLikeScript = Array.from(codeElement.classList || [])
        .some(cls => /^language-(javascript|js|threejs)$/i.test(cls));
    const contentLooksLikeThree = /\bTHREE\./.test(blockText);
    const trimmed = blockText.trim().toLowerCase();
    const looksLikeFullHtml = trimmed.startsWith('<!doctype html>') || trimmed.startsWith('<html');

    return contentLooksLikeThree && !looksLikeFullHtml && (
        classLooksLikeScript
        || /\bnew\s+THREE\.WebGLRenderer\b/.test(blockText)
        || /\bTHREE\.(Scene|PerspectiveCamera|BoxGeometry|Mesh|WebGLRenderer)\b/.test(blockText)
    );
}

function buildThreeJsPreviewHtml(codeContent, frameId) {
    const safeScriptContent = String(codeContent || '').replace(/<\/script/gi, '<\\/script');
    const threeScriptSrc = (() => {
        try {
            return new URL('../../vendor/three.min.js', window.location.href).href;
        } catch (_error) {
            return '../../vendor/three.min.js';
        }
    })();

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                html, body {
                    width: 100%;
                    height: 100%;
                    margin: 0;
                    overflow: hidden;
                    background: #020617;
                }
                #unistudy-three-mount {
                    width: 100%;
                    min-height: 360px;
                    height: auto;
                    overflow: hidden;
                    position: relative;
                }
                canvas {
                    display: block;
                    max-width: 100%;
                }
                .unistudy-three-error {
                    color: #fecaca;
                    background: #450a0a;
                    border: 1px solid #ef4444;
                    font: 13px/1.5 Consolas, Monaco, monospace;
                    margin: 16px;
                    padding: 14px;
                    border-radius: 8px;
                    white-space: pre-wrap;
                }
            </style>
        </head>
        <body>
            <div id="unistudy-three-mount"></div>
            <script src="${escapeHtml(threeScriptSrc)}"><\/script>
            <script>
                const frameId = ${JSON.stringify(frameId)};
                const mount = document.getElementById('unistudy-three-mount');
                const originalBodyAppendChild = document.body.appendChild.bind(document.body);
                const originalBodyInsertBefore = document.body.insertBefore.bind(document.body);

                function shouldMountInsidePreview(node) {
                    return node && node.nodeType === 1 && String(node.tagName || '').toUpperCase() === 'CANVAS';
                }

                document.body.appendChild = function(node) {
                    if (shouldMountInsidePreview(node)) {
                        return mount.appendChild(node);
                    }
                    return originalBodyAppendChild(node);
                };

                document.body.insertBefore = function(node, before) {
                    if (shouldMountInsidePreview(node)) {
                        return mount.insertBefore(node, before && before.parentNode === mount ? before : null);
                    }
                    return originalBodyInsertBefore(node, before);
                };

                function reportHeight() {
                    const height = Math.max(360, mount.scrollHeight || mount.clientHeight || document.body.scrollHeight || 360);
                    window.parent.postMessage({
                        type: 'unistudy-html-resize',
                        height,
                        frameId
                    }, '*');
                }

                function showError(error) {
                    mount.innerHTML = '<div class="unistudy-three-error">' +
                        'Three.js preview failed:\\n\\n' +
                        String(error && (error.stack || error.message) || error)
                            .replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])) +
                        '</div>';
                    reportHeight();
                }

                window.addEventListener('load', () => {
                    try {
                        if (!window.THREE) {
                            throw new Error('THREE is not available. Check vendor/three.min.js path.');
                        }

                        const OriginalRenderer = THREE.WebGLRenderer;
                        THREE.WebGLRenderer = function(...args) {
                            const renderer = new OriginalRenderer(...args);
                            if (renderer && renderer.domElement && !renderer.domElement.isConnected) {
                                mount.appendChild(renderer.domElement);
                            }

                            const originalSetSize = renderer.setSize.bind(renderer);
                            renderer.setSize = function(width, height, updateStyle) {
                                const nextWidth = Number.isFinite(width) && width > 0 ? Math.min(width, mount.clientWidth || width) : (mount.clientWidth || 640);
                                const nextHeight = Number.isFinite(height) && height > 0 ? Math.min(height, 720) : 420;
                                return originalSetSize(nextWidth, nextHeight, updateStyle);
                            };

                            return renderer;
                        };
                        THREE.WebGLRenderer.prototype = OriginalRenderer.prototype;

                        ${safeScriptContent}

                        setTimeout(reportHeight, 50);
                        setTimeout(reportHeight, 500);
                    } catch (error) {
                        showError(error);
                    }
                });

                new ResizeObserver(reportHeight).observe(mount);
            <\/script>
        </body>
        </html>
    `;
}

function setupThreeJsPreview(preElement, codeContent) {
    if (preElement.dataset.richHtmlPreview === "true" ||
        preElement.dataset.richHtmlPreview === "blocked") return;

    const isInsideRichBubble = preElement.closest('.tool-request-bubble, .unistudy-tool-result-bubble, .learning-diary-bubble');
    if (isInsideRichBubble) {
        preElement.dataset.richHtmlPreview = "blocked";
        return;
    }

    if (codeContent.includes('「始」') || codeContent.includes('「末」')) {
        preElement.dataset.richHtmlPreview = "blocked";
        return;
    }

    preElement.dataset.richHtmlPreview = "true";

    const container = document.createElement('div');
    container.className = 'unistudy-html-preview-container unistudy-three-preview-container';
    preElement.parentNode.insertBefore(container, preElement);
    container.appendChild(preElement);

    const actionBtn = document.createElement('button');
    actionBtn.className = 'unistudy-html-preview-toggle';
    actionBtn.innerHTML = '<span>▶️ 预览</span>';
    actionBtn.title = '切换 Three.js 预览 / 源码';
    actionBtn.dataset.interactivePreview = 'true';
    actionBtn.type = 'button';
    container.appendChild(actionBtn);

    let previewFrame = null;
    let messageHandler = null;
    const frameId = `unistudy-three-${Math.random().toString(36).substr(2, 9)}`;

    const destroyPreview = () => {
        if (messageHandler) {
            window.removeEventListener('message', messageHandler);
            messageHandler = null;
        }
        if (previewFrame) {
            try {
                previewFrame.srcdoc = '';
                previewFrame.src = 'about:blank';
                previewFrame.contentWindow?.stop?.();
            } catch (e) { /* ignore */ }
            previewFrame.remove();
            previewFrame = null;
        }
    };

    container._previewCleanup = destroyPreview;

    const openPreview = () => {
        if (container.classList.contains('preview-mode')) return;

        const measuredHeight = preElement.offsetHeight || 0;
        const initialHeight = Math.max(260, Math.min(measuredHeight || 420, 720));
        container.style.minHeight = initialHeight + 'px';
        container.classList.add('preview-mode');
        actionBtn.innerHTML = '<span>源码</span>';

        if (!previewFrame) {
            previewFrame = document.createElement('iframe');
            previewFrame.className = 'unistudy-html-preview-frame unistudy-three-preview-frame';
            previewFrame.dataset.frameId = frameId;
            previewFrame.sandbox = 'allow-scripts allow-same-origin allow-modals';
            previewFrame.style.height = initialHeight + 'px';
            previewFrame.srcdoc = buildThreeJsPreviewHtml(codeContent, frameId);

            messageHandler = (msg) => {
                if (msg.data && msg.data.type === 'unistudy-html-resize' && msg.data.frameId === frameId) {
                    if (previewFrame) {
                        previewFrame.style.transition = 'height 0.3s ease';
                        previewFrame.style.height = msg.data.height + 'px';
                        container.style.minHeight = msg.data.height + 'px';
                    }
                }
            };
            window.addEventListener('message', messageHandler);
            container.appendChild(previewFrame);
        }

        setTimeout(() => {
            preElement.style.display = 'none';
        }, 50);
    };

    const showSource = () => {
        if (!container.classList.contains('preview-mode')) return;
        container.classList.remove('preview-mode');
        actionBtn.innerHTML = '<span>预览</span>';
        preElement.style.display = 'block';
        destroyPreview();
        container.style.minHeight = '';
    };

    actionBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (container.classList.contains('preview-mode')) {
            showSource();
        } else {
            openPreview();
        }
    });

    if (container.isConnected && preElement.isConnected) {
        openPreview();
        return;
    }

    requestAnimationFrame(() => {
        if (container.isConnected && preElement.isConnected) {
            openPreview();
        }
    });
}

/**
 * Sets up a play/return toggle for HTML code blocks.
 * @param {HTMLElement} preElement - The pre element containing the code.
 * @param {string} htmlContent - The raw HTML content.
 */
function setupHtmlPreview(preElement, htmlContent) {
    if (preElement.dataset.richHtmlPreview === "true" ||
        preElement.dataset.richHtmlPreview === "blocked") return;

    // 🟢 核心修复：检查是否在工具协议气泡内
    const isInsideRichBubble = preElement.closest('.tool-request-bubble, .unistudy-tool-result-bubble, .learning-diary-bubble');
    if (isInsideRichBubble) {
        console.log('[ContentProcessor] Skipping HTML preview: inside rich-render bubble');
        preElement.dataset.richHtmlPreview = "blocked";
        return;
    }
    
    // 🟢 额外检查：内容是否包含「始」「末」标记
    if (htmlContent.includes('「始」') || htmlContent.includes('「末」')) {
        console.log('[ContentProcessor] Skipping HTML preview: contains tool markers');
        preElement.dataset.richHtmlPreview = "blocked";
        return;
    }

    preElement.dataset.richHtmlPreview = "true";

    // Create container for the whole block to manage positioning
    const container = document.createElement('div');
    container.className = 'unistudy-html-preview-container';
    preElement.parentNode.insertBefore(container, preElement);
    container.appendChild(preElement);

    // Create the toggle button
    const actionBtn = document.createElement('button');
    actionBtn.className = 'unistudy-html-preview-toggle';
    actionBtn.innerHTML = '<span>▶️ 播放</span>';
    actionBtn.title = '切换 HTML 预览 / 源码';
    actionBtn.dataset.interactivePreview = 'true';
    actionBtn.type = 'button';
    container.appendChild(actionBtn);

    let previewFrame = null;
    let messageHandler = null;
    const frameId = `unistudy-frame-${Math.random().toString(36).substr(2, 9)}`;

    const destroyPreview = () => {
        if (messageHandler) {
            window.removeEventListener('message', messageHandler);
            messageHandler = null;
        }
        if (previewFrame) {
            // 🔴 关键修复：彻底切断 iframe 内部进程
            try {
                previewFrame.srcdoc = '';
                previewFrame.src = 'about:blank';
                previewFrame.contentWindow?.stop?.();
            } catch (e) { /* ignore */ }
            previewFrame.remove();
            previewFrame = null;
        }
    };

    // 将清理函数绑定到容器，以便外部（如 messageRenderer）调用
    container._previewCleanup = destroyPreview;

    const openPreview = () => {
        if (container.classList.contains('preview-mode')) return;

        // Keep the initial preview size reasonable even when the source code is very long.
        const measuredHeight = preElement.offsetHeight || 0;
        const initialHeight = Math.max(220, Math.min(measuredHeight || 360, 640));

        container.style.minHeight = initialHeight + 'px';
        container.classList.add('preview-mode');
        actionBtn.innerHTML = '<span>源码</span>';

        if (!previewFrame) {
            previewFrame = document.createElement('iframe');
            previewFrame.className = 'unistudy-html-preview-frame';
            previewFrame.dataset.frameId = frameId;
            previewFrame.style.height = initialHeight + 'px';

            previewFrame.srcdoc = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <style>
                            html, body { margin: 0; padding: 0; overflow: hidden; height: auto; }
                            body {
                                padding: 20px;
                                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                                background: white;
                                color: black;
                                line-height: 1.5;
                                box-sizing: border-box;
                                min-height: 100px;
                            }
                            * { box-sizing: border-box; }
                            img { max-width: 100%; height: auto; }
                        </style>
                    </head>
                    <body>
                        <div id="unistudy-wrapper">${htmlContent}</div>
                        <script>
                            function updateHeight() {
                                const wrapper = document.getElementById('unistudy-wrapper');
                                if (!wrapper) return;
                                const height = Math.max(wrapper.scrollHeight + 40, document.body.scrollHeight);
                                window.parent.postMessage({
                                    type: 'unistudy-html-resize',
                                    height: height,
                                    frameId: '${frameId}'
                                }, '*');
                            }
                            window.onload = () => {
                                setTimeout(updateHeight, 50);
                                setTimeout(updateHeight, 500);
                            };
                            new ResizeObserver(updateHeight).observe(document.body);
                        </script>
                    </body>
                    </html>
                `;

            messageHandler = (msg) => {
                if (msg.data && msg.data.type === 'unistudy-html-resize' && msg.data.frameId === frameId) {
                    if (previewFrame) {
                        // 🟢 平滑过渡到新高度
                        previewFrame.style.transition = 'height 0.3s ease';
                        previewFrame.style.height = msg.data.height + 'px';

                        // 同时更新容器的最小高度
                        container.style.minHeight = msg.data.height + 'px';
                    }
                }
            };
            window.addEventListener('message', messageHandler);

            container.appendChild(previewFrame);
        }

        // 🟢 延迟隐藏代码块，确保iframe先显示
        setTimeout(() => {
            preElement.style.display = 'none';
        }, 50);
    };

    const showSource = () => {
        if (!container.classList.contains('preview-mode')) return;

        container.classList.remove('preview-mode');
        actionBtn.innerHTML = '<span>播放</span>';

        // 🟢 先显示代码块
        preElement.style.display = 'block';

        // 🔴 关键修复：点击返回时销毁预览产生的资源，停止 JS 运行
        destroyPreview();

        // 清除固定高度限制
        container.style.minHeight = '';
    };

    actionBtn.addEventListener('click', (e) => {
        // 🔴 彻底阻止事件传播，防止触发任何父级监听器
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (container.classList.contains('preview-mode')) {
            showSource();
        } else {
            openPreview();
        }
    });

    // Default to the rendered learning artifact. Source remains available via the toggle.
    if (container.isConnected && preElement.isConnected) {
        openPreview();
        return;
    }

    requestAnimationFrame(() => {
        if (container.isConnected && preElement.isConnected) {
            openPreview();
        }
    });
}

/**
 * Processes interactive buttons in AI messages
 * @param {HTMLElement} contentDiv The message content element.
 */
function processInteractiveButtons(contentDiv, settings = {}) {
    if (!contentDiv) return;

    // 如果在全局设置中禁用了AI消息按钮，则直接返回
    if (settings.enableAiMessageButtons === false) {
        return;
    }

    // Find all button elements
    const buttons = contentDiv.querySelectorAll('button');

    buttons.forEach(button => {
        // Skip if already processed
        if (button.dataset.interactivePreview === 'true') return;

        // Mark as processed
        button.dataset.interactivePreview = 'true';

        // Set up button styling
        setupButtonStyle(button);

        // Add click event listener
        button.addEventListener('click', handleAIButtonClick);

        console.log('[ContentProcessor] Processed interactive button:', button.textContent.trim());
    });
}

/**
 * Sets up functional properties for interactive buttons (no styling)
 * @param {HTMLElement} button The button element
 */
function setupButtonStyle(button) {
    // Ensure button looks clickable
    button.style.cursor = 'pointer';

    // Prevent any form submission or default behavior
    button.type = 'button';
    button.setAttribute('type', 'button');

    // Note: Visual styling is left to AI-defined CSS classes and styles
}

/**
 * Handles click events on AI-generated buttons
 * @param {Event} event The click event
 */
function handleAIButtonClick(event) {
    const button = event.target;

    // Completely prevent any default behavior
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    // Check if button is disabled
    if (button.disabled) {
        return false;
    }

    // Get text to send (priority: data-send attribute > button text)
    const sendText = button.dataset.send || button.textContent.trim();

    // Validate text
    if (!sendText || sendText.length === 0) {
        console.warn('[ContentProcessor] Button has no text to send');
        return false;
    }

    // Format the text to be sent
    let finalSendText = `[[点击按钮:${sendText}]]`;

    // Truncate if the final text is too long
    if (finalSendText.length > 500) {
        console.warn('[ContentProcessor] Button text too long, truncating');
        const maxTextLength = 500 - '[[点击按钮:]]'.length; // Account for '[[点击按钮:' and ']]'
        const truncatedText = sendText.substring(0, maxTextLength);
        finalSendText = `[[点击按钮:${truncatedText}]]`;
    }

    // Disable button to prevent double-click
    disableButton(button);

    // Send the message asynchronously to avoid blocking
    setTimeout(() => {
        sendButtonMessage(finalSendText, button);
    }, 10);

    return false;
}

/**
 * Disables a button and provides visual feedback
 * @param {HTMLElement} button The button to disable
 */
function disableButton(button) {
    button.disabled = true;
    button.style.opacity = '0.6';
    button.style.cursor = 'not-allowed';

    // Add checkmark to indicate it was clicked
    const originalText = button.textContent;
    button.textContent = originalText + ' ?';

    // Store original text for potential restoration
    button.dataset.originalText = originalText;
}

/**
 * Restores a button to its original state
 * @param {HTMLElement} button The button to restore
 */
function restoreButton(button) {
    button.disabled = false;
    button.style.opacity = '1';
    button.style.cursor = 'pointer';

    // Restore original text if available
    if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
    }
}

/**
 * Sends a message triggered by button click
 * @param {string} text The text to send
 * @param {HTMLElement} button The button that triggered the send
 */
function sendButtonMessage(text, button) {
    try {
        if (window.sendMessage && typeof window.sendMessage === 'function') {
            window.sendMessage(text);
        } else {
            throw new Error('No message sending function available');
        }

        console.log('[ContentProcessor] Button message sent:', text);

    } catch (error) {
        console.error('[ContentProcessor] Failed to send button message:', error);

        // Restore button on error
        restoreButton(button);

        // Show error notification
        showErrorNotification('发送失败，请重试');
    }
}

/**
 * Sends message via main chat interface
 * @param {string} text The text to send
 */
function sendMessageViaMainChat(text) {
    if (window.sendMessage && typeof window.sendMessage === 'function') {
        window.sendMessage(text);
        return;
    }

    throw new Error('UniStudy sendMessage bridge is not available');
}

/**
 * Shows an error notification to the user
 * @param {string} message The error message
 */
function showErrorNotification(message) {
    // Try to use existing notification system
    if (window.uiHelper && typeof window.uiHelper.showToastNotification === 'function') {
        window.uiHelper.showToastNotification(message, 'error');
        return;
    }

    // Fallback: create a simple notification
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ff4444;
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        z-index: 10000;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;

    document.body.appendChild(notification);

    // Auto remove after 3 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            document.body.removeChild(notification);
        }
    }, 3000);
}

/**
 * Applies synchronous post-render processing to the message content.
 * This handles tasks like KaTeX, code highlighting, and button processing
 * that do not depend on a fully stable DOM tree from complex innerHTML.
 * @param {HTMLElement} contentDiv The message content element.
 */
function processRenderedContent(contentDiv, settings = {}) {
    if (!contentDiv) return;

    // KaTeX rendering
    if (window.renderMathInElement) {
        window.renderMathInElement(contentDiv, {
            delimiters: [
                {left: "$$", right: "$$", display: true}, {left: "$", right: "$", display: false},
                {left: "\\(", right: "\\)", display: false}, {left: "\\[", right: "\\]", display: true}
            ],
            throwOnError: false
        });
    }

    // Special block formatting (tool protocol / diary)
    processAllPreBlocksInContentDiv(contentDiv);

    // Process interactive buttons, passing settings
    processInteractiveButtons(contentDiv, settings);

    // Apply syntax highlighting to code blocks
    if (window.hljs) {
        contentDiv.querySelectorAll('pre code').forEach((block) => {
            // 🟢 增加防御性检查：确保 block 及其父元素存在
            // 在嵌套的 code block 场景下，外层 block 的高亮可能会导致内层 block 被移出 DOM
            if (block && block.parentElement) {
                // Only highlight if the block hasn't been specially prettified (for example DailyNote or tool use)
                if (!block.parentElement.dataset.toolRequestPrettified && !block.parentElement.dataset.learningDiaryPrettified) {
                    window.hljs.highlightElement(block);
                }
            }
        });
    }
}



/**
 * Applies a series of common text processing rules in a single pass.
 * @param {string} text The input string.
 * @returns {string} The processed string.
 */
function applyContentProcessors(text) {
    if (typeof text !== 'string') return text;
    
    // Apply processors that need special handling first
    let processedText = text;
    
    // Use the proper function for code block markers (preserves content formatting)
    processedText = removeIndentationFromCodeBlockMarkers(processedText);
    
    // Then apply simple regex replacements
    return processedText
        // ensureNewlineAfterCodeBlock
        .replace(/^(\s*```)(?![A-Za-z0-9_-]*[\r\n])(?=\S)/gm, '$1\n')
        // ensureSpaceAfterTilde
        .replace(/(^|[^\w/\\=])~(?![\s~])/g, '$1~ ')
        // removeSpeakerTags - Simplified regex to remove all occurrences at the start
        .replace(/^(\[(?:(?!\]:\s).)*的发言\]:\s*)+/g, '')
        // ensureSeparatorBetweenImgAndCode
        .replace(/(<img[^>]+>)\s*(```)/g, '$1\n\n<!-- UniStudy-Renderer-Separator -->\n\n$2');
}


/**
 * 智能地移除被错误解析为代码块的行首缩进。
 * 它会跳过代码围栏 (```) 内部的内容和 Markdown 列表项。
 * @param {string} text 输入文本。
 * @returns {string} 处理后的文本。
 */
/**
 * 智能地移除被错误解析为代码块的行首缩进。
 * 只处理HTML标签的缩进，完全保护代码块和普通文本的格式。
 * @param {string} text 输入文本。
 * @returns {string} 处理后的文本。
 */
function deIndentMisinterpretedCodeBlocks(text) {
    if (typeof text !== 'string') return text;

    const lines = text.split('\n');
    let inFence = false;
    
    // 匹配 Markdown 列表标记，例如 *, -, 1.
    const listRegex = /^\s*([-*]|\d+\.)\s+/;
    
    // 匹配可能导致Markdown解析问题的HTML标签
    const htmlTagRegex = /^\s*<\/?(div|p|img|span|a|h[1-6]|ul|ol|li|table|tr|td|th|section|article|header|footer|nav|aside|main|figure|figcaption|blockquote|pre|code|style|script|button|form|input|textarea|select|label|iframe|video|audio|canvas|svg)[\s>\/]/i;

    // 匹配中文字符开头，用于识别首行缩进的段落
    const chineseParagraphRegex = /^[\u4e00-\u9fa5]/;

    return lines.map(line => {
        // 检测代码围栏
        if (line.trim().startsWith('```')) {
            inFence = !inFence;
            // 移除代码围栏标记本身的缩进
            return line.trimStart();
        }

        // 如果在代码块内，完全不处理
        if (inFence) {
            return line;
        }

        const trimmedStartLine = line.trimStart();
        const hasIndentation = line.length > trimmedStartLine.length;

        // 只处理有缩进的行
        if (hasIndentation) {
            // 如果是列表项，则不处理
            if (listRegex.test(line)) {
                return line;
            }
            
            // 🟢 如果是HTML标签或中文段落，则移除缩进
            if (htmlTagRegex.test(line) || chineseParagraphRegex.test(trimmedStartLine)) {
                return trimmedStartLine;
            }
        }

        // 其他所有情况，保持原样
        return line;
    }).join('\n');
}



/**
 * 清理指定容器及其子元素中所有的 HTML 预览资源（iframe、事件监听器等）。
 * @param {HTMLElement} contentDiv - 存储消息内容的容器。
 */
function cleanupPreviewsInContent(contentDiv) {
    if (!contentDiv) return;
    const containers = contentDiv.querySelectorAll('.unistudy-html-preview-container');
    containers.forEach(container => {
        if (typeof container._previewCleanup === 'function') {
            try {
                container._previewCleanup();
            } catch (e) {
                console.error('[ContentProcessor] Error during preview cleanup:', e);
            }
            delete container._previewCleanup;
        }
    });
}


export {
    initializeContentProcessor,
    ensureNewlineAfterCodeBlock,
    ensureSpaceAfterTilde,
    removeIndentationFromCodeBlockMarkers,
    removeSpeakerTags,
    ensureSeparatorBetweenImgAndCode,
    deIndentToolRequestBlocks,
    deIndentMisinterpretedCodeBlocks,
    processAllPreBlocksInContentDiv,
    processRenderedContent,
    processInteractiveButtons,
    handleAIButtonClick,
    highlightAllPatternsInMessage, // Export the new async highlighter
    sendButtonMessage,
    scopeCss, // Export the new CSS scoping function
    applyContentProcessors, // Export the new batch processor
    escapeHtml,
    processStartEndMarkers,
    cleanupPreviewsInContent
};
