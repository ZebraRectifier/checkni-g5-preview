import {createStoresSection} from '../../src/components/StoresMap.mjs';
import {createInteractiveStoreMap} from '../../src/runtime/mapLibreMap.mjs';
import {createStoreGeolocation} from '../../src/runtime/storeGeolocation.mjs';
import {KNOWN_STORE_MAP_LOCATIONS} from '../../src/data/storeMapLocations.mjs';
const options=new URLSearchParams(location.search);
const output=document.createElement('p');output.id='selection';output.setAttribute('role','status');
const geo=createStoreGeolocation({secureContext:true,geolocation:{getCurrentPosition(ok,fail){fail({code:1});}}});
geo.setManual({lat:55.928776,lon:38.003613});
const selected=KNOWN_STORE_MAP_LOCATIONS.find(s=>s.id==='globus-store-5001');
const stores=createStoresSection({observedStores:[selected],networkRetailers:[],locationController:geo,
  onStoreSelect:store=>{output.textContent='selected:'+store.id;},onBackToNearby:()=>{output.textContent='list';},
  createMap:args=>options.has('fail')?Promise.reject(Error('WebGL unavailable')):createInteractiveStoreMap({...args,
    onStatus:(status,error)=>{args.onStatus(status);if(error)(window.mapErrors??=[]).push(String(error));},
    style:options.has('live')?undefined:{version:8,glyphs:new URL('./map-test-fonts/',import.meta.url).href+'{fontstack}/{range}.pbf',
      sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e5e8de'}}]}})});
document.querySelector('#harness').append(stores,output);
if(options.has('lazy'))stores.hidden=true;
window.mapHarness={geo,stores};
window.harnessReady=true;
