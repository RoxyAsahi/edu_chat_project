document.addEventListener('DOMContentLoaded', async () => {
    const viewerAPI = window.utilityAPI || window.electronAPI;

    const imgElement = document.getElementById('viewerImage');
    const errorDiv = document.getElementById('errorMessage');
    const imageControls = document.getElementById('imageControls');
    const copyButton = document.getElementById('copyButton');
    const downloadButton = document.getElementById('downloadButton');
    const saveEditedButton = document.getElementById('saveEditedButton');
    const canvas = document.getElementById('drawingCanvas');
    const ctx = canvas.getContext('2d');
    const imageContainer = document.getElementById('imageContainer');
    const toolbar = document.getElementById('toolbar');
    const colorPicker = document.getElementById('colorPicker');
    const colorCodeDisplay = document.getElementById('colorCodeDisplay');
    const brushSize = document.getElementById('brushSize');
    const brushPreview = document.getElementById('brushPreview');
    const selectTool = document.getElementById('selectTool');
    const brushTool = document.getElementById('brushTool');
    const eraserTool = document.getElementById('eraserTool');
    const eyedropperTool = document.getElementById('eyedropperTool');
    const lineTool = document.getElementById('lineTool');
    const rectTool = document.getElementById('rectTool');
    const circleTool = document.getElementById('circleTool');
    const arrowTool = document.getElementById('arrowTool');
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const clearBtn = document.getElementById('clearBtn');

    const ocrButton = document.getElementById('ocrButton');
    const ocrResultModal = document.getElementById('ocrResultModal');
    const ocrModalClose = document.getElementById('ocrModalClose');
    const ocrResultText = document.getElementById('ocrResultText');
    const copyOcrText = document.getElementById('copyOcrText');

    let currentTool = 'select';
    let isDrawing = false;
    let startX = 0;
    let startY = 0;
    let currentColor = '#498094';
    let currentBrushSize = 5;
    let history = [];
    let historyStep = -1;
    const maxHistory = 50;

    let currentScale = 1;
    const minScale = 0.2;
    const maxScale = 5;
    let isDragging = false;
    let imgInitialX = 0;
    let imgInitialY = 0;

    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    const imageCanvas = document.createElement('canvas');
    const imageCtx = imageCanvas.getContext('2d', { willReadFrequently: true });

    function safeDecodeURIComponent(value, fallback = '') {
        if (typeof value !== 'string' || value.length === 0) {
            return fallback;
        }

        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    }

    function applyTheme(theme) {
        document.body.classList.toggle('light-theme', theme === 'light');
    }

    const params = new URLSearchParams(window.location.search);
    const imageUrl = params.get('src');
    const imageTitle = params.get('title') || '图片预览';
    const initialTheme = params.get('theme') || 'dark';
    const decodedTitle = safeDecodeURIComponent(imageTitle, '图片预览');

    applyTheme(initialTheme);

    if (viewerAPI?.onThemeUpdated) {
        viewerAPI.onThemeUpdated(applyTheme);
    }

    document.title = decodedTitle;
    document.getElementById('image-title-text').textContent = decodedTitle;

    function saveToHistory() {
        historyStep += 1;
        if (historyStep < history.length) {
            history.length = historyStep;
        }
        history.push(canvas.toDataURL());
        if (history.length > maxHistory) {
            history.shift();
            historyStep -= 1;
        }
    }

    function loadFromHistory(step) {
        if (step < 0 || step >= history.length) {
            return;
        }

        const snapshot = new Image();
        snapshot.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(snapshot, 0, 0);
        };
        snapshot.src = history[step];
    }

    function getCanvasCoordinates(event) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY,
        };
    }

    function setTool(tool) {
        currentTool = tool;

        document.querySelectorAll('.tool-btn').forEach((button) => button.classList.remove('active'));
        const toolButtons = {
            select: selectTool,
            brush: brushTool,
            eraser: eraserTool,
            eyedropper: eyedropperTool,
            line: lineTool,
            rect: rectTool,
            circle: circleTool,
            arrow: arrowTool,
        };

        if (toolButtons[tool]) {
            toolButtons[tool].classList.add('active');
        }

        if (tool === 'select') {
            canvas.classList.remove('active');
            canvas.style.cursor = 'default';
        } else {
            canvas.classList.add('active');
            canvas.style.cursor = 'crosshair';
        }
    }

    function drawArrow(targetCtx, fromX, fromY, toX, toY) {
        const headLength = 15 * (currentBrushSize / 5);
        const angle = Math.atan2(toY - fromY, toX - fromX);

        targetCtx.beginPath();
        targetCtx.moveTo(fromX, fromY);
        targetCtx.lineTo(toX, toY);
        targetCtx.stroke();

        targetCtx.beginPath();
        targetCtx.moveTo(toX, toY);
        targetCtx.lineTo(
            toX - headLength * Math.cos(angle - Math.PI / 6),
            toY - headLength * Math.sin(angle - Math.PI / 6)
        );
        targetCtx.moveTo(toX, toY);
        targetCtx.lineTo(
            toX - headLength * Math.cos(angle + Math.PI / 6),
            toY - headLength * Math.sin(angle + Math.PI / 6)
        );
        targetCtx.stroke();
    }

    function getColorAtPoint(x, y) {
        if (!imageCanvas.width || !imageCanvas.height) {
            return '#000000';
        }

        const clampedX = Math.max(0, Math.min(Math.floor(x), imageCanvas.width - 1));
        const clampedY = Math.max(0, Math.min(Math.floor(y), imageCanvas.height - 1));
        const imageData = imageCtx.getImageData(clampedX, clampedY, 1, 1);
        const pixel = imageData.data;

        if (pixel[3] === 0) {
            return currentColor;
        }

        return `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1)}`;
    }

    function startDrawing(event) {
        if (currentTool === 'select') {
            return;
        }

        isDrawing = true;
        const coords = getCanvasCoordinates(event);
        startX = coords.x;
        startY = coords.y;

        if (currentTool === 'eyedropper') {
            const color = getColorAtPoint(startX, startY);
            currentColor = color;
            colorPicker.value = color;
            colorCodeDisplay.textContent = color.toUpperCase();
            setTool('brush');
            return;
        }

        if (currentTool === 'brush' || currentTool === 'eraser') {
            ctx.beginPath();
            ctx.moveTo(startX, startY);
        }

        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        tempCtx.drawImage(canvas, 0, 0);
    }

    function draw(event) {
        if (!isDrawing || currentTool === 'select' || currentTool === 'eyedropper') {
            return;
        }

        const coords = getCanvasCoordinates(event);
        const currentX = coords.x;
        const currentY = coords.y;

        if (currentTool === 'brush' || currentTool === 'eraser') {
            ctx.lineTo(currentX, currentY);
            ctx.strokeStyle = currentTool === 'eraser' ? '#FFFFFF' : currentColor;
            ctx.lineWidth = currentBrushSize;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.globalCompositeOperation = currentTool === 'eraser' ? 'destination-out' : 'source-over';
            ctx.stroke();
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tempCanvas, 0, 0);
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = currentBrushSize;
        ctx.lineCap = 'round';
        ctx.globalCompositeOperation = 'source-over';

        switch (currentTool) {
            case 'line':
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(currentX, currentY);
                ctx.stroke();
                break;
            case 'rect':
                ctx.strokeRect(startX, startY, currentX - startX, currentY - startY);
                break;
            case 'circle': {
                const radius = Math.sqrt((currentX - startX) ** 2 + (currentY - startY) ** 2);
                ctx.beginPath();
                ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
                ctx.stroke();
                break;
            }
            case 'arrow':
                drawArrow(ctx, startX, startY, currentX, currentY);
                break;
            default:
                break;
        }
    }

    function stopDrawing() {
        if (isDrawing && currentTool !== 'select' && currentTool !== 'eyedropper') {
            saveToHistory();
        }
        isDrawing = false;
        ctx.beginPath();
    }

    function syncBrushPreview() {
        brushPreview.style.width = `${currentBrushSize}px`;
        brushPreview.style.height = `${currentBrushSize}px`;
        brushPreview.style.backgroundColor = currentColor;
        colorCodeDisplay.textContent = currentColor.toUpperCase();
    }

    function updateTransform() {
        imageContainer.style.transform = `translate(${imgInitialX}px, ${imgInitialY}px) scale(${currentScale})`;

        if (currentScale > 1) {
            imgElement.style.cursor = 'grab';
            return;
        }

        imgElement.style.cursor = 'default';
        imgInitialX = 0;
        imgInitialY = 0;
        imageContainer.style.transform = `scale(${currentScale})`;
    }

    async function buildMergedImageBlob() {
        const mergedCanvas = document.createElement('canvas');
        mergedCanvas.width = imgElement.naturalWidth;
        mergedCanvas.height = imgElement.naturalHeight;
        const mergedCtx = mergedCanvas.getContext('2d');
        mergedCtx.drawImage(imgElement, 0, 0);
        mergedCtx.drawImage(canvas, 0, 0);

        return await new Promise((resolve, reject) => {
            mergedCanvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                    return;
                }
                reject(new Error('Failed to create merged image blob.'));
            }, 'image/png');
        });
    }

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    selectTool.addEventListener('click', () => setTool('select'));
    brushTool.addEventListener('click', () => setTool('brush'));
    eraserTool.addEventListener('click', () => setTool('eraser'));
    eyedropperTool.addEventListener('click', () => setTool('eyedropper'));
    lineTool.addEventListener('click', () => setTool('line'));
    rectTool.addEventListener('click', () => setTool('rect'));
    circleTool.addEventListener('click', () => setTool('circle'));
    arrowTool.addEventListener('click', () => setTool('arrow'));

    colorPicker.addEventListener('input', (event) => {
        currentColor = event.target.value;
        syncBrushPreview();
    });

    brushSize.addEventListener('input', (event) => {
        currentBrushSize = Number.parseInt(event.target.value, 10);
        syncBrushPreview();
    });

    syncBrushPreview();

    colorCodeDisplay.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(currentColor);
            const originalText = colorCodeDisplay.textContent;
            colorCodeDisplay.textContent = '已复制';
            setTimeout(() => {
                colorCodeDisplay.textContent = originalText;
            }, 1000);
        } catch (error) {
            console.error('Failed to copy color code:', error);
        }
    });

    undoBtn.addEventListener('click', () => {
        if (historyStep > 0) {
            historyStep -= 1;
            loadFromHistory(historyStep);
        }
    });

    redoBtn.addEventListener('click', () => {
        if (historyStep < history.length - 1) {
            historyStep += 1;
            loadFromHistory(historyStep);
        }
    });

    clearBtn.addEventListener('click', () => {
        if (!confirm('确定要清除所有绘图吗？')) {
            return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        saveToHistory();
    });

    if (imageUrl) {
        const decodedImageUrl = safeDecodeURIComponent(imageUrl, imageUrl);
        console.log('Image viewer loading image:', decodedImageUrl);
        imgElement.src = decodedImageUrl;

        imgElement.onload = () => {
            console.log('Image viewer image loaded successfully.');
            imgElement.style.display = 'block';
            imageControls.style.display = 'flex';
            errorDiv.style.display = 'none';

            canvas.width = imgElement.naturalWidth;
            canvas.height = imgElement.naturalHeight;
            canvas.style.width = `${imgElement.offsetWidth}px`;
            canvas.style.height = `${imgElement.offsetHeight}px`;

            imageCanvas.width = imgElement.naturalWidth;
            imageCanvas.height = imgElement.naturalHeight;
            imageCtx.drawImage(imgElement, 0, 0, imgElement.naturalWidth, imgElement.naturalHeight);

            saveToHistory();
            setTool('select');

            imageContainer.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                toolbar.classList.toggle('hidden');
                imageControls.classList.toggle('active');
            });

            imgElement.addEventListener('wheel', (event) => {
                if (!event.ctrlKey || currentTool !== 'select') {
                    return;
                }

                event.preventDefault();
                const scaleAmount = 0.1;
                const previousScale = currentScale;
                currentScale = event.deltaY < 0
                    ? Math.min(maxScale, previousScale + scaleAmount)
                    : Math.max(minScale, previousScale - scaleAmount);

                if (currentScale !== previousScale) {
                    updateTransform();
                }
            }, { passive: false });

            let dragStartX = 0;
            let dragStartY = 0;
            imgElement.addEventListener('mousedown', (event) => {
                if (event.button !== 0 || currentScale <= 1 || currentTool !== 'select') {
                    return;
                }
                isDragging = true;
                dragStartX = event.clientX;
                dragStartY = event.clientY;
                imgElement.style.cursor = 'grabbing';
                event.preventDefault();
            });

            document.addEventListener('mousemove', (event) => {
                if (!isDragging || currentTool !== 'select') {
                    return;
                }
                const dx = event.clientX - dragStartX;
                const dy = event.clientY - dragStartY;
                imgInitialX += dx;
                imgInitialY += dy;
                dragStartX = event.clientX;
                dragStartY = event.clientY;
                updateTransform();
            });

            document.addEventListener('mouseup', (event) => {
                if (event.button !== 0 || !isDragging) {
                    return;
                }
                isDragging = false;
                imgElement.style.cursor = currentScale > 1 ? 'grab' : 'default';
            });
        };

        imgElement.onerror = () => {
            console.error('Image viewer failed to load image.');
            imgElement.style.display = 'none';
            imageControls.style.display = 'none';
            errorDiv.textContent = `无法加载图片：${decodedTitle}`;
            errorDiv.style.display = 'block';
        };
    } else {
        errorDiv.textContent = '未提供图片 URL。';
        errorDiv.style.display = 'block';
    }

    saveEditedButton.addEventListener('click', async () => {
        try {
            const blob = await buildMergedImageBlob();
            const item = new ClipboardItem({ 'image/png': blob });
            await navigator.clipboard.write([item]);

            const originalHtml = saveEditedButton.innerHTML;
            saveEditedButton.innerHTML = '<svg viewBox="0 0 24 24" style="width:18px; height:18px; fill:currentColor;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg> 已保存';
            setTimeout(() => {
                saveEditedButton.innerHTML = originalHtml;
            }, 2000);
        } catch (error) {
            console.error('Failed to save edited image:', error);
        }
    });

    copyButton.addEventListener('click', async () => {
        if (!imgElement.src) {
            return;
        }

        const originalHtml = copyButton.innerHTML;
        try {
            const blob = await buildMergedImageBlob();
            const item = new ClipboardItem({ 'image/png': blob });
            await navigator.clipboard.write([item]);
            copyButton.innerHTML = '<svg viewBox="0 0 24 24" style="width:18px; height:18px; fill:currentColor;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg> 已复制';
            setTimeout(() => {
                copyButton.innerHTML = originalHtml;
            }, 2000);
        } catch (error) {
            console.error('Failed to copy edited image:', error);
            copyButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"></path></svg> 复制失败';
            setTimeout(() => {
                copyButton.innerHTML = originalHtml;
            }, 2000);
        }
    });

    downloadButton.addEventListener('click', async () => {
        if (!imgElement.src) {
            return;
        }

        try {
            const blob = await buildMergedImageBlob();
            const downloadUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = decodedTitle || 'image.png';
            link.click();
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        } catch (error) {
            console.error('Failed to download edited image:', error);
        }
    });

    ocrButton.addEventListener('click', async () => {
        if (!imgElement.src) {
            return;
        }

        const originalHtml = ocrButton.innerHTML;
        ocrButton.innerHTML = '识别中...';
        ocrButton.disabled = true;

        try {
            const result = await Tesseract.recognize(imgElement.src, 'chi_sim+eng', {
                logger: (message) => {
                    console.log(message);
                    if (message.status === 'recognizing text') {
                        const progress = (message.progress * 100).toFixed(0);
                        ocrButton.innerHTML = `识别中 ${progress}%`;
                    }
                },
            });

            const cleanedText = result.data.text.replace(/ /g, '').replace(/\n{2,}/g, '\n');
            ocrResultText.value = cleanedText;
            ocrResultModal.style.display = 'block';
        } catch (error) {
            console.error('OCR failed:', error);
            ocrResultText.value = `文字识别失败：${error.message}`;
            ocrResultModal.style.display = 'block';
        } finally {
            ocrButton.innerHTML = originalHtml;
            ocrButton.disabled = false;
        }
    });

    ocrModalClose.addEventListener('click', () => {
        ocrResultModal.style.display = 'none';
    });

    window.addEventListener('click', (event) => {
        if (event.target === ocrResultModal) {
            ocrResultModal.style.display = 'none';
        }
    });

    copyOcrText.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(ocrResultText.value);
            const originalText = copyOcrText.textContent;
            copyOcrText.textContent = '已复制';
            setTimeout(() => {
                copyOcrText.textContent = originalText;
            }, 2000);
        } catch (error) {
            console.error('Failed to copy OCR text:', error);
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (currentTool !== 'select') {
                setTool('select');
            } else if (viewerAPI?.closeWindow) {
                viewerAPI.closeWindow();
            } else {
                window.close();
            }
        }

        if (event.ctrlKey && event.key === 'z' && !event.shiftKey) {
            event.preventDefault();
            undoBtn.click();
        }

        if ((event.ctrlKey && event.shiftKey && event.key === 'z') || (event.ctrlKey && event.key === 'y')) {
            event.preventDefault();
            redoBtn.click();
        }

        if (event.ctrlKey || event.shiftKey || event.altKey) {
            return;
        }

        switch (event.key.toLowerCase()) {
            case 'v':
                setTool('select');
                break;
            case 'b':
                setTool('brush');
                break;
            case 'e':
                setTool('eraser');
                break;
            case 'i':
                setTool('eyedropper');
                break;
            case 'l':
                setTool('line');
                break;
            case 'r':
                setTool('rect');
                break;
            case 'c':
                setTool('circle');
                break;
            case 'a':
                setTool('arrow');
                break;
            default:
                break;
        }
    });

    document.getElementById('minimize-viewer-btn').addEventListener('click', () => {
        if (viewerAPI?.minimizeWindow) {
            viewerAPI.minimizeWindow();
        }
    });

    document.getElementById('maximize-viewer-btn').addEventListener('click', () => {
        if (viewerAPI?.maximizeWindow) {
            viewerAPI.maximizeWindow();
        }
    });

    document.getElementById('close-viewer-btn').addEventListener('click', () => {
        if (viewerAPI?.closeWindow) {
            viewerAPI.closeWindow();
            return;
        }
        window.close();
    });

    function updateToolbarLayout() {
        const stackableSections = document.querySelectorAll('.stackable');
        const windowHeight = window.innerHeight;
        stackableSections.forEach((section) => section.classList.remove('stacked'));

        const unstackedHeight = toolbar.offsetHeight;
        if (unstackedHeight > windowHeight * 0.95) {
            stackableSections.forEach((section) => section.classList.add('stacked'));
        }
    }

    window.addEventListener('resize', updateToolbarLayout);
    imgElement.addEventListener('load', updateToolbarLayout);
    updateToolbarLayout();
});