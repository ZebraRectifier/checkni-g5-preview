import {test, expect} from '@playwright/test';

test('read-only price dates are clear without changing other disabled hints', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-11-09T12:00:00Z'));
  await page.goto('/?comparison=observed&catalog=retail#shop');
  const results = await page.evaluate(async () => {
    const {createPixelProductCard} = await import('/src/components/PixelProductCard.mjs');
    const base = {id:'fixture',name:'Молоко',unit:'1 л',category:'Молоко',retailerId:'metro',
      catalogDisplayOnly:true,priceMinor:9999,sourceUrl:'https://example.com/'};
    const cases = {
      old:{...base,observedAt:'2026-11-06T12:00:00Z'},
      globus:{...base,retailerId:'globus',observedAt:'2026-10-18T12:00:00Z'},
      oldDa:{...base,retailerId:'da',observedAt:'2026-10-18T12:00:00Z'},
      recent:{...base,observedAt:'2026-11-09T11:00:00Z'},
      middle:{...base,observedAt:'2026-11-09T10:59:59Z'},
      unknown:{...base,observedAt:null},
      future:{...base,observedAt:'2026-11-10T12:00:00Z'},
      noPrice:{...base,priceMinor:null,observedAt:'2026-11-06T12:00:00Z'},
      da:{...base,retailerId:'da',observedAt:'2026-11-09T11:00:00Z'}
    };
    return Object.fromEntries(Object.entries(cases).map(([key,p]) => {
      const card=createPixelProductCard(p,{onAdd() {}});
      const add=card.querySelector('.add-button');
      return [key,{disabled:add.disabled,text:add.textContent,title:add.title,aria:add.getAttribute('aria-label'),
        observed:card.querySelector('.product-observed-at')?.textContent}];
    }));
  });
  expect(results.old.disabled).toBe(true);
  expect(results.old.text).toBe('Цена устарела · просмотр');
  expect(results.old.aria).toContain('цена устарела');
  expect(results.old.observed).toContain('Старая цена от');
  expect(results.globus.text).toBe('Цена устарела · просмотр');
  expect(results.globus.observed).toContain('Старая цена от');
  expect(results.oldDa.text).toBe('Цена устарела · просмотр');
  expect(results.oldDa.title).toBe('Сопоставление для сравнения ещё не подтверждено');
  expect(results.middle.text).toBe('Для сравнения нужна свежая цена');
  expect(results.middle.aria).toContain('для сравнения нужна свежая цена');
  for (const key of ['recent','unknown','future','noPrice']) expect(results[key].text).toBe('Пока только просмотр');
  expect(results.da.title).toBe('Сопоставление для сравнения ещё не подтверждено');
});
