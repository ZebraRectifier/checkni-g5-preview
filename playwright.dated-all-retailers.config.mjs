import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./test/e2e',testMatch:'dated-all-retailers.spec.mjs',workers:1,reporter:'line',
 use:{baseURL:'http://127.0.0.1:4197'},
 webServer:{command:'node test/support/static-server.mjs',url:'http://127.0.0.1:4197',env:{PORT:'4197'},timeout:30000},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}]
});
