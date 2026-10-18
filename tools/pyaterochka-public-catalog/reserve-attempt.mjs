import{readFile,writeFile,appendFile}from'node:fs/promises';import{pyatStatePaths}from'./state-paths.mjs';
import{reservePyatAttempt}from'./collection-gate.mjs';
const files=pyatStatePaths();let previous,host;try{previous=JSON.parse(await readFile(files.status,'utf8'));host=JSON.parse(await readFile(files.host,'utf8'));}catch{}
const owner=process.env.PYAT_RESERVATION_OWNER,result=reservePyatAttempt(previous,host,owner);
if(result.allowed)await writeFile(files.status,JSON.stringify(result.status,null,2)+'\n');
if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'source_allowed='+String(result.allowed)+'\n');
console.log(JSON.stringify({allowed:result.allowed,reason:result.reason??'reserved-before-source',sourceRequests:0}));
