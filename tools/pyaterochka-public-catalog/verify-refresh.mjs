import{readFile}from'node:fs/promises';import{verifyPyatRefresh}from'../../src/observations/pyaterochkaPublishedPromotions.mjs';
import{pyatStatePaths}from'./state-paths.mjs';
const files=pyatStatePaths(),snapshot=JSON.parse(await readFile(files.data,'utf8'));
const status=JSON.parse(await readFile(files.status,'utf8'));
const proof=verifyPyatRefresh(snapshot,status);console.log(JSON.stringify(proof));if(!proof.verified)process.exitCode=1;
