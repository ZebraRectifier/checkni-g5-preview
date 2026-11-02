import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./test/e2e',testMatch:'immutable-release-preview.spec.mjs',workers:1,retries:0,timeout:60000,
  use:{headless:true,...(process.env.RELEASE_BROWSER_CHANNEL?{channel:process.env.RELEASE_BROWSER_CHANNEL}:{})},
  projects:[{name:'desktop',use:{viewport:{width:1365,height:900}}},{name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}]});
