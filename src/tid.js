// Short times belong to the exercise night in Oslo. Full ISO times must have
// explicit offsets, so the machine timezone never changes the interpretation.
export function tilMs(tid) {
  if (typeof tid !== 'string' || tid.length === 0) {
    throw new Error('Tidspunkt må være en tekststreng, f.eks. "03:10" eller full ISO-tid med tidssone.');
  }
  let verdi = tid;
  const kort = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(verdi);
  if (kort) verdi = `2026-10-29T${kort[1].padStart(2, '0')}:${kort[2]}:${kort[3] ?? '00'}+01:00`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(verdi);
  const feil = () => new Error(`Ugyldig tidspunkt «${tid}». Bruk HH:mm[:ss] eller ISO-tid med Z eller ±HH:mm.`);
  if (!iso) throw feil();
  const [, år, måned, dag, time, minutt, sekund = '0', , sone] = iso;
  const y = Number(år), m = Number(måned), d = Number(dag);
  const skuddår = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const dager = [31, skuddår ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > dager[m - 1] ||
      Number(time) > 23 || Number(minutt) > 59 || Number(sekund) > 59 ||
      (sone !== 'Z' && (Number(sone.slice(1, 3)) > 23 || Number(sone.slice(4)) > 59))) throw feil();
  const ms = Date.parse(verdi);
  if (!Number.isFinite(ms)) throw feil();
  return ms;
}

export function norskDato(ms) {
  const deler = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const hent = (type) => deler.find((del) => del.type === type).value;
  return `${hent('year')}-${hent('month')}-${hent('day')}`;
}
