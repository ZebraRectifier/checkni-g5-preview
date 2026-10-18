export function extractPyatDom(){
  const parts=el=>({rubles:el?Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim():'',
    cents:el?.querySelector('span')?.textContent.trim()??'',currency:el?.textContent.includes('₽')?'RUB':null});
  return{title:document.querySelector('h1')?.textContent.replace(/\s+/gu,' ').trim(),
    period:document.querySelector('h2.catalog_dates')?.textContent.replace(/\s+/gu,' ').trim(),
    products:Array.from(document.querySelectorAll('#id_products article.product')).filter(el=>el.getClientRects().length
      &&getComputedStyle(el).visibility!=='hidden').slice(0,501).map(el=>({id:el.id.replace('id_product_',''),
      name:el.querySelector('.product__name')?.textContent,category:el.parentElement.closest('[id]')?.id,
      endText:el.querySelector('.product__descr > .italic')?.textContent,...parts(el.querySelector('.product__price-new'))}))};
}
