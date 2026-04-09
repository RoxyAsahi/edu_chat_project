// modules/interruptHandler.js

let electronAPI;

/**
 * Initializes the interrupt handler with the Electron API.
 * @param {object} api - The Electron API object from preload.
 */
function initialize(api) {
    electronAPI = api;
}

/**
 * Sends an interrupt request to the main process for a given request ID.
 * @param {string} requestId - The ID of the message/request to interrupt.
 * @returns {Promise<{success: boolean, error?: string, message?: string}>}
 */
async function interrupt(requestId) {
    if (!electronAPI || typeof electronAPI.interruptVcpRequest !== 'function') {
        const errorMsg = 'Interrupt handler is not initialized or interruptVcpRequest is not available on electronAPI.';
        console.error(errorMsg);
        return { success: false, error: errorMsg };
    }
    if (!requestId) {
        console.error('No requestId provided for interruption.');
        return { success: false, error: 'No requestId provided.' };
    }

    console.log(`[InterruptHandler] Requesting interruption for requestId: ${requestId}`);
    try {
        const result = await electronAPI.interruptVcpRequest({ requestId, remote: true });
        if (result.success) {
            console.log(`[InterruptHandler] Successfully sent interrupt for ${requestId}.`);
        } else {
            console.error(`[InterruptHandler] Failed to send interrupt for ${requestId}:`, result.error);
        }
        return result;
    } catch (error) {
        console.error(`[InterruptHandler] Error calling interruptVcpRequest IPC for ${requestId}:`, error);
        return { success: false, error: error.message };
    }
}

export { initialize, interrupt };
