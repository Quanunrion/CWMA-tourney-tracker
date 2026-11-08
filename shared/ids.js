// Collision-resistant ids that work in plain-HTTP pages (crypto.randomUUID needs HTTPS).
let counter = 0;
export function newId(prefix = 'id') {
  counter = (counter + 1) % 1679616;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${counter.toString(36).padStart(4, '0')}${rand}`;
}
