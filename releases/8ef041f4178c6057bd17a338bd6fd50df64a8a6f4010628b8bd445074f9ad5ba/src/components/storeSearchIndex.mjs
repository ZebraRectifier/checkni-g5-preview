// Searches only the addresses exposed by the existing selectable store pickers.
// This is discovery, not evidence for a current price, availability or distance.
const normalize = value => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase('ru-RU')
  .replaceAll('ё', 'е')
  .replace(/\s+/gu, ' ')
  .trim();

export function findStoreSearchMatches(query, entries) {
  const terms = normalize(query).split(' ').filter(Boolean);
  return entries.flatMap(entry => {
    const cardText = normalize(entry.cardText);
    const matchedCard = terms.every(term => cardText.includes(term));
    const matchedAddresses = (entry.addresses ?? [])
      .filter(address => address.selectable)
      .filter(address => terms.every(term => normalize(`${entry.name} ${address.label}`).includes(term)));
    if (!matchedCard && matchedAddresses.length === 0) return [];
    return [{ retailerId: entry.retailerId, matchedCard, matchedAddresses }];
  });
}
