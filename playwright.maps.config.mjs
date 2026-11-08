import {defineConfig,devices} from '@playwright/test';
const port=process.env.CHECKNI_MAPS_PORT||'4317';
export default defineConfig({testDir:'./test/e2e',testMatch:['interactive-store-map.spec.mjs'],timeout:40000,workers:1,
  outputDir:'test-results/maps',reporter:'line',use:{baseURL:`http://127.0.0.1:${port}`,reducedMotion:'reduce',
    screenshot:'only-on-failure',trace:'retain-on-failure',...(process.env.CHECKNI_BROWSER_CHANNEL?{channel:process.env.CHECKNI_BROWSER_CHANNEL}:{})},
  webServer:{command:'node test/support/static-server.mjs',url:`http://127.0.0.1:${port}`,env:{PORT:port},reuseExistingServer:false,timeout:30000},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}]});
