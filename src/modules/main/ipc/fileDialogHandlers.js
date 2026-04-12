// modules/ipc/fileDialogHandlers.js
const { ipcMain, dialog, shell, clipboard, net, nativeImage, BrowserWindow, Menu, app } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const fileManager = require('../fileManager');
const { PRELOAD_ROLES, resolveAppPreload } = require('../services/preloadPaths');
// sharp is now lazy-loaded

/**
 * Initializes file and dialog related IPC handlers.
 * @param {BrowserWindow} mainWindow The main window instance.
 * @param {object} context - An object containing necessary context.
 * @param {function} context.getSelectionListenerStatus - Function to get the current status of the selection listener.
 * @param {function} context.stopSelectionListener - Function to stop the selection listener.
 * @param {function} context.startSelectionListener - Function to start the selection listener.
 * @param {Array<BrowserWindow>} context.openChildWindows - Array of open child windows.
 */
let ipcHandlersRegistered = false;

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function resolveMainWindowGetter(mainWindow, context) {
    if (typeof context?.getMainWindow === 'function') {
        return context.getMainWindow;
    }

    if (typeof mainWindow === 'function') {
        return mainWindow;
    }

    return () => mainWindow || null;
}

function resolveChildWindowsGetter(context) {
    if (typeof context?.getOpenChildWindows === 'function') {
        return context.getOpenChildWindows;
    }

    return () => context?.openChildWindows || [];
}

function removeChildWindow(openChildWindows, childWindow) {
    if (!Array.isArray(openChildWindows)) {
        return;
    }

    const index = openChildWindows.indexOf(childWindow);
    if (index !== -1) {
        openChildWindows.splice(index, 1);
    }
}

function initialize(mainWindow, context) {
    const getMainWindow = resolveMainWindowGetter(mainWindow, context);
    const getOpenChildWindows = resolveChildWindowsGetter(context);
    const appRoot = app.getAppPath();
    const iconPath = path.join(appRoot, 'src', 'assets', 'icon.png');
    const imageViewerPath = path.join(appRoot, 'src', 'modules', 'renderer', 'image-viewer.html');
    const textViewerPath = path.join(appRoot, 'src', 'modules', 'renderer', 'text-viewer.html');

    if (ipcHandlersRegistered) {
        return;
    }

    ipcMain.handle('select-avatar', async () => {
        const listenerWasActive = context.getSelectionListenerStatus();
        if (listenerWasActive) {
            context.stopSelectionListener();
            console.log('[Main] Temporarily stopped selection listener for avatar dialog.');
        }

        const result = await dialog.showOpenDialog(getMainWindow(), {
            title: '选择头像文件',
            properties: ['openFile'],
            filters: [
                { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif'] }
            ]
        });

        if (listenerWasActive) {
            context.startSelectionListener();
            console.log('[Main] Restarted selection listener after avatar dialog.');
        }

        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });

    ipcMain.handle('read-image-from-clipboard-main', async () => {
        console.log('[Main Process] Received request to read image from clipboard.');
        try {
            const nativeImg = clipboard.readImage();
            if (nativeImg && !nativeImg.isEmpty()) {
                console.log('[Main Process] NativeImage is not empty.');
                const buffer = nativeImg.toPNG();
                if (buffer && buffer.length > 0) {
                    console.log('[Main Process] Conversion to PNG successful.');
                    return { success: true, data: buffer.toString('base64'), extension: 'png' };
                } else {
                    console.warn('[Main Process] Conversion to PNG resulted in empty buffer.');
                    return { success: false, error: 'Conversion to PNG resulted in empty buffer.' };
                }
            } else if (nativeImg && nativeImg.isEmpty()) {
                console.warn('[Main Process] NativeImage is empty. No image on clipboard or unsupported format.');
                return { success: false, error: 'No image on clipboard or unsupported format.' };
            } else {
                console.warn('[Main Process] clipboard.readImage() returned null or undefined.');
                return { success: false, error: 'Failed to read image from clipboard (readImage returned null/undefined).' };
            }
        } catch (error) {
            console.error('[Main Process] Error reading image from clipboard:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('read-text-from-clipboard-main', async () => {
        console.log('[Main Process] Received request to read text from clipboard.');
        try {
            const text = clipboard.readText();
            return { success: true, text: text };
        } catch (error) {
            console.error('[Main Process] Error reading text from clipboard:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-text-content', async (event, filePath, fileType) => {
        try {
            return await fileManager.getTextContent(filePath, fileType);
        } catch (error) {
            console.error(`[Main Process] Error reading text content for ${filePath}:`, error);
            throw error;
        }
    });

    ipcMain.handle('get-file-as-base64', async (event, filePath) => {
        try {
            console.log(`[Main - get-file-as-base64] ===== REQUEST START ===== Received raw filePath: "${filePath}"`);
            if (!filePath || typeof filePath !== 'string') {
                console.error('[Main - get-file-as-base64] Invalid file path received:', filePath);
                return { success: false, error: 'Invalid file path provided.' };
            }
    
            const cleanPath = filePath.startsWith('file://') ? decodeURIComponent(filePath.substring(7)) : decodeURIComponent(filePath);
            console.log(`[Main - get-file-as-base64] Cleaned path: "${cleanPath}"`);
    
            if (!await fs.pathExists(cleanPath)) {
                console.error(`[Main - get-file-as-base64] File not found at path: ${cleanPath}`);
                return { success: false, error: `File not found at path: ${cleanPath}` };
            }
    
            let originalFileBuffer = await fs.readFile(cleanPath);
            const fileExtension = path.extname(cleanPath).toLowerCase();
            const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.svg'].includes(fileExtension);
    
            if (isImage) {
                const MAX_DIMENSION = 800;
                const JPEG_QUALITY = 70;
    
                // Special handling for GIFs
                if (fileExtension === '.gif') {
                    console.log('[Main Sharp] GIF detected. Starting frame extraction.');
                    try {
                        const sharp = require('sharp'); // Lazy load
                        const image = sharp(originalFileBuffer, { animated: true });
                        const metadata = await image.metadata();
                        const frameDelays = metadata.delay || [];
                        const totalFrames = metadata.pages || 1;
                        
                        console.log(`[Main Sharp] GIF Info: ${totalFrames} frames, delays available: ${frameDelays.length > 0}`);
    
                        const frameBase64s = [];
                        let accumulatedDelay = 0;
                        const targetInterval = 500; // 0.5 seconds in ms
    
                        for (let i = 0; i < totalFrames; i++) {
                            if (i === 0 || accumulatedDelay >= targetInterval) {
                                console.log(`[Main Sharp] Extracting frame ${i} (Accumulated delay: ${accumulatedDelay}ms)`);
                                
                                const sharp = require('sharp'); // Lazy load
                                const frameBuffer = await sharp(originalFileBuffer, { page: i })
                                    .resize({
                                        width: MAX_DIMENSION,
                                        height: MAX_DIMENSION,
                                        fit: sharp.fit.inside,
                                        withoutEnlargement: true
                                    })
                                    .jpeg({ quality: JPEG_QUALITY })
                                    .toBuffer();
                                
                                frameBase64s.push(frameBuffer.toString('base64'));
                                accumulatedDelay = 0; // Reset delay
                            }
                            
                            if (frameDelays[i] !== undefined) {
                                accumulatedDelay += (frameDelays[i] > 0 ? frameDelays[i] : 100);
                            } else if (totalFrames > 1) {
                                accumulatedDelay += 100; // Default delay
                            }
                        }
                        
                        if (frameBase64s.length === 0 && totalFrames > 0) {
                             const sharp = require('sharp'); // Lazy load
                             const frameBuffer = await sharp(originalFileBuffer, { page: 0 })
                                .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: sharp.fit.inside, withoutEnlargement: true })
                                .jpeg({ quality: JPEG_QUALITY })
                                .toBuffer();
                            frameBase64s.push(frameBuffer.toString('base64'));
                        }
    
                        console.log(`[Main Sharp] Extracted ${frameBase64s.length} frames from GIF.`);
                        console.log(`[Main - get-file-as-base64] ===== REQUEST END (SUCCESS - GIF) =====`);
                        return { success: true, base64Frames: frameBase64s, isGif: true };
    
                    } catch (sharpError) {
                        console.error(`[Main Sharp] Error processing animated GIF: ${sharpError.message}. Falling back to single frame.`, sharpError);
                        const sharp = require('sharp'); // Lazy load
                        const fallbackBuffer = await sharp(originalFileBuffer)
                            .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: sharp.fit.inside, withoutEnlargement: true })
                            .jpeg({ quality: JPEG_QUALITY }).toBuffer();
                        return { success: true, base64Frames: [fallbackBuffer.toString('base64')], isGif: false };
                    }
                } else { // For other images (PNG, JPG, etc.)
                    try {
                        const sharp = require('sharp'); // Lazy load
                        const processedBuffer = await sharp(originalFileBuffer)
                            .resize({
                                width: MAX_DIMENSION,
                                height: MAX_DIMENSION,
                                fit: sharp.fit.inside,
                                withoutEnlargement: true
                            })
                            .jpeg({ quality: JPEG_QUALITY })
                            .toBuffer();
                        
                        console.log(`[Main Sharp] Processed static image. Final buffer length: ${processedBuffer.length} bytes`);
                        return { success: true, base64Frames: [processedBuffer.toString('base64')], isGif: false };
    
                    } catch (sharpError) {
                        console.error(`[Main Sharp] Error processing static image: ${sharpError.message}. Using original buffer.`, sharpError);
                        return { success: true, base64Frames: [originalFileBuffer.toString('base64')], isGif: false };
                    }
                }
            } else { // Non-image file
                console.log(`[Main - get-file-as-base64] Non-image file. Buffer length: ${originalFileBuffer.length}`);
                const base64String = originalFileBuffer.toString('base64');
                // This path is not expected to be hit for VCP messages, but we return a compatible format for robustness.
                return { success: true, base64Frames: [base64String], isGif: false };
            }
    
        } catch (error) {
            console.error(`[Main - get-file-as-base64] Outer catch: Error processing path "${filePath}":`, error.message, error.stack);
            console.log(`[Main - get-file-as-base64] ===== REQUEST END (ERROR) =====`);
            return { success: false, error: `获取或处理文件 Base64 失败: ${error.message}` };
        }
    });

    ipcMain.on('open-external-link', (event, url) => {
        if (url && (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('file:') || url.startsWith('magnet:'))) {
            shell.openExternal(url).catch(err => {
                console.error('Failed to open external link:', err);
            });
        } else {
            console.warn(`[Main Process] Received request to open non-standard link externally, ignoring: ${url}`);
        }
    });

    ipcMain.on('show-image-context-menu', (event, imageUrl) => {
        console.log(`[Main Process] Received show-image-context-menu for URL: ${imageUrl}`);
        const template = [
            {
                label: 'Copy image',
                click: async () => {
                    console.log(`[Main Process] Context menu: "Copy image" clicked for ${imageUrl}`);
                    if (!imageUrl || (!imageUrl.startsWith('http:') && !imageUrl.startsWith('https:') && !imageUrl.startsWith('file:'))) {
                        console.error('[Main Process] Invalid image URL for copying:', imageUrl);
                        dialog.showErrorBox('Copy failed', 'Invalid image URL.');
                        return;
                    }

                    try {
                        if (imageUrl.startsWith('file:')) {
                            const filePath = decodeURIComponent(imageUrl.substring(7));
                            const image = nativeImage.createFromPath(filePath);
                            if (!image.isEmpty()) {
                                clipboard.writeImage(image);
                                console.log('[Main Process] Local image copied to clipboard successfully.');
                            } else {
                                 console.error('[Main Process] Failed to create native image from local file path or image is empty.');
                                 dialog.showErrorBox('Copy failed', 'Unable to create an image from the local file.');
                            }
                        } else { // http or https
                            const request = net.request(imageUrl);
                            let chunks = [];
                            request.on('response', (response) => {
                                response.on('data', (chunk) => chunks.push(chunk));
                                response.on('end', () => {
                                    if (response.statusCode === 200) {
                                        const buffer = Buffer.concat(chunks);
                                        const image = nativeImage.createFromBuffer(buffer);
                                        if (!image.isEmpty()) {
                                            clipboard.writeImage(image);
                                            console.log('[Main Process] Image copied to clipboard successfully.');
                                        } else {
                                            dialog.showErrorBox('Copy failed', 'Unable to create an image from the remote URL.');
                                        }
                                    } else {
                                        dialog.showErrorBox('Copy failed', 'Failed to download image. Status: ' + response.statusCode);
                                    }
                                });
                                response.on('error', (error) => dialog.showErrorBox('Copy failed', 'Image download response error: ' + error.message));
                            });
                            request.on('error', (error) => dialog.showErrorBox('Copy failed', 'Image request failed: ' + error.message));
                            request.end();
                        }
                    } catch (e) {
                        dialog.showErrorBox('Copy failed', 'Unexpected error while copying image: ' + e.message);
                    }
                }
            },
            { type: 'separator' },
            {
                label: 'Open image externally',
                click: () => {
                    shell.openExternal(imageUrl);
                }
            }
        ];
        const menu = Menu.buildFromTemplate(template);
        const currentMainWindow = getMainWindow();
        if (currentMainWindow && !currentMainWindow.isDestroyed()) {
            menu.popup({ window: currentMainWindow });
        }
    });

    async function openImageViewerWindow(imageUrl, imageTitle) {
        const currentMainWindow = getMainWindow();
        const imageViewerWindow = new BrowserWindow({
            width: 800, height: 600, minWidth: 400, minHeight: 300,
            title: imageTitle || 'Image Viewer',
            parent: currentMainWindow && !currentMainWindow.isDestroyed() ? currentMainWindow : undefined,
            modal: false,
            show: false,
            backgroundColor: '#28282c',
            icon: iconPath,
            webPreferences: {
                preload: resolveAppPreload(appRoot, PRELOAD_ROLES.VIEWER),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                devTools: true,
            },
        });

        const viewerUrl = `file://${imageViewerPath}?src=${encodeURIComponent(imageUrl)}&title=${encodeURIComponent(imageTitle || 'Image Viewer')}`;
        imageViewerWindow.loadURL(viewerUrl);
        const openChildWindows = getOpenChildWindows();
        if (Array.isArray(openChildWindows)) {
            openChildWindows.push(imageViewerWindow);
        }

        imageViewerWindow.setMenu(null);
        imageViewerWindow.once('ready-to-show', () => imageViewerWindow.show());
        imageViewerWindow.on('closed', () => {
            removeChildWindow(getOpenChildWindows(), imageViewerWindow);
            const latestMainWindow = getMainWindow();
            if (latestMainWindow && !latestMainWindow.isDestroyed()) {
                latestMainWindow.focus();
            }
        });
    }

    ipcMain.on('open-image-viewer', async (_event, payload = {}) => {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !isNonEmptyString(payload.src)) {
            console.warn('[Main Process] Ignored invalid open-image-viewer payload.');
            return;
        }
        await openImageViewerWindow(payload.src, payload.title);
    });

    ipcMain.on('open-image-in-new-window', async (_event, imageUrl, imageTitle) => {
        if (!isNonEmptyString(imageUrl)) {
            console.warn('[Main Process] Ignored invalid open-image-in-new-window request.');
            return;
        }
        await openImageViewerWindow(imageUrl, imageTitle);
    });

    ipcMain.handle('display-text-content-in-viewer', async (_event, textContent, windowTitle, theme) => {
        if (!isNonEmptyString(textContent)) {
            return { success: false, error: 'display-text-content-in-viewer expects non-empty textContent.' };
        }

        const currentMainWindow = getMainWindow();
        const textViewerWindow = new BrowserWindow({
            width: 800,
            height: 700,
            minWidth: 500,
            minHeight: 400,
            title: isNonEmptyString(windowTitle) ? decodeURIComponent(windowTitle) : 'Text Viewer',
            modal: false,
            show: false,
            frame: false,
            ...(process.platform === 'darwin' ? {} : { titleBarStyle: 'hidden' }),
            minimizable: true,
            parent: currentMainWindow && !currentMainWindow.isDestroyed() ? currentMainWindow : undefined,
            icon: iconPath,
            webPreferences: {
                preload: resolveAppPreload(appRoot, PRELOAD_ROLES.VIEWER),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                devTools: true,
            },
        });

        const base64Text = Buffer.from(textContent).toString('base64');
        const viewerUrl = `file://${textViewerPath}?text=${encodeURIComponent(base64Text)}&title=${encodeURIComponent(windowTitle || 'Text Viewer')}&encoding=base64&theme=${encodeURIComponent(theme || 'dark')}`;

        textViewerWindow.loadURL(viewerUrl).catch((err) => console.error('[Main Process] textViewerWindow failed to initiate URL loading', err));

        const openChildWindows = getOpenChildWindows();
        if (Array.isArray(openChildWindows)) {
            openChildWindows.push(textViewerWindow);
        }

        textViewerWindow.setMenu(null);
        textViewerWindow.once('ready-to-show', () => textViewerWindow.show());
        textViewerWindow.on('closed', () => {
            removeChildWindow(getOpenChildWindows(), textViewerWindow);
            const latestMainWindow = getMainWindow();
            if (latestMainWindow && !latestMainWindow.isDestroyed()) {
                latestMainWindow.focus();
            }
        });

        return { success: true };
    });

    ipcHandlersRegistered = true;
}

module.exports = {
    initialize
};
