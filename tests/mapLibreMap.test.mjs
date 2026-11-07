import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createInteractiveStoreMap,storeMapFeatures,STORE_MAP_STYLE} from '../src/runtime/mapLibreMap.mjs';

test('vendored map runtime, worker, stylesheet and license match the verified npm package bytes',async()=>{
  const root=new URL('../src/vendor/maplibre-gl-6.16.0/',import.meta.url);
  const provenance=JSON.parse(await readFile(new URL('PROVENANCE.json',root),'utf8'));
  assert.equal(provenance.version,'6.16.0');
  for(const entry of provenance.files){const bytes=await readFile(new URL(entry.path,root));
    assert.equal(bytes.length,entry.bytes,entry.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.path);}
});

test('map features keep only valid distinct geography IDs; addresses, catalogues and prices never enter the basemap source',()=>{
  const data=storeMapFeatures([{id:'one',lat:55.7,lon:37.6,address:'Private home',catalog:{price:100}},
    {id:'one',lat:56,lon:38},{id:'bad',lat:95,lon:37},{id:'bad2',lat:55,lon:NaN},null]);
  assert.deepEqual(data,{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[37.6,55.7]},properties:{id:'one'}}]});
});

function fixture(){
  let instance;const createdMarkers=[];
  class Map {
    constructor(options){this.options=options;this.center={lat:options.center[1],lng:options.center[0]};this.zoom=options.zoom;this.handlers={};this.sources={};this.layers={};this.touchZoomRotate={disableRotation(){}};instance=this;}
    on(type,fn){(this.handlers[type]??=[]).push(fn);}
    async emit(type,event){for(const fn of this.handlers[type]??[])await fn(event);}
    addSource(id,source){this.sources[id]={...source,setData(data){this.data=data;},getClusterExpansionZoom:async()=>14};}
    getSource(id){return this.sources[id];} addLayer(layer){this.layers[layer.id]=layer;} getLayer(id){return this.layers[id];}
    queryRenderedFeatures(arg,options){return (options??arg)?.layers[0]==='checkni-stores-cluster'?[]:this.sources['checkni-stores']?.data.features??[];}
    getCenter(){return this.center;}getZoom(){return this.zoom;}
    jumpTo(next){this.center={lat:next.center[1],lng:next.center[0]};this.zoom=next.zoom;}
    resize(){}remove(){this.removed=true;}
  }
  class Marker {
    constructor(options){this.options=options;createdMarkers.push(this);}
    setLngLat(point){this.point=point;return this;}addTo(){return this;}remove(){this.removed=true;}
  }
  const element={ownerDocument:{createElement:()=>({setAttribute(){}}),defaultView:{matchMedia:()=>({matches:true})}}};
  return{element,createdMarkers,loadSdkImpl:async()=>({Map,Marker}),getMap:()=>instance};
}

test('region changes clear rendered markers and exact sources; click selects locally, errors preserve an explicit fallback state',async()=>{
  const f=fixture(),states=[],selected=[],moved=[];
  const api=await createInteractiveStoreMap({...f,center:{lat:55.75,lon:37.6},zoom:12,
    createMarker:()=>({addEventListener(){}}),onSelect:p=>selected.push(p),onMove:(p,z)=>moved.push([p,z]),onStatus:s=>states.push(s)});
  const map=f.getMap();assert.equal(map.options.style,STORE_MAP_STYLE);
  api.setPins([{id:'moscow',lat:55.75,lon:37.6}],null);await map.emit('load');await map.emit('render');
  assert.equal(f.createdMarkers.length,1);
  api.setPins([],null);assert.equal(f.createdMarkers[0].removed,true);assert.equal(map.getSource('checkni-stores').data.features.length,0);
  api.setPins([{id:'kazan',lat:55.79,lon:49.12}],null);api.setCamera({lat:55.79,lon:49.12},13);await map.emit('moveend');
  assert.deepEqual(moved.at(-1),[{lat:55.79,lon:49.12},13]);
  await map.emit('click',{point:{x:0,y:0},lngLat:{lat:55.79,lng:49.12}});assert.equal(selected[0].id,'kazan');
  await map.emit('error',{});assert.deepEqual(states,['ready','unavailable']);
  api.destroy();assert.equal(map.removed,true);
});

test('a missing WebGL context rejects once so the caller can retain the address list',async()=>{
  await assert.rejects(createInteractiveStoreMap({element:{ownerDocument:{}},center:{lat:55,lon:37},zoom:9,
    loadSdkImpl:async()=>({Map:class {constructor(){throw Error('webgl failed');}}})}),/map_webgl_unavailable/u);
});
