import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
  testDir:'./test/e2e',
  testMatch:['pixel-storefront.spec.mjs','manual-search-ux.spec.mjs','hori-panel-contrast.spec.mjs','hori-cubes.spec.mjs','hori-v13.spec.mjs','hori-reference.spec.mjs','hori-workspace.spec.mjs','magnit-current-catalog.spec.mjs','magnit-legacy-aliases.spec.mjs','pyaterochka-published.spec.mjs','nearby-shopping.spec.mjs','guided-shopping.spec.mjs','shopping-dialogue-recovery.spec.mjs','weekly-retail-basket.spec.mjs'],
  fullyParallel:false,
  expect:{toHaveScreenshot:{pathTemplate:'{testDir}/reference-v13/{platform}/{arg}{ext}'}},
  forbidOnly:Boolean(process.env.CI),
  workers:2,
  retries:process.env.CI?1:0,
  reporter:process.env.CI?[['line'],['html',{open:'never'}]]:'line',
  use:{baseURL:'http://127.0.0.1:4195',reducedMotion:'reduce',trace:'on-first-retry',screenshot:'only-on-failure',video:'on-first-retry',
    ...(process.env.CHECKNI_BROWSER_CHANNEL?{channel:process.env.CHECKNI_BROWSER_CHANNEL}:{})},
  webServer:{command:'node test/support/static-server.mjs',url:'http://127.0.0.1:4195',env:{PORT:'4195'},reuseExistingServer:false,timeout:30000},
  projects:[{name:'chromium-desktop',use:{...devices['Desktop Chrome']}},{name:'chromium-mobile',use:{...devices['Pixel 7']}}]
});
