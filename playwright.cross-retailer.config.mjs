import base from './playwright.weekly.config.mjs';
export default {...base,testMatch:['weekly-cross-retailer.spec.mjs'],workers:1,timeout:60000,retries:0};
