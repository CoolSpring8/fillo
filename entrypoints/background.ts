export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details: Browser.runtime.InstalledDetails) => {
    if (details.reason === 'install') {
      browser.tabs
        .create({ url: browser.runtime.getURL('/onboarding.html') })
        .catch((error: unknown) => {
          console.warn('Unable to open onboarding tab.', error);
        });
    }
  });
});
