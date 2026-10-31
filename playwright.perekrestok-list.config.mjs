import {defineConfig} from '@playwright/test';
const port=process.env.CHECKNI_PEREK_LIST_PORT||'4197';
export default defineConfig({
  testDir:'./test/e2e',testMatch:'perekrestok-reviewed-list.spec.mjs',
  forbidOnly:Boolean(process.env.CI),workers:1,retries:0,reporter:'line',
  use:{baseURL:`http://127.0.0.1:${port}`,reducedMotion:'reduce',screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:{command:'node test/support/static-server.mjs',url:`http://127.0.0.1:${port}`,env:{PORT:port},reuseExistingServer:false,timeout:30000},
  projects:[{name:'chromium-desktop',use:{browserName:'chromium',viewport:{width:1365,height:900}}},
    {name:'chromium-mobile',use:{browserName:'chromium',viewport:{width:390,height:900},isMobile:true,hasTouch:true}}]
});
