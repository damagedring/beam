export function productBarcodeSvg(code){
 let x=10,rects='';
 for(const [i,n] of code.runs.entries()){
  if(i%2===0)rects+='<rect x="'+x+'" width="'+n+'" height="42"/>';
  x+=n;
 }
 return '<svg viewBox="0 0 '+code.modules+' 42" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><g fill="black">'+rects+'</g></svg>';
}
