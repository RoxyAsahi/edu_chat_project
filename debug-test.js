const { _electron: electron } = require('playwright');

(async () => {
  const electronApp = await electron.launch({ args: ['.'] });
  const window = await electronApp.firstWindow();
  
  window.on('console', msg => console.log(`[Browser] ${msg.type()}: ${msg.text()}`));
  window.on('pageerror', error => console.log(`[Browser Error]: ${error.message}`));
  
  await window.waitForLoadState('domcontentloaded');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  await window.screenshot({ path: 'debug-screenshot.png' });
  await electronApp.close();
})();