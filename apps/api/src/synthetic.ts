/**
 * Synthetic data for seeding, simulation and evaluation. Names are realistic Bangladeshi names
 * written in English letters (the proposal's scope); no real person's data is used.
 */
export const MALE_FIRST = ['Abdul', 'Rafiqul', 'Jamal', 'Kamal', 'Shahidul', 'Mizanur', 'Habibur', 'Anwar', 'Nurul', 'Mostafa', 'Rashed', 'Belal', 'Sohel', 'Monir', 'Faruk', 'Delwar', 'Jahangir', 'Alamgir', 'Shafiqul', 'Aminul', 'Harun', 'Selim', 'Ruhul', 'Zakir', 'Mahbub', 'Abul', 'Badiul', 'Golam', 'Saiful', 'Tofazzal', 'Nazrul', 'Mofizul', 'Khorshed', 'Nizam', 'Obaidul', 'Rezaul', 'Sirajul', 'Tariqul', 'Wahid', 'Yunus', 'Ashraf', 'Bashir', 'Dulal', 'Ershad', 'Fazlul', 'Ibrahim', 'Jalal', 'Kabir', 'Lutfor', 'Mokbul', 'Nasir', 'Osman', 'Rafiq', 'Sattar', 'Taher', 'Ziaur', 'Akkas', 'Barek', 'Hashem', 'Motaleb'];
export const FEMALE_FIRST = ['Rahima', 'Nasima', 'Shahana', 'Rokeya', 'Hasina', 'Jesmin', 'Momena', 'Ayesha', 'Fatema', 'Khadija', 'Rina', 'Shirin', 'Parvin', 'Nazma', 'Sufia', 'Laily', 'Salma', 'Taslima', 'Rehana', 'Shapla', 'Amena', 'Bilkis', 'Delowara', 'Feroza', 'Golapi', 'Halima', 'Josna', 'Kohinoor', 'Lovely', 'Mahmuda', 'Nurjahan', 'Rabeya', 'Sahera', 'Tahmina', 'Monowara', 'Rashida', 'Shamsun', 'Hamida', 'Khaleda', 'Anowara'];
/** Optional second given name, common in Bangladeshi names. */
export const MIDDLE = ['', '', '', 'Abdul', 'Nur', 'Mohon', 'Alam', 'Haque', 'Kabir', 'Uddin', 'Rahman', 'Ara', 'Nahar', 'Sultana'];
export const SURNAMES = ['Islam', 'Uddin', 'Hossain', 'Ahmed', 'Rahman', 'Mia', 'Khan', 'Sarkar', 'Chowdhury', 'Miah', 'Karim', 'Haque', 'Ali', 'Bhuiyan', 'Majumder', 'Patwary', 'Akter', 'Begum', 'Khatun', 'Sheikh', 'Talukder', 'Mollah', 'Howlader', 'Biswas', 'Mondal', 'Pramanik', 'Sikder', 'Dewan', 'Bepari', 'Gazi', 'Fakir', 'Sardar', 'Munshi', 'Akand', 'Matubbar', 'Kazi'];
const PREFIX_M = ['', '', 'Md ', 'Mohammad ', 'Md. '];
const PREFIX_F = ['', '', 'Mst ', 'Mosammat '];

export const FENI_AREAS: { upazila: string; upazilaBn: string; union: string; unionBn: string; wards: number }[] = [
  { upazila: 'Feni Sadar', upazilaBn: 'ফেনী সদর', union: 'Dharmapur', unionBn: 'ধর্মপুর', wards: 3 },
  { upazila: 'Feni Sadar', upazilaBn: 'ফেনী সদর', union: 'Lemua', unionBn: 'লেমুয়া', wards: 3 },
  { upazila: 'Parshuram', upazilaBn: 'পরশুরাম', union: 'Mirzanagar', unionBn: 'মির্জানগর', wards: 3 },
  { upazila: 'Fulgazi', upazilaBn: 'ফুলগাজী', union: 'Amzadhat', unionBn: 'আমজাদহাট', wards: 3 },
  { upazila: 'Chhagalnaiya', upazilaBn: 'ছাগলনাইয়া', union: 'Pathannagar', unionBn: 'পাঠাননগর', wards: 2 },
];

export const RELIEF_ITEMS = [
  { itemName: 'Rice', itemNameBn: 'চাল', unit: 'kg' },
  { itemName: 'Lentils', itemNameBn: 'ডাল', unit: 'kg' },
  { itemName: 'Cooking oil', itemNameBn: 'রান্নার তেল', unit: 'litre' },
  { itemName: 'Oral saline', itemNameBn: 'খাবার স্যালাইন', unit: 'packet' },
  { itemName: 'Water purification tablets', itemNameBn: 'পানি বিশুদ্ধকরণ ট্যাবলেট', unit: 'strip' },
  { itemName: 'Dry food pack', itemNameBn: 'শুকনো খাবারের প্যাকেট', unit: 'pack' },
];

/** Deterministic PRNG (mulberry32) so evaluations are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

export function personName(r: () => number): string {
  const female = r() < 0.35;
  const first = female ? pick(r, FEMALE_FIRST) : pick(r, MALE_FIRST);
  const prefix = female ? pick(r, PREFIX_F) : pick(r, PREFIX_M);
  const middle = pick(r, MIDDLE);
  const last = female ? pick(r, ['Akter', 'Begum', 'Khatun', ...SURNAMES]) : pick(r, SURNAMES);
  return `${prefix}${first} ${middle} ${last}`.replace(/\s+/g, ' ').trim();
}

export function mobile(r: () => number): string {
  const op = pick(r, ['3', '4', '5', '6', '7', '8', '9']);
  let rest = '';
  for (let i = 0; i < 8; i++) rest += Math.floor(r() * 10);
  return `01${op}${rest}`;
}

/** Field-style variations of a household: typos, honorific spellings, re-ordered names, a mistyped digit. */
export function varyName(r: () => number, name: string): string {
  const variants: ((s: string) => string)[] = [
    (s) => s.replace(/^Md\.? /, 'Mohammad ').replace(/^Mohammad /, r() < 0.5 ? 'Md ' : 'Mohammad '),
    (s) => s.replace(/q/i, 'k').replace(/ph/i, 'f'),
    (s) => {
      const i = 1 + Math.floor(r() * (s.length - 2));
      return s.slice(0, i) + s.slice(i + 1); // a dropped letter
    },
    (s) => s.split(' ').reverse().join(' '),
    (s) => s.replace(/(ou|u)/, 'o'),
    (s) => s.replace(/^(Mst|Mosammat) /, ''),
  ];
  const out = pick(r, variants)(name).replace(/\s+/g, ' ').trim();
  return /^[A-Za-z][A-Za-z .'-]*$/.test(out) && out.length >= 2 ? out : name;
}

export function mistypePhone(r: () => number, phone: string): string {
  const i = 3 + Math.floor(r() * 8);
  const d = (Number(phone[i]) + 1 + Math.floor(r() * 8)) % 10;
  return phone.slice(0, i) + d + phone.slice(i + 1);
}
