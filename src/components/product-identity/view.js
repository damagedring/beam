import { scannedProductLabel } from '../../domain/product-identity.js';

// Product titles and badges in receipts, inspection lists and reports use one rule.
export function productIdentityMarkup(name,brand,{fallback='—'}={}){
 const item=scannedProductLabel(name,brand);
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return (item.brand?'<span class="scan-brand-badge product-brand-inline">'+escape(item.brand)+'</span>':'')+
  '<span class="product-name-inline">'+escape(item.name||fallback)+'</span>';
}
