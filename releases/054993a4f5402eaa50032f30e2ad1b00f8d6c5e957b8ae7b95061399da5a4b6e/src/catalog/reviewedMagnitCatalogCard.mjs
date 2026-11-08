import {WEEKLY_MAGNIT_IDENTITIES} from './weeklyMagnitIdentities.mjs';
const normalize=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
export function weeklyMagnitCard(card) {
  if(card?.retailerId!=='magnit')return card;
  const baseCondition=(card.priceConditionLabel??'Условие цены неизвестно').replace(/ · условия карты не подтверждены(?: · весовой товар:.*)?$/u,'');
  const condition=`${baseCondition} · условия карты не подтверждены`;
  card={...card,priceConditionLabel:condition};
  if(card?.retailerId==='magnit'&&/весов|примерно|около|[~≈]/iu.test(card.name??''))
    return {...card,unit:'упаковка',catalogPurchaseBasis:null};
  const identity=WEEKLY_MAGNIT_IDENTITIES.find(p=>p.sourceProductId===card?.sourceProductId&&normalize(p.name)===normalize(card.name));
  if(!identity||card.retailerId!=='magnit')return card;
  let url;try{url=new URL(card.productUrl);}catch{return card;}
  if(url.protocol!=='https:'||!['magnit.ru','www.magnit.ru'].includes(url.host)||url.pathname!==identity.productPath
    ||!/^\d{4,12}$/.test(url.searchParams.get('shopCode')??'')||!card.id.startsWith('retail:magnit:magnit-'+url.searchParams.get('shopCode')+':'))return card;
  // An exact, reviewed pack identity can repair missing descriptive weight;
  // it cannot change the observed amount, condition, address or timestamp.
  if(card.unit&&card.unit!=='упаковка'&&normalize(card.unit).replaceAll(' ','')!==normalize(identity.unit).replaceAll(' ',''))return card;
  return {...card,unit:identity.unit,priceConditionLabel:condition,...(identity.purchaseBasis==='weighed-portion'?{
    catalogPurchaseBasis:'weighed-portion',
    priceConditionLabel:`${condition} · весовой товар: цена за ориентировочную порцию ${identity.unit}; стоимость зависит от фактической массы`
  }:{})};
}
