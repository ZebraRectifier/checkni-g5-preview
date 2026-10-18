import path from'node:path';import{pathToFileURL}from'node:url';
export function pyatStatePaths(){
  const base=process.env.PYAT_STATE_DIR?pathToFileURL(path.resolve(process.env.PYAT_STATE_DIR)+path.sep):new URL('../../src/data/',import.meta.url);
  return{data:new URL('pyaterochkaPublishedPromotions.json',base),status:new URL('pyaterochkaPublishedRefresh.json',base),
    host:new URL('../../src/data/okeyPublishedRefresh.json',import.meta.url)};
}
