import { chromium } from '@playwright/test';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { collectPublishedWithDiagnostics,serializeDiagnostic } from './published-diagnostics.mjs';
const DATA=new URL('../../src/data/okeyPublishedPromotions.json',import.meta.url);
const STATUS=new URL('../../src/data/okeyPublishedRefresh.json',import.meta.url);
const DIAGNOSTIC=new URL('../../artifacts/okey-published-diagnostics/latest.json',import.meta.url);
const result=await collectPublishedWithDiagnostics({
  launch:()=>chromium.launch({headless:true}),
  readStatus:async()=>JSON.parse(await readFile(STATUS,'utf8')),
  writeData:snapshot=>writeFile(DATA,JSON.stringify(snapshot,null,2)+'\n'),
  writeStatus:status=>writeFile(STATUS,JSON.stringify(status,null,2)+'\n'),
  writeDiagnostics:async report=>{await mkdir(new URL('.',DIAGNOSTIC),{recursive:true});await writeFile(DIAGNOSTIC,serializeDiagnostic(report));},
  // The allowlisted public fields also survive in ordinary job logs, even if
  // that workflow has no separate diagnostics-artifact upload step.
  emit:line=>console.log('OKEY_PUBLISHED_DIAGNOSTIC '+line)
});
console.log(JSON.stringify(result.status));
