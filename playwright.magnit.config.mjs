import {defineConfig,devices} from "@playwright/test";
export default defineConfig({
 testDir:"./tests/magnit",fullyParallel:false,workers:1,timeout:60000,
 use:{baseURL:process.env.CHECKNI_PUBLIC_URL || "http://127.0.0.1:4173",trace:"retain-on-failure"},
 projects:[{name:"desktop",use:{...devices["Desktop Chrome"]}},{name:"mobile",use:{...devices["Pixel 7"]}}],
 webServer:process.env.CHECKNI_PUBLIC_URL ? undefined : {command:"python3 -m http.server 4173 --bind 127.0.0.1",url:"http://127.0.0.1:4173",reuseExistingServer:false}
});
