// Shared visual shell. Callers own receipt content, captions and workflow state.
export function folderShellMarkup(index,count,paper=''){
 const position=(Number(index)+1)+' / '+Number(count);
 return '<span class="beam-file" aria-hidden="true"><span class="beam-file-back"></span>'
  +(count>1?'<span class="beam-file-sheet beam-file-sheet-left"></span>':'')
  +(count>2?'<span class="beam-file-sheet beam-file-sheet-right"></span>':'')
  +'<span class="beam-file-window"><span class="beam-file-paper">'+paper+'</span></span>'
  +'<span class="beam-file-glass"><span class="beam-file-position">'+position+'</span><span class="beam-file-arrow">↗</span></span></span>';
}

export function placeFolderOnRibbon(el,slot,slide=0,axis='x',surface='folder'){
 const offset=slot-slide,dist=Math.abs(offset),vertical=axis==='y';
 // Keep the same travel arc, but let the taller paper faces stay closer to front-on.
 const tilt=surface==='paper'?.55:1,roll=surface==='paper'?.38:1;
 const angle=Math.max(-1.42,Math.min(1.42,offset*.39)),arc=Math.sin(angle)/Math.sin(.39),depth=1-Math.cos(angle);
 el.style.setProperty('--ribbon-x',String(vertical?arc*.13:arc));
 el.style.setProperty('--ribbon-lift',String(vertical?arc:depth*.18));
 el.style.setProperty('--ribbon-z',Math.round(-depth*342)+'px');
 el.style.setProperty('--ribbon-pitch',((vertical?-1:.21)*angle*tilt*180/Math.PI)+'deg');
 el.style.setProperty('--ribbon-yaw',((vertical?-.16:-1)*angle*tilt*180/Math.PI)+'deg');
 el.style.setProperty('--ribbon-roll',(offset*(vertical?2.4:1.3)*roll)+'deg');
 el.style.setProperty('--ribbon-zoom',String(1-Math.min(.22,dist*(vertical?.088:.047))));
 el.style.setProperty('--ribbon-layer',String(9-Math.round(dist)));
}
