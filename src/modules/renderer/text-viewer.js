import * as emoticonFixer from './emoticonUrlFixer.js';

import { renderMarkdownToSafeHtml, sanitizeHtml } from './safeHtml.js';
import { scopeCss } from './scopedCss.js';

document.addEventListener('DOMContentLoaded', async () => {
    const viewerAPI = window.utilityAPI || window.electronAPI;

    // --- Start: Emoticon URL Fixer (Module) ---
    // The main logic is now imported from emoticonUrlFixer.js
    async function fixEmoticonImagesInContainer(container) {
        // Ensure the fixer is initialized before trying to fix URLs.
        // The initialize function is idempotent and returns a promise.
        if (viewerAPI) {
            await emoticonFixer.initialize(viewerAPI);
        }

        const images = container.querySelectorAll('img');
        images.forEach(img => {
            const originalSrc = img.getAttribute('src');
            if (originalSrc) {
                const fixedSrc = emoticonFixer.fixEmoticonUrl(originalSrc);
                if (originalSrc !== fixedSrc) {
                    img.src = fixedSrc;
                }
            }
        });
    }
    // --- End: Emoticon URL Fixer (Module) ---

    // Initialization is now handled on-demand inside fixEmoticonImagesInContainer.

    let originalRawContent = ''; // To store the raw, un-rendered content

    // --- Start: Ported Pre-processing functions from messageRenderer ---

    /**
     * Generates a unique ID for scoping CSS.
     * @returns {string} A unique ID string (e.g., 'unistudy-viewer-1a2b3c4d').
     */
    function generateUniqueId() {
        const timestampPart = Date.now().toString(36);
        const randomPart = Math.random().toString(36).substring(2, 9);
        return `unistudy-viewer-${timestampPart}${randomPart}`;
    }

    /**
     * Extracts, scopes, and injects CSS from the content.
     * @param {string} content - The raw message content.
     * @param {string} scopeId - The unique ID for scoping.
     * @returns {{processedContent: string, styleInjected: boolean}}
     */
    function processAndInjectScopedCss(content, scopeId) {
        let cssContent = '';
        let styleInjected = false;
        const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

        const processedContent = content.replace(styleRegex, (match, css) => {
            cssContent += css.trim() + '\n';
            return ''; // Remove style tag
        });

        if (cssContent.length > 0) {
            try {
                const scopedCss = scopeCss(cssContent, scopeId);
                const styleElement = document.createElement('style');
                styleElement.type = 'text/css';
                styleElement.setAttribute('data-unistudy-scope-id', scopeId);
                styleElement.textContent = scopedCss;
                document.head.appendChild(styleElement);
                styleInjected = true;
            } catch (error) {
                console.error(`[ScopedCSS] Failed to scope or inject CSS for ID: ${scopeId}`, error);
            }
        }
        return { processedContent, styleInjected };
    }


    function deIndentHtml(text) {
        const lines = text.split('\n');
        let inFence = false;
        return lines.map(line => {
            if (line.trim().startsWith('```')) {
                inFence = !inFence;
                return line;
            }
            if (!inFence && line.trim().startsWith('<')) {
                return line.trimStart();
            }
            return line;
        }).join('\n');
    }

    function escapeHtml(text) {
        if (typeof text !== 'string') return '';
        return text
            .replace(/&/g, '&')
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/"/g, '"')
            .replace(/'/g, '&#039;');
    }

    function transformSpecialBlocksForViewer(text) {
        // Protect tool, note, and desktop-push blocks before the generic viewer transform runs.
        const toolRegex = /(?<!`)<<<\[TOOL_REQUEST\]>>>(.*?)<<<\[END_TOOL_REQUEST\]>>>(?!`)/gs;
        const noteRegex = /<<<DailyNoteStart>>>(.*?)<<<DailyNoteEnd>>>/gs;
        const toolResultRegex = /\[\[(?:VCP调用结果信息汇总|VCP璋冪敤缁撴灉淇℃伅姹囨€.)(.*?)?(?:VCP调用结果结束|VCP璋冪敤缁撴灉缁撴潫)\]\]/gs;
        // Keep partial desktop push payloads readable during streaming or interrupted output.
        const desktopPushRegex = /(?<!`)<<<\[DESKTOP_PUSH\]>>>([\s\S]*?)<<<\[DESKTOP_PUSH_END\]>>>(?!`)/gs;
        const desktopPushPartialRegex = /(?<!`)<<<\[DESKTOP_PUSH\]>>>([\s\S]*)$/s;

        let processed = text;

        // Render full desktop-push blocks as HTML code blocks in the viewer.
        processed = processed.replace(desktopPushRegex, (match, rawContent) => {
            const content = rawContent.trim();
            // Show the raw HTML source instead of executing it inside the viewer page.
            return '\n```html\n' + content + '\n```\n';
        });
        // Keep incomplete desktop-push blocks readable while the stream is still unfinished.
        processed = processed.replace(desktopPushPartialRegex, (match, rawContent) => {
            const content = rawContent.trim();
            return '\n```html\n' + content + '\n[桌面推送代码块尚未完整结束]\n```\n';
        });

        // Process VCP tool results in viewer mode with full details.
        processed = processed.replace(toolResultRegex, (match, rawContent) => {
            const content = rawContent.trim();
            const lines = content.split('\n').filter(line => line.trim() !== '');

            let toolName = '未知工具';
            let status = '未知状态';
            const details = [];
            let otherContent = [];

            const normalizeToolResultKey = (key) => {
                const normalized = String(key || '').trim();
                const lower = normalized.toLowerCase();

                const toolKeyAliases = ['宸ュ叿鍚嶇О', '锟斤拷锟斤拷锟斤拷锟斤拷'];
                const statusKeyAliases = ['鎵ц鐘舵€?', '执锟斤拷状态'];
                const imageUrlAliases = ['鐢诲儚URL', '锟缴凤拷锟斤拷URL'];
                const imageAliases = ['鐢诲儚', '锟斤拷锟斤拷锟斤拷锟斤拷'];
                const resultAliases = ['缁撴灉', '锟斤拷锟斤拷锟斤拷锟斤拷'];

                if (normalized === '工具名称' || ['tool_name', 'tool name', 'name'].includes(lower) || toolKeyAliases.includes(normalized)) return 'tool';
                if (normalized === '执行状态' || ['status'].includes(lower) || lower.startsWith('status') || statusKeyAliases.includes(normalized)) return 'status';
                if (normalized === '图片URL' || ['image_url', 'image url', 'url'].includes(lower) || imageUrlAliases.includes(normalized)) return 'imageUrl';
                if (normalized === '图片' || ['image'].includes(lower) || imageAliases.includes(normalized)) return 'image';
                if (normalized === '结果' || ['result', 'output', 'content'].includes(lower) || resultAliases.includes(normalized)) return 'result';
                return normalized;
            };

            lines.forEach(line => {
                const kvMatch = line.match(/-\s*([^:]+):\s*(.*)/);
                if (kvMatch) {
                    const key = kvMatch[1].trim();
                    const value = kvMatch[2].trim();
                    const displayKey = normalizeToolResultKey(key);
                    if (displayKey === 'tool') {
                        toolName = value;
                    } else if (displayKey === 'status') {
                        status = value;
                    } else {
                        details.push({ key: displayKey, value });
                    }
                } else {
                    otherContent.push(line);
                }
            });

            let html = `<div class="unistudy-tool-result-bubble">`;
            html += `<div class="unistudy-tool-result-header">`;
            html += `<span class="unistudy-tool-result-label">Tool Result</span>`;
            html += `<span class="unistudy-tool-result-name">${escapeHtml(toolName)}</span>`;
            html += `<span class="unistudy-tool-result-status">${escapeHtml(status)}</span>`;
            html += `</div>`;

            html += `<div class="unistudy-tool-result-details">`;
            details.forEach(({ key, value }) => {
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                let processedValue = escapeHtml(value);
                
                if ((key === 'imageUrl' || key === 'image') && value.match(/\.(jpeg|jpg|png|gif)$/i)) {
                     processedValue = `<a href="${value}" target="_blank" rel="noopener noreferrer" title="Open generated image"><img src="${value}" class="unistudy-tool-result-image" alt="Generated Image"></a>`;
                } else {
                    processedValue = processedValue.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
                }
                
                if (key === 'result') {
                    processedValue = processedValue.replace(/###(.*?)###/g, '<strong>$1</strong>');
                }

                const displayKeyMap = {
                    imageUrl: '图片 URL',
                    image: '图片',
                    result: '结果',
                };
                const renderedKey = displayKeyMap[key] || key;

                html += `<div class="unistudy-tool-result-item">`;
                html += `<span class="unistudy-tool-result-item-key">${escapeHtml(renderedKey)}:</span> `;
                html += `<span class="unistudy-tool-result-item-value">${processedValue}</span>`;
                html += `</div>`;
            });
            html += `</div>`;

            if (otherContent.length > 0) {
                html += `<div class="unistudy-tool-result-footer"><pre>${escapeHtml(otherContent.join('\n'))}</pre></div>`;
            }

            html += `</div>`;

            return html;
        });

        // Process tool requests in viewer mode with full details.
        processed = processed.replace(toolRegex, (match, content) => {
            const toolNameRegex = /<tool_name>([\s\S]*?)<\/tool_name>|tool_name:\s*([^\n\r]*)/;
            const toolNameMatch = content.match(toolNameRegex);
            let toolName = (toolNameMatch && (toolNameMatch[1] || toolNameMatch[2])) ? (toolNameMatch[1] || toolNameMatch[2]).trim() : '工具调用';
            toolName = toolName.replace(/(?:《始》|《末》|「始」|「末」|锟斤拷始锟斤拷|锟斤拷末锟斤拷|,)/g, '').trim();

            let finalContent = escapeHtml(content.trim());
            if (toolName) {
                 finalContent = finalContent.replace(
                    escapeHtml(toolName),
                    `<span class="unistudy-tool-name-highlight">${escapeHtml(toolName)}</span>`
                );
            }
            
            return `<div class="vcp-tool-use-bubble">` +
                   `<span class="unistudy-tool-label">Tool Use:</span> ` +
                   finalContent +
                   `</div>`;
        });

        // Process Daily Notes - Viewer Mode (Styled)
        processed = processed.replace(noteRegex, (match, rawContent) => {
            const content = rawContent.trim();
            const maidRegex = /(?:Maid|日志本):\s*([^\n\r]*)/;
            const dateRegex = /Date:\s*([^\n\r]*)/;
            const contentRegex = /Content:\s*([\s\S]*)/;

            const maidMatch = content.match(maidRegex);
            const dateMatch = content.match(dateRegex);
            const contentMatch = content.match(contentRegex);

            const notebook = maidMatch ? maidMatch[1].trim() : '';
            const date = dateMatch ? dateMatch[1].trim() : '';
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

            html += `<div class="diary-content">${escapeHtml(diaryContent)}</div>`;
            html += `</div>`;

            return html;
        });

        return processed;
    }
    
    function ensureHtmlFenced(text) {
        const doctypeTag = '<!DOCTYPE html>';
        const lowerText = text.toLowerCase();
        
        // Quick exit if no doctype is present.
        if (!lowerText.includes(doctypeTag.toLowerCase())) {
            return text;
        }
        
        // If it's already in a proper code block, do nothing.
        // This regex now checks for any language specifier (or none) after the fences.
        if (/```\w*\n<!DOCTYPE html>/i.test(text)) {
            return text;
        }

        let result = '';
        let lastIndex = 0;
        while (true) {
            const startIndex = lowerText.indexOf(doctypeTag.toLowerCase(), lastIndex);

            const textSegment = text.substring(lastIndex, startIndex === -1 ? text.length : startIndex);
            result += textSegment;

            if (startIndex === -1) {
                break;
            }

            const endIndex = lowerText.indexOf('</html>', startIndex + doctypeTag.length);
            if (endIndex === -1) {
                result += text.substring(startIndex);
                break;
            }

            const block = text.substring(startIndex, endIndex + '</html>'.length);
            
            const fencesInResult = (result.match(/```/g) || []).length;

            if (fencesInResult % 2 === 0) {
                result += `\n\`\`\`html\n${block}\n\`\`\`\n`;
            } else {
                result += block;
            }

            lastIndex = endIndex + '</html>'.length;
        }
        return result;
    }

    function preprocessFullContent(text, scopeId) {
        // Step 1: Ensure any raw HTML documents are properly fenced first. This is critical.
        let processed = ensureHtmlFenced(text);

        const codeBlockMap = new Map();
        let placeholderId = 0;

        // Step 2: Now, find and protect ALL fenced code blocks (including the ones we just added).
        // This prevents the CSS processor from touching styles inside code blocks.
        processed = processed.replace(/```\w*([\s\S]*?)```/g, (match) => {
            const placeholder = `__VCP_CODE_BLOCK_PLACEHOLDER_${placeholderId}__`;
            codeBlockMap.set(placeholder, match);
            placeholderId++;
            return placeholder;
        });

        // Step 3: Process and scope CSS from the main content (outside code blocks).
        const { processedContent: contentWithoutStyles } = processAndInjectScopedCss(processed, scopeId);
        processed = contentWithoutStyles;

        // Step 4: Run other pre-processing on the text (which still has placeholders).
        processed = deIndentHtml(processed);
        processed = transformSpecialBlocksForViewer(processed);
        
        // Basic content processors from contentProcessor.js
        processed = processed.replace(/^(\s*```)(?![\r\n])/gm, '$1\n'); // ensureNewlineAfterCodeBlock
        processed = processed.replace(/~(?![\s~])/g, '~ '); // ensureSpaceAfterTilde
        processed = processed.replace(/^(\s*)(```.*)/gm, '$2'); // removeIndentationFromCodeBlockMarkers
        processed = processed.replace(/(<img[^>]+>)\s*(```)/g, '$1\n\n<!-- UniStudy-Renderer-Separator -->\n\n$2'); // ensureSeparatorBetweenImgAndCode

        // Step 5: Restore the protected code blocks.
        if (codeBlockMap.size > 0) {
            for (const [placeholder, block] of codeBlockMap.entries()) {
                processed = processed.replace(placeholder, block);
            }
        }

        return processed;
    }

    // --- End: Ported functions ---

    /**
     * Replaces CDN URLs in script content with local vendor paths
     * @param {string} scriptContent - The script text content
     * @returns {string} The processed script content with local paths
     */
    function replaceCdnUrls(scriptContent) {
        if (!scriptContent || typeof scriptContent !== 'string') {
            return scriptContent;
        }
        
        let processed = scriptContent;
        
        // Replace external CDN URLs with bundled vendor assets.
        
        // 1. Replace Three.js CDN URLs. Viewer files live under modules/, so keep ../ prefixes.
        const threeJsPatterns = [
            /https?:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/[^'"`);\s]*/gi,
            /https?:\/\/cdn\.jsdelivr\.net\/npm\/three[@\/][^'"`);\s]*/gi,
            /https?:\/\/unpkg\.com\/three[@\/][^'"`);\s]*/gi,
        ];
        
        threeJsPatterns.forEach(pattern => {
            processed = processed.replace(pattern, '../../../vendor/three.min.js');
        });
        
        // 2. Replace Anime.js CDN URLs.
        const animeJsPatterns = [
            /https?:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/animejs\/[^'"`);\s]*/gi,
            /https?:\/\/cdn\.jsdelivr\.net\/npm\/animejs[@\/][^'"`);\s]*/gi,
            /https?:\/\/unpkg\.com\/animejs[@\/][^'"`);\s]*/gi,
        ];
        
        animeJsPatterns.forEach(pattern => {
            processed = processed.replace(pattern, '../../../vendor/anime.min.js');
        });
        
        // 3. Catch common CDN fallbacks as a final pass.
        const genericCdnPatterns = [
            { pattern: /https?:\/\/[^'"`);\s]*three[^'"`);\s]*\.js/gi, replacement: '../../../vendor/three.min.js' },
            { pattern: /https?:\/\/[^'"`);\s]*anime[^'"`);\s]*\.js/gi, replacement: '../../../vendor/anime.min.js' },
        ];
        
        genericCdnPatterns.forEach(({ pattern, replacement }) => {
            processed = processed.replace(pattern, replacement);
        });
        
        return processed;
    }

    /**
     * Finds and executes script tags within a given HTML element.
     * This is necessary because scripts inserted via innerHTML are not automatically executed.
     * @param {HTMLElement} containerElement - The element to search for scripts within.
     */
    function processAnimationsInContent(containerElement) {
        if (!containerElement || !window.anime) return;

        const scripts = Array.from(containerElement.querySelectorAll('script'));
        scripts.forEach(oldScript => {
            try {
                if (oldScript.type && oldScript.type !== 'text/javascript' && oldScript.type !== 'application/javascript') {
                    return;
                }
                
                // Handle external script tags that carry a src attribute.
                if (oldScript.src) {
                    // Avoid re-running the main text-viewer script
                    if (oldScript.src.includes('text-viewer.js')) {
                        return;
                    }

                    const originalSrc = oldScript.src;
                    const processedSrc = replaceCdnUrls(originalSrc);

                    if (processedSrc !== originalSrc) {
                        console.log('[TextViewer] Replaced external script src:', originalSrc, '->', processedSrc);

                        const newScript = document.createElement('script');
                        // Clone attributes while swapping the src value.
                        Array.from(oldScript.attributes).forEach(attr => {
                            if (attr.name === 'src') {
                                newScript.setAttribute('src', processedSrc);
                            } else {
                                newScript.setAttribute(attr.name, attr.value);
                            }
                        });

                        // Track the load promise so inline scripts can wait for external libraries.
                        const loadPromise = new Promise((resolve, reject) => {
                            newScript.onload = () => {
                                console.log('[TextViewer] External library loaded:', processedSrc);
                                resolve();
                            };
                            newScript.onerror = (err) => {
                                console.error('[TextViewer] Failed to load external library:', processedSrc, err);
                                reject(err); // or resolve() to not block other scripts
                            };
                        });

                        // Store promises globally so later inline scripts can await them.
                        if (!window.__vcpExternalLibsLoading) {
                            window.__vcpExternalLibsLoading = [];
                        }
                        window.__vcpExternalLibsLoading.push(loadPromise);

                        if (oldScript.parentNode) {
                            oldScript.parentNode.replaceChild(newScript, oldScript);
                        }
                    } else {
                        console.log('[TextViewer] ?? External script src not a CDN:', originalSrc);
                    }
                    return; // External script handled.
                }

                // Inline script path: no src attribute to rewrite.
                const originalContent = oldScript.textContent || '';
                
                // Skip empty inline scripts.
                if (!originalContent.trim()) {
                    console.log('[TextViewer] ?? Skipping empty inline script');
                    return;
                }
                
                const processedContent = replaceCdnUrls(originalContent);
                
                if (processedContent !== originalContent) {
                    console.log('[TextViewer] Replaced CDN URLs in inline script');
                }
                
                const newScript = document.createElement('script');
                Array.from(oldScript.attributes).forEach(attr => {
                    newScript.setAttribute(attr.name, attr.value);
                });

                // Wait for external libraries before running dependent inline scripts.
                if (window.__vcpExternalLibsLoading && window.__vcpExternalLibsLoading.length > 0) {
                    console.log('[TextViewer] Waiting for external libraries to load before executing inline script...');
                    
                    // Wrap the inline content so it executes after dependencies are ready.
                    const wrappedContent = `
                        (async function() {
                            try {
                                if (window.__vcpExternalLibsLoading) {
                                    await Promise.all(window.__vcpExternalLibsLoading);
                                    console.log('[TextViewer] ? All external libraries loaded, executing inline script.');
                                }
                                ${processedContent}
                            } catch (error) {
                                console.error('[TextViewer] ? Error in wrapped inline script:', error);
                            }
                        })();
                    `;
                    newScript.textContent = wrappedContent;
                } else {
                    // No external dependencies are pending, so execute immediately.
                    newScript.textContent = processedContent;
                }
                
                if (oldScript.parentNode) {
                    oldScript.parentNode.replaceChild(newScript, oldScript);
                }
            } catch (error) {
                console.error('[TextViewer] ? Error processing script:', error);
                console.error('[TextViewer] Script element:', oldScript);
            }
        });
    }


    // --- Theme Management ---
    function applyTheme(theme) {
        const currentTheme = theme || 'dark';
        document.body.classList.toggle('light-theme', currentTheme === 'light');
        const highlightThemeStyle = document.getElementById('highlight-theme-style');
        if (highlightThemeStyle) {
            highlightThemeStyle.href = currentTheme === 'light'
                ? "../../../vendor/atom-one-light.min.css"
                : "../../../vendor/atom-one-dark.min.css";
        }
    }

    const params = new URLSearchParams(window.location.search);
    const initialTheme = params.get('theme') || 'dark';
    applyTheme(initialTheme);
    console.log(`[TextViewer] Initial theme set from URL: ${initialTheme}`);

    if (viewerAPI) {
        viewerAPI.onThemeUpdated(applyTheme);
    } else {
        console.log('[TextViewer] viewer API not found. Theme updates will not be received.');
    }

    mermaid.initialize({ startOnLoad: false }); // Initialize Mermaid for manual rendering.

    if (window.marked) {
        marked.setOptions({
            gfm: true,
            tables: true,
            breaks: false,
            pedantic: false,
            sanitize: false,
            smartLists: true,
            smartypants: false
        });
    }

    // --- Dual-Mode Python Execution ---
    let pyodide = null;
    let isPyodideLoading = false;

    async function initializePyodide(statusElement) {
        if (pyodide) return pyodide;
        if (isPyodideLoading) {
        statusElement.textContent = 'Pyodide 正在加载，请稍候...';
            return null;
        }
        isPyodideLoading = true;
        try {
        statusElement.textContent = '正在加载 Pyodide 脚本...';
            if (!window.loadPyodide) {
                const script = document.createElement('script');
                script.src = '../../../vendor/pyodide.js';
                document.head.appendChild(script);
                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = reject;
                });
            }
            statusElement.textContent = '正在初始化 Pyodide 内核...（可能需要一点时间）';
            pyodide = await window.loadPyodide({
                indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/"
            });
            console.log("Pyodide initialized successfully.");
            return pyodide;
        } catch (error) {
            console.error("Pyodide initialization failed:", error);
            statusElement.textContent = `Pyodide 初始化失败：${error}`;
            return null;
        } finally {
            isPyodideLoading = false;
        }
    }


    // --- Start: Python Executors as requested ---

    function displayPythonResult(outputContainer, result) {
        const trimmedResult = result.trim();
        // A simple check for HTML content. It looks for a string that starts with a tag.
        const isHtml = /^<[a-z][\s\S]*>/i.test(trimmedResult);
        if (isHtml) {
            outputContainer.innerHTML = sanitizeHtml(trimmedResult);
        } else {
            outputContainer.textContent = trimmedResult || '执行完成，没有输出。';
        }
    }

    async function py_safe_executor(code, outputContainer) {
        outputContainer.textContent = '正在准备 Python 沙箱环境...';
        const pyodideInstance = await initializePyodide(outputContainer);
        if (!pyodideInstance) return;

        try {
            // First, handle packages specified in comments
            const packageRegex = /^#\s*requires:\s*([a-zA-Z0-9_,\s-]+)/gm;
            const packages = new Set();
            let match;
            while ((match = packageRegex.exec(code)) !== null) {
                match[1].split(',').forEach(p => {
                    const pkg = p.trim();
                    if (pkg) packages.add(pkg);
                });
            }

            if (packages.size > 0) {
                const packageList = Array.from(packages);
                outputContainer.textContent = `正在加载所需依赖：${packageList.join(', ')}...`;
                await pyodideInstance.loadPackage(packageList);
            outputContainer.textContent = '依赖已加载，正在执行代码...';
            } else {
            outputContainer.textContent = '正在沙箱中执行代码...';
            }

            let stdout = '';
            let stderr = '';
            pyodideInstance.setStdout({ batched: (s) => { stdout += s + '\n'; } });
            pyodideInstance.setStderr({ batched: (s) => { stderr += s + '\n'; } });
            
            await pyodideInstance.runPythonAsync(code);

            let result = '';
            if (stdout) result += stdout;
            if (stderr) result += `\n--- ERRORS ---\n${stderr}`;
            
            displayPythonResult(outputContainer, result);

        } catch (error) {
            const errorMessage = error.toString();
            const packageMatch = errorMessage.match(/await pyodide\.loadPackage\("([^"]+)"\)/) || errorMessage.match(/await micropip\.install\("([^"]+)"\)/);

            if (packageMatch && packageMatch[1]) {
                const missingPackage = packageMatch[1];
                try {
                    outputContainer.textContent = `检测到缺少依赖：${missingPackage}，正在尝试安装...`;
                    await pyodideInstance.loadPackage(missingPackage);
                    outputContainer.textContent = `依赖 ${missingPackage} 已安装，正在重新执行...`;
                    
                    let stdout = '';
                    let stderr = '';
                    pyodideInstance.setStdout({ batched: (s) => { stdout += s + '\n'; } });
                    pyodideInstance.setStderr({ batched: (s) => { stderr += s + '\n'; } });
                    
                    await pyodideInstance.runPythonAsync(code);

                    let result = '';
                    if (stdout) result += stdout;
                    if (stderr) result += `\n--- ERRORS ---\n${stderr}`;
                    
                    displayPythonResult(outputContainer, result);

                } catch (retryError) {
                    console.error(`Sandbox Python execution error on retry for ${missingPackage}:`, retryError);
            outputContainer.textContent = `沙箱执行错误：\n安装并重试 '${missingPackage}' 后仍然失败。\n${retryError.toString()}`;
                }
            } else {
                console.error("Sandbox Python execution error:", error);
        outputContainer.textContent = `沙箱执行错误：\n${error.toString()}`;
            }
        }
    }

    async function py_penetration_executor(code, outputContainer) {
        console.log('[text-viewer] Entering py_penetration_executor.');
        outputContainer.textContent = '正在使用本地 Python 执行...';
        if (viewerAPI && viewerAPI.executePythonCode) {
            try {
                console.log('[text-viewer] Calling viewerAPI.executePythonCode...');
                const { stdout, stderr } = await viewerAPI.executePythonCode(code);
                console.log('[text-viewer] viewerAPI.executePythonCode returned.');
                console.log('[text-viewer] Python stdout (from renderer):', stdout);
                console.log('[text-viewer] Python stderr (from renderer):', stderr);

                let result = '';
                // Strip ANSI escape codes before displaying
                const cleanedStdout = stripAnsi(stdout);
                const cleanedStderr = stripAnsi(stderr);

                if (cleanedStdout) result += `--- 输出 ---\n${cleanedStdout}`;
                if (cleanedStderr) result += `\n--- 错误 ---\n${cleanedStderr}`;
                outputContainer.textContent = result.trim() || '执行完成，没有输出。';
            } catch (error) {
                console.error("[text-viewer] Local Python execution error (in renderer):", error);
                outputContainer.textContent = `本地执行错误：\n${error.toString()}`;
            }
        } else {
        outputContainer.textContent = '错误：viewerAPI.executePythonCode 不可用。';
            console.error('[text-viewer] viewerAPI.executePythonCode is not available.');
        }
        console.log('[text-viewer] Exiting py_penetration_executor.');
    }

    // --- End: Python Executors as requested ---
    async function runPythonCode(code, outputContainer) {
        outputContainer.style.display = 'block';
        const isSandboxMode = document.getElementById('sandbox-toggle').checked;

        if (isSandboxMode) {
            await py_safe_executor(code, outputContainer);
        } else {
            await py_penetration_executor(code, outputContainer);
        }
    }
    // --- End Dual-Mode Python Execution ---

    // Function to strip ANSI escape codes
    function stripAnsi(str) {
        // eslint-disable-next-line no-control-regex
        return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-nqry=><]/g, '');
    }

    function removeBoldMarkersAroundQuotes(text) {
        if (typeof text !== 'string') return text;
        // Remove bold markers that wrap opening quote characters.
        let processedText = text.replace(/\*\*(["“”])/g, '$1');
        // Remove bold markers that wrap closing quote characters.
        processedText = processedText.replace(/(["“”])\*\*/g, '$1');
        return processedText;
    }

    function renderQuotedText(text, currentTheme) {
        const className = currentTheme === 'light' ? 'custom-quote-light' : 'custom-quote-dark';
        // This regex uses alternation. It first tries to match a whole code block.
        // If it matches, the code block is returned unmodified.
        // Otherwise, it tries to match a quoted string and wraps it.
        // This is much more robust than splitting the string.
        return text.replace(/(```[\s\S]*?```)|("([^"]*?)"|“([^”]*?)”|锟斤拷([^锟斤拷]*?)锟斤拷)/g, (match, codeBlock, fullQuote) => {
            // If a code block is matched (group 1), return it as is.
            if (codeBlock) {
                return codeBlock;
            }
            // If a quote is matched (group 2), wrap it in a span.
            if (fullQuote) {
                return `<span class="${className}">${fullQuote}</span>`;
            }
            // Fallback, should not happen with this regex structure
            return match;
        });
    }

    function decodeHtmlEntities(text) {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        return textarea.value;
    }

    function applyBoldFormatting(container) {
        const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            { acceptNode: (node) => {
                // Skip nodes inside code, scripts, styles, links, and special bubbles.
                if (node.parentElement.closest('pre, code, script, style, .vcp-tool-use-bubble, .unistudy-tool-result-bubble, a')) {
                    return NodeFilter.FILTER_REJECT;
                }
                // Only keep nodes that still contain bold markers.
                if (/\*\*/.test(node.nodeValue)) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_SKIP;
            }},
            false
        );

        const nodesToProcess = [];
        // Materialize the node list before mutating the DOM.
        while (walker.nextNode()) {
            nodesToProcess.push(walker.currentNode);
        }

        nodesToProcess.forEach(node => {
            const parent = node.parentElement;
            if (!parent) return;

            const fragment = document.createDocumentFragment();
            // Split text into bold and plain fragments.
            const parts = node.nodeValue.split(/(\*\*.*?\*\*)/g);

            parts.forEach(part => {
                if (part.startsWith('**') && part.endsWith('**')) {
                    const strong = document.createElement('strong');
                    strong.textContent = part.slice(2, -2);
                    fragment.appendChild(strong);
                } else if (part) { // Preserve plain text segments.
                    fragment.appendChild(document.createTextNode(part));
                }
            });
            // Replace the original text node with the processed fragment.
            parent.replaceChild(fragment, node);
        });
    }

    const textContent = params.get('text');
    const windowTitle = params.get('title') || '阅读模式';
    const encoding = params.get('encoding');
    const decodedTitle = decodeURIComponent(windowTitle);

    document.title = decodedTitle;
    document.getElementById('viewer-title-text').textContent = decodedTitle;
    const contentDiv = document.getElementById('textContent');
    
    // --- NEW: Scoped CSS Implementation ---
    const scopeId = generateUniqueId();
    contentDiv.id = scopeId; // Assign the unique ID to the content container
    // --- END Scoped CSS Implementation ---

    const editAllButton = document.getElementById('editAllButton');

    if (editAllButton && contentDiv) {
        let currentEditAllButtonIcon = editAllButton.querySelector('svg');
        const editAllButtonText = editAllButton.querySelector('span');

        const globalEditIconSVGString = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
        const globalDoneIconSVGString = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`;

        editAllButton.addEventListener('click', () => {
            const existingTextarea = document.querySelector('.global-edit-textarea');
            currentEditAllButtonIcon = editAllButton.querySelector('svg');

            if (existingTextarea) {
                originalRawContent = existingTextarea.value;

                const processedContent = preprocessFullContent(originalRawContent);
                const renderedHtml = renderMarkdownToSafeHtml(processedContent, window.marked);
                contentDiv.innerHTML = renderedHtml;
                enhanceRenderedContent(contentDiv);

                existingTextarea.remove();
                contentDiv.style.display = '';
                if (currentEditAllButtonIcon) currentEditAllButtonIcon.outerHTML = globalEditIconSVGString;
                if (editAllButtonText) editAllButtonText.textContent = '编辑源码';
                editAllButton.setAttribute('title', '编辑源码');
            } else {
                contentDiv.style.display = 'none';

                const textarea = document.createElement('textarea');
                textarea.className = 'global-edit-textarea';
                textarea.value = originalRawContent;
                textarea.style.width = '100%';
                textarea.style.minHeight = '70vh';
                textarea.style.boxSizing = 'border-box';
                textarea.style.backgroundColor = 'var(--viewer-code-bg)';
                textarea.style.color = 'var(--viewer-primary-text)';
                textarea.style.border = '1px solid var(--viewer-code-bg-hover)';
                textarea.style.borderRadius = '8px';
                textarea.style.padding = '15px';
                textarea.style.fontFamily = 'var(--font-family-monospace, monospace)';
                textarea.style.lineHeight = '1.5';

                contentDiv.parentNode.insertBefore(textarea, contentDiv.nextSibling);
                textarea.focus();

                textarea.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        editAllButton.click();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        const currentIcon = editAllButton.querySelector('svg');
                        textarea.remove();
                        contentDiv.style.display = '';
                        if (currentIcon) currentIcon.outerHTML = globalEditIconSVGString;
                        if (editAllButtonText) editAllButtonText.textContent = '编辑源码';
                        editAllButton.setAttribute('title', '编辑源码');
                    }
                });

                if (currentEditAllButtonIcon) currentEditAllButtonIcon.outerHTML = globalDoneIconSVGString;
                if (editAllButtonText) editAllButtonText.textContent = '应用修改';
                editAllButton.setAttribute('title', '应用修改');
            }
        });
    }

    async function enhanceRenderedContent(container) {
        // First, fix any broken emoticon URLs
        await fixEmoticonImagesInContainer(container);

        // Style status bubbles based on content
        container.querySelectorAll('.unistudy-tool-result-status').forEach(statusEl => {
            const statusText = statusEl.textContent.toUpperCase();
            if (statusText.includes('SUCCESS')) {
                statusEl.classList.add('status-success');
            } else if (statusText.includes('FAILURE') || statusText.includes('ERROR')) {
                statusEl.classList.add('status-failure');
            }
        });

        const codeBlocksToProcess = [];
        const mermaidBlocksToRender = [];
        const drawioBlocksToRender = [];

        // First pass: Separate Mermaid and Draw.io blocks from regular code blocks
        container.querySelectorAll('pre code').forEach((codeBlock) => {
            const languageClass = Array.from(codeBlock.classList).find(c => c.startsWith('language-'));
            const language = languageClass ? languageClass.replace('language-', '') : '';
            const code = codeBlock.textContent || '';

            const isMermaid = ['mermaid', 'graph', 'flowchart'].includes(language);
            const isDrawio = language === 'drawio' || code.trim().startsWith('<mxfile');

            if (isMermaid) {
                mermaidBlocksToRender.push(codeBlock);
            } else if (isDrawio) {
                drawioBlocksToRender.push(codeBlock);
            } else {
                codeBlocksToProcess.push(codeBlock);
            }
        });

        // --- RENDER MERMAID (ENHANCED) ---
        if (window.mermaid && mermaidBlocksToRender.length > 0) {
            const elementsToRender = [];
            mermaidBlocksToRender.forEach(codeBlock => {
                const preElement = codeBlock.parentElement;
                const mermaidContainer = document.createElement('div');
                mermaidContainer.className = 'mermaid';
                const code = codeBlock.textContent.trim();
                mermaidContainer.textContent = code;
                preElement.parentNode.replaceChild(mermaidContainer, preElement);
                elementsToRender.push(mermaidContainer);
            });

            if (elementsToRender.length > 0) {
                mermaid.run({ nodes: elementsToRender }).catch(error => {
                    console.error("Error rendering Mermaid diagrams:", error);
                    elementsToRender.forEach(el => {
                        const originalCode = el.textContent;
                        el.innerHTML = `<div class="mermaid-error">Mermaid render error: ${error.message}</div><pre>${escapeHtml(originalCode)}</pre>`;
                    });
                });
            }
        }

        // --- RENDER DRAW.IO ---
        if (window.GraphViewer && drawioBlocksToRender.length > 0) {
            drawioBlocksToRender.forEach(codeBlock => {
                const preElement = codeBlock.parentElement;
                const drawioContainer = document.createElement('div');
                // The viewer script looks for the 'mxgraph' class.
                drawioContainer.className = 'mxgraph';
                
                let xmlContent = codeBlock.textContent.trim();
                // Remove HTML comments from the XML content to prevent parsing issues.
                xmlContent = xmlContent.replace(/<!--[\s\S]*?-->/g, '');
                
                // The configuration is passed via a data-mxgraph attribute.
                const config = {
                    "highlight": "#0000ff",
                    "target": "blank",
                    "nav": true,
                    "resize": true,
                    "toolbar": "zoom layers lightbox",
                    "edit": "_blank",
                    "xml": xmlContent
                };
                drawioContainer.setAttribute('data-mxgraph', JSON.stringify(config));
                
                preElement.parentNode.replaceChild(drawioContainer, preElement);
            });
            
            // After creating the elements, we need to tell the viewer to render them.
            // This is a more robust method than relying on automatic rendering.
            try {
                window.GraphViewer.processElements();
            } catch (e) {
                console.error("Draw.io rendering error (processElements):", e);
            }
        }

        // --- PROCESS REGULAR CODE BLOCKS ---
        codeBlocksToProcess.forEach((block) => {
            const preElement = block.parentElement;
            if (!preElement || preElement.querySelector('.copy-button')) return; // Already enhanced or parent gone

            // Step 1: Clean language identifier
            let lines = block.textContent.split('\n');
            if (lines.length > 0) {
                const firstLine = lines[0].trim().toLowerCase();
                if (firstLine === 'python' || firstLine === 'html') {
                    lines.shift();
                    block.textContent = lines.join('\n');
                }
            }

            // Step 2: Apply syntax highlighting
            if (window.hljs) {
                hljs.highlightElement(block);
            }

            // Step 3: Add interactive buttons
            preElement.style.position = 'relative';
            const codeContent = decodeHtmlEntities(block.textContent);
            
            const isHtmlByClass = Array.from(block.classList).some(cls => /^language-html$/i.test(cls));
            const trimmedContent = codeContent.trim().toLowerCase();
            const isHtmlByContent = trimmedContent.startsWith('<!doctype html>') || trimmedContent.startsWith('<html>');
            const isHtml = isHtmlByClass || isHtmlByContent;

            const isPython = Array.from(block.classList).some(cls => /^language-python$/i.test(cls));

            // New check for three.js
            const isThreeJsByClass = Array.from(block.classList).some(cls => /^language-(javascript|js|threejs)$/i.test(cls));
            const isThreeJsByContent = codeContent.includes('THREE.');
            // To avoid conflict with regular HTML that might contain JS.
            // A dedicated threejs block should not be a full html document.
            const isThreeJs = (isThreeJsByClass && isThreeJsByContent) && !isHtml;

            if (isHtml) {
                const playButton = document.createElement('button');
                const playIconSVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
                const codeIconSVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>`;
                playButton.innerHTML = playIconSVG;
                playButton.className = 'play-button';
                    playButton.setAttribute('title', '预览 HTML');
                preElement.appendChild(playButton);

                playButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const existingPreview = preElement.nextElementSibling;
                    if (existingPreview && existingPreview.classList.contains('html-preview-container')) {
                        existingPreview.remove();
                        preElement.style.display = 'block';
                        return;
                    }
                    preElement.style.display = 'none';
                    const previewContainer = document.createElement('div');
                    previewContainer.className = 'html-preview-container';
                    const iframe = document.createElement('iframe');
                    iframe.sandbox = 'allow-scripts allow-same-origin allow-modals';
                    const exitButton = document.createElement('button');
                    exitButton.innerHTML = codeIconSVG + ' 显示代码';
                    exitButton.className = 'exit-preview-button';
                    exitButton.title = '显示代码';
                    exitButton.addEventListener('click', () => {
                        previewContainer.remove();
                        preElement.style.display = 'block';
                    });
                    previewContainer.appendChild(iframe);
                    previewContainer.appendChild(exitButton);
                    preElement.parentNode.insertBefore(previewContainer, preElement.nextSibling);
                    let finalHtml = codeContent;
                    const trimmedCode = codeContent.trim().toLowerCase();
                    if (!trimmedCode.startsWith('<!doctype') && !trimmedCode.startsWith('<html>')) {
                        const bodyStyles = document.body.classList.contains('light-theme')
                            ? 'color: #2c3e50; background-color: #ffffff;'
                            : 'color: #abb2bf; background-color: #282c34;';
                finalHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>HTML 预览</title><script src="../../../vendor/anime.min.js"><\/script><style>body { font-family: sans-serif; padding: 15px; margin: 0; ${bodyStyles} }</style></head><body>${codeContent}</body></html>`;
                    } else {
                        // If it's a full document, inject anime.js before the closing </head> tag
                finalHtml = finalHtml.replace('</head>', '<script src="../../../vendor/anime.min.js"><\/script></head>');
                    }
                    // Use srcdoc for better security and reliability
                    iframe.srcdoc = finalHtml;
                });
            } else if (isPython) {
                const pyPlayButton = document.createElement('button');
                const playIconSVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
                pyPlayButton.innerHTML = playIconSVG;
                pyPlayButton.className = 'play-button';
                    pyPlayButton.setAttribute('title', '运行 Python 代码');
                preElement.appendChild(pyPlayButton);
                const outputContainer = document.createElement('div');
                outputContainer.className = 'python-output-container';
                preElement.parentNode.insertBefore(outputContainer, preElement.nextSibling);
                pyPlayButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (outputContainer.style.display === 'block') {
                        outputContainer.style.display = 'none';
                    } else {
                        const codeToRun = decodeHtmlEntities(block.innerText);
                        runPythonCode(codeToRun, outputContainer);
                    }
                });
            } else if (isThreeJs) {
                const playButton = document.createElement('button');
                const playIconSVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
                const codeIconSVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>`;
                playButton.innerHTML = playIconSVG;
                playButton.className = 'play-button';
                    playButton.setAttribute('title', '预览 3D 场景');
                preElement.appendChild(playButton);

                playButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const existingPreview = preElement.nextElementSibling;
                    if (existingPreview && existingPreview.classList.contains('html-preview-container')) {
                        existingPreview.remove();
                        preElement.style.display = 'block';
                        return;
                    }
                    preElement.style.display = 'none';
                    const previewContainer = document.createElement('div');
                    previewContainer.className = 'html-preview-container';
                    const iframe = document.createElement('iframe');
                    iframe.sandbox = 'allow-scripts allow-same-origin allow-modals';
                    const exitButton = document.createElement('button');
                    exitButton.innerHTML = codeIconSVG + ' 显示代码';
                    exitButton.className = 'exit-preview-button';
                    exitButton.title = '显示代码';
                    exitButton.addEventListener('click', () => {
                        previewContainer.remove();
                        preElement.style.display = 'block';
                    });
                    previewContainer.appendChild(iframe);
                    previewContainer.appendChild(exitButton);
                    preElement.parentNode.insertBefore(previewContainer, preElement.nextSibling);
                    const threeJsHtml = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <title>Three.js 预览</title>
                            <style>
                                body { margin: 0; overflow: hidden; background-color: #000; }
                                canvas { display: block; }
                            </style>
                        </head>
                        <body>
<script src="../../../vendor/three.min.js"><\/script>
                            <script>
                                // Defer execution until three.js is loaded
                                window.addEventListener('load', () => {
                                    try {
${codeContent}
                                    } catch (e) {
                                        document.body.innerHTML = '<div style="color: #ff5555; font-family: sans-serif; padding: 20px;"><h3>脚本运行时发生错误：</h3><pre>' + e.stack + '</pre></div>';
                                    }
                                });
                            <\/script>
                        </body>
                        </html>
                    `;
                    // Use srcdoc for better security and reliability
                    iframe.srcdoc = threeJsHtml;
                });
            }

            const editButton = document.createElement('button');
            const editIconSVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
            const doneIconSVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>`;
            editButton.innerHTML = editIconSVG;
            editButton.className = 'edit-button';
                editButton.setAttribute('title', '编辑');
            editButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const isEditing = block.isContentEditable;
                block.contentEditable = !isEditing;
                if (!isEditing) {
                    block.focus();
                    editButton.innerHTML = doneIconSVG;
                        editButton.setAttribute('title', '应用修改');
                } else {
                    editButton.innerHTML = editIconSVG;
                        editButton.setAttribute('title', '编辑');
                    if (window.hljs) {
                        hljs.highlightElement(block);
                    }
                }
            });
            preElement.appendChild(editButton);

            const copyButton = document.createElement('button');
            copyButton.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
            copyButton.className = 'copy-button';
                copyButton.setAttribute('title', '复制');
            copyButton.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(block.innerText).catch(err => console.error('Failed to copy code block:', err));
            });
            preElement.appendChild(copyButton);
        });

        // --- PROCESS SHADOW DOM ---
        container.querySelectorAll('div > style').forEach(styleTag => {
            const wrapperDiv = styleTag.parentElement;
            if (wrapperDiv.shadowRoot || wrapperDiv.closest('pre, .html-preview-container')) {
                return;
            }
            if (wrapperDiv.parentElement !== container) {
                return;
            }
            try {
                const shadow = wrapperDiv.attachShadow({ mode: 'open' });
                shadow.innerHTML = wrapperDiv.innerHTML;
                wrapperDiv.innerHTML = '';
            } catch (e) {
                console.error('Error creating shadow DOM for rich content:', e);
            }
        });

        // --- RENDER LATEX ---
        if (window.renderMathInElement) {
            try {
                renderMathInElement(container, {
                    delimiters: [
                        {left: "$$", right: "$$", display: true},
                        {left: "$", right: "$", display: false},
                        {left: "\\(", right: "\\)", display: false},
                        {left: "\\[", right: "\\]", display: true}
                    ],
                    throwOnError: false
                });
            } catch (e) {
                console.error("KaTeX rendering error:", e);
            }
        }
        
        // --- Call animation processor after all other enhancements ---
        processAnimationsInContent(container);

        // --- Final formatting pass for bold text ---
        applyBoldFormatting(container);
    }

    /**
     * Waits for all images within a container to finish loading (or erroring).
     * @param {HTMLElement} container The container element to search for images.
     * @returns {Promise<void>} A promise that resolves when all images are settled.
     */
    function waitForImages(container) {
        const images = Array.from(container.querySelectorAll('img'));
        const promises = images.map(img => {
            return new Promise((resolve) => {
                if (img.complete) {
                    resolve();
                } else {
                    img.addEventListener('load', resolve, { once: true });
                    img.addEventListener('error', resolve, { once: true }); // Resolve on error too, so one broken image doesn't block everything.
                }
            });
        });
        return Promise.all(promises);
    }

    // Wrap the main content rendering in an async IIFE to handle all async operations gracefully.
    (async () => {
        if (textContent) {
            try {
                let decodedText;
                if (encoding === 'base64') {
                    try {
                        const binaryString = atob(textContent);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        decodedText = new TextDecoder('utf-8').decode(bytes);
                    } catch (e) {
                        console.error("Base64 decoding failed:", e);
                        decodedText = decodeURIComponent(escape(window.atob(textContent)));
                    }
                } else {
                    decodedText = decodeURIComponent(textContent);
                }
                originalRawContent = decodedText;

                const processedContent = preprocessFullContent(originalRawContent, scopeId);
                const renderedHtml = renderMarkdownToSafeHtml(processedContent, window.marked);
                contentDiv.innerHTML = renderedHtml;

                // Wait for async enhancements (Mermaid, etc.) AND image loading to complete.
                await enhanceRenderedContent(contentDiv);
                await waitForImages(contentDiv);

                // --- Pretext Integration: populate the initial height cache ---
                if (window.pretextBridge && window.pretextBridge.isReady()) {
                    const containerWidth = contentDiv.clientWidth;
                    // Use scopeId as the cache key so resize recalculation can reuse it.
                    window.pretextBridge.estimateHeight(scopeId, originalRawContent, 'viewer', containerWidth);
                    console.log('[TextViewer] Pretext height cache populated for scope:', scopeId);
                }

                // --- FIX for scroll height race condition ---
                // After ALL dynamic content has loaded and rendered, force a reflow
                // using a more reliable requestAnimationFrame-based approach.
                const originalOverflow = document.body.style.overflowY || 'auto';
                document.body.style.overflowY = 'hidden';
                requestAnimationFrame(() => {
                    // This nested rAF ensures the 'hidden' style has been applied and flushed by the browser.
                    requestAnimationFrame(() => {
                        document.body.style.overflowY = originalOverflow;
                    });
                });

            } catch (error) {
                console.error("Error rendering content:", error);
                contentDiv.innerHTML = `
                    <h3 style="color: #e06c75;">Render Error</h3>
                    <p>查看器无法渲染这段内容，下面保留原始文本以便排查。</p>
                    <p><strong>错误详情：</strong></p>
                    <pre style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(error.toString())}</pre>
                    <p><strong>原始内容：</strong></p>
                    <pre style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(textContent)}</pre>
                `;
            }
        } else {
        contentDiv.textContent = '未提供可显示的内容。';
        }
    })();

    // Custom Context Menu Logic
    const contextMenu = document.getElementById('customContextMenu');
    const contextMenuCopyButton = document.getElementById('contextMenuCopy');
    const contextMenuCutButton = document.getElementById('contextMenuCut');
    const contextMenuDeleteButton = document.getElementById('contextMenuDelete');
    const contextMenuEditAllButton = document.getElementById('contextMenuEditAll');
    const contextMenuCopyAllButton = document.getElementById('contextMenuCopyAll');
    const contextMenuShareScreenshotButton = document.getElementById('contextMenuShareScreenshot');
    const mainContentDiv = contentDiv;
 
     if (contextMenu && contextMenuCopyButton && contextMenuCutButton && contextMenuDeleteButton && contextMenuEditAllButton && contextMenuCopyAllButton && contextMenuShareScreenshotButton && mainContentDiv) {
        document.addEventListener('contextmenu', (event) => {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();

            event.preventDefault();

            contextMenu.style.top = `${event.pageY}px`;
            contextMenu.style.left = `${event.pageX}px`;
            contextMenu.style.display = 'block';

            if (selectedText) {
                contextMenuCopyButton.style.display = 'block';
                contextMenuCutButton.style.display = 'block';
                contextMenuDeleteButton.style.display = 'block';
                contextMenuEditAllButton.style.display = 'none';
                contextMenuCopyAllButton.style.display = 'none';
                contextMenuShareScreenshotButton.style.display = 'none';
            } else {
                contextMenuCopyButton.style.display = 'none';
                contextMenuCutButton.style.display = 'none';
                contextMenuDeleteButton.style.display = 'none';
                contextMenuEditAllButton.style.display = 'block';
                contextMenuCopyAllButton.style.display = 'block';
                contextMenuShareScreenshotButton.style.display = 'block';
            }

            let isAnyEditableContext = mainContentDiv.isContentEditable;
            const targetElement = event.target;
            const closestCodeBlock = targetElement.closest('code.hljs');

            if (!isAnyEditableContext && closestCodeBlock && closestCodeBlock.isContentEditable) {
                isAnyEditableContext = true;
            }

            if (selectedText) {
                contextMenuCutButton.style.display = isAnyEditableContext ? 'block' : 'none';
                contextMenuDeleteButton.style.display = isAnyEditableContext ? 'block' : 'none';
            }
        });

        document.addEventListener('click', (event) => {
            if (contextMenu.style.display === 'block' && !contextMenu.contains(event.target)) {
                contextMenu.style.display = 'none';
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                contextMenu.style.display = 'none';
            }
        });

        contextMenuCopyButton.addEventListener('click', () => {
            const selectedText = window.getSelection().toString();
            if (selectedText) {
                navigator.clipboard.writeText(selectedText).then(() => {
                    console.log('Copied selected text.');
                }).catch(err => {
                    console.error('Failed to copy selected text:', err);
                });
            }
            contextMenu.style.display = 'none';
        });

        contextMenuCutButton.addEventListener('click', () => {
            const selection = window.getSelection();
            const selectedText = selection.toString();
            
            let canPerformEdit = mainContentDiv.isContentEditable;
            const activeCodeBlock = document.activeElement && document.activeElement.closest('code.hljs') && document.activeElement.isContentEditable;
            if (!canPerformEdit && activeCodeBlock) {
                canPerformEdit = true;
            }

            if (selectedText && canPerformEdit) {
                navigator.clipboard.writeText(selectedText).then(() => {
                    document.execCommand('delete', false, null);
                    console.log('Cut selected text.');
                }).catch(err => {
                    console.error('Failed to cut selected text:', err);
                });
            }
            contextMenu.style.display = 'none';
        });

        contextMenuDeleteButton.addEventListener('click', () => {
            const selection = window.getSelection();
            let canPerformEdit = mainContentDiv.isContentEditable;
            const activeCodeBlock = document.activeElement && document.activeElement.closest('code.hljs') && document.activeElement.isContentEditable;
            if (!canPerformEdit && activeCodeBlock) {
                canPerformEdit = true;
            }

            if (selection.toString() && canPerformEdit) {
                document.execCommand('delete', false, null);
                console.log('Deleted selected text.');
            }
            contextMenu.style.display = 'none';
        });

        contextMenuEditAllButton.addEventListener('click', () => {
            editAllButton.click();
            contextMenu.style.display = 'none';
        });

        contextMenuCopyAllButton.addEventListener('click', () => {
            const fullText = mainContentDiv.innerText;
            navigator.clipboard.writeText(fullText).then(() => {
                console.log('Copied full text.');
            }).catch(err => {
                console.error('Failed to copy full text:', err);
            });
            contextMenu.style.display = 'none';
        });
 
         contextMenuShareScreenshotButton.addEventListener('click', () => {
            contextMenu.style.display = 'none';
            if (window.html2canvas && mainContentDiv) {
                html2canvas(mainContentDiv, {
                    useCORS: true,
                    backgroundColor: window.getComputedStyle(document.body).backgroundColor,
                    onclone: (clonedDoc) => {
                        if (document.body.classList.contains('light-theme')) {
                            clonedDoc.body.classList.add('light-theme');
                        }
                        clonedDoc.body.style.backgroundColor = window.getComputedStyle(document.body).backgroundColor;

                        clonedDoc.querySelectorAll('*').forEach(el => {
                            const style = window.getComputedStyle(el);
                            if (style.display === 'flex') {
                                Array.from(el.childNodes).forEach(child => {
                                    if (child.nodeType === 3 && child.textContent.trim().length > 0) {
                                        const span = clonedDoc.createElement('span');
                                        span.textContent = child.textContent;
                                        el.replaceChild(span, child);
                                    }
                                });
                            }
                        });
                    }
                }).then(canvas => {
                    const imageDataUrl = canvas.toDataURL('image/png');
                    if (viewerAPI && viewerAPI.openImageViewer) {
                        viewerAPI.openImageViewer({
                            src: imageDataUrl,
                            title: 'Screenshot Preview',
                        });
                    } else {
                        console.error('viewerAPI.openImageViewer is not available.');
                        alert('Screenshot preview is not available.');
                    }
                }).catch(err => {
                    console.error('Error generating screenshot:', err);
                    alert('Failed to generate screenshot.');
                });
            }
        });
    }
    
    // Add keyboard listener for Escape key to close the window
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (viewerAPI?.closeWindow) {
                viewerAPI.closeWindow();
            } else {
                window.close();
            }
        }
    });

    // --- Custom Title Bar Listeners ---
    const minimizeBtn = document.getElementById('minimize-viewer-btn');
    const maximizeBtn = document.getElementById('maximize-viewer-btn');
    const closeBtn = document.getElementById('close-viewer-btn');

    if (minimizeBtn && maximizeBtn && closeBtn) {
        minimizeBtn.addEventListener('click', () => {
            if (viewerAPI) viewerAPI.minimizeWindow();
        });

        maximizeBtn.addEventListener('click', () => {
            if (viewerAPI) viewerAPI.maximizeWindow();
        });

        closeBtn.addEventListener('click', () => {
            if (viewerAPI?.closeWindow) {
                viewerAPI.closeWindow();
            } else {
                window.close();
            }
        });
    }

    // --- Pretext Integration: refresh cached layout on resize ---
    window.addEventListener('resize', () => {
        if (window.pretextBridge && window.pretextBridge.isReady() && scopeId) {
            const containerWidth = contentDiv.clientWidth;
            const updates = window.pretextBridge.recalculateAll(containerWidth);
            if (updates.has(scopeId)) {
                console.log('[TextViewer] Pretext layout recalculated. New height:', updates.get(scopeId));
                // Layout is refreshed in the cache; defer DOM updates to later render passes.
            }
        }
    });
});
