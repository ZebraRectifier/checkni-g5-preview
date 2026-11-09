// Pure model of reviewed snapshot equality; network and Git are read by guard.
export function checkSnapshot({inventory,active,parent,main,prs,live}){
 if(!inventory.releases.includes(active)) throw Error('active_not_retained');
 if(main&&parent!==inventory.priorMain)throw Error('main_parent_changed');
 if(JSON.stringify(prs)!==JSON.stringify(inventory.openPRs))throw Error('open_pr_snapshot_changed');
 if(live.length!==2||live.some(id=>id!==inventory.live))throw Error('live_snapshot_changed');
 return true;
}
