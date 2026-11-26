// Optional status declared by the sending retailer, not a warehouse QC decision.
export function normalizeExpectedInventoryStatus(value){
 const code=String(value??'').trim().toUpperCase();
 return code==='SELLABLE'||code==='NON_SELLABLE'?code:'';
}

export function summarizeExpectedInventoryStatus(rows){
 let sellable=0,nonSellable=0,unreported=0;
 for(const row of rows){
  switch(row.expectedInventoryStatus){
   case 'SELLABLE':sellable+=row.qty;break;
   case 'NON_SELLABLE':nonSellable+=row.qty;break;
   default:unreported+=row.qty;
  }
 }
 return sellable||nonSellable?{sellable,nonSellable,unreported}:null;
}
