import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./test/e2e',testMatch:'delivery-unconfirmed.spec.mjs',workers:1,reporter:'line',
 use:{baseURL:'http://127.0.0.1:4196'},
 webServer:{command:'node test/support/static-server.mjs',url:'http://127.0.0.1:4196',env:{PORT:'4196'},timeout:30000},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}]
});
